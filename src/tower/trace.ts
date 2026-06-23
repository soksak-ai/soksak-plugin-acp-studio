// trace.ts — 타워 세션/trace 영속(M7). plan·step·outcome 을 코어 generic app.data 위에 기록한다.
//
// RULE 8(코어 무강결합 + 전수 노출): 타워는 코어에 전용 테이블/스키마/커맨드를 추가하지 않는다. 영속은
//   오직 코어가 제공하는 generic 데이터 capability `app.data`(SQLite, ns=pluginId 격리, raw SQL 금지)
//   표면만 쓴다 — define/put/get/query. 컬렉션 이름은 플러그인 ns 안의 논리 이름일 뿐(코어 테이블 아님).
//   그래서 코어 변경 0·코어 커플링 0 — 이 모듈은 app.data 인터페이스에만 의존한다.
//
// RULE 7(이벤트-우선): executor 가 step 을 실행하는 그 순간(이벤트)에 trace 에 기록한다 — 폴링 0.
//   plan 시작(beginPlan) → 각 step 실행 직후(recordStep) → plan 종결(finishPlan)을 executor 가 호출.
//
// 데이터 모델(2 컬렉션, plan 1 : step N):
//   tower_plans  = 한 NL 요청의 한 plan(또는 분배 시 에이전트별 plan). { sessionId, planId, nl, mode,
//                  agent?, createdAt, outcome, finishedAt? }. outcome 은 종결 시 갱신.
//   tower_steps  = 그 plan 의 각 step. { sessionId, planId, seq, axis, name, params?|address?, danger?,
//                  outcome(코어 결과 객체), status, ts }. seq 단조 = 실행 순서(질의 정렬 키).
//
// 영속 = app.data(디스크) — reload 후 같은 ns 로 재조회하면 그대로 살아 있다(인메모리 아님).

import type { PlanStep } from "./plan";
import type { CommandOutcome } from "./executor";

// app.data 표면(필요한 메서드만) — 코어가 ns=pluginId 를 주입한다(격리). raw SQL 0.
//   runbook/kanban 과 동일 표면(define/put/get/query). 여기선 그 부분집합만 선언한다.
export interface DataApi {
  define: (coll: string, opts: { indexes?: string[]; fts?: string[] }) => Promise<void>;
  put: (coll: string, doc: Record<string, unknown>, opts?: { id?: string; scope?: string }) => Promise<string>;
  get: (coll: string, id: string, opts?: { scope?: string }) => Promise<Record<string, unknown> | null>;
  query: (coll: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
}

// 컬렉션 이름(플러그인 ns 안의 논리 이름 — 코어 테이블 아님). 안정 상수(테스트 단언 대상).
export const PLANS = "tower_plans";
export const STEPS = "tower_steps";

// plan outcome 분류 — 한 plan 의 최종 상태. committed=전 step 실행, dry-run-discarded=사람이 ⏎ 안 누르고
//   버림, yielded=사람 인터럽트로 중간 양보, failed=어떤 step 이 거부/실패(미실행 포함), escalated=reflection
//   루프(M8)가 maxReplans 상한까지 실패해 사람 개입으로 넘긴 마지막 plan(verify 실패 + 더 이상 재계획 안 함).
export type PlanOutcome = "committed" | "dry-run-discarded" | "yielded" | "failed" | "escalated";

// step status — 한 step 의 결과 분류. ok=실행 성공, failed=실행 실패, denied=danger confirm 거부(미실행),
//   gated=게이트가 막아 미실행(토큰 부재 등). status 는 코어 결과(outcome.code)에서 파생(단일 진실).
export type StepStatus = "ok" | "failed" | "denied" | "gated";

// 영속된 plan 레코드(조회 결과 형태). id = app.data put 이 부여한 레코드 id(= 조회 키).
export interface TracePlan {
  id: string;
  sessionId: string;
  nl: string;
  mode: string;
  agent?: string;
  createdAt: number;
  outcome: PlanOutcome | "running";
  finishedAt?: number;
  rollback?: RollbackRecord; // M9 — 묶음 실패로 한정 rollback 이 돌았으면 그 정직 기록(restored/unrestorable).
}

// 영속된 step 레코드(조회 결과 형태).
export interface TraceStep {
  id: string;
  sessionId: string;
  planId: string;
  seq: number;
  axis: PlanStep["axis"];
  name: string;
  params?: Record<string, unknown>;
  address?: string;
  danger?: "destructive" | "inject";
  outcome: Record<string, unknown>; // 코어 결과 객체(투명 — 그대로 보존, 의미가 바뀌면 결과가 바뀐다).
  status: StepStatus;
  ts: number;
}

// plan 시작 시 executor 가 넘기는 메타(누가/무엇을/어떤 모드). agent 는 분배(M6)에서 에이전트별 plan 구분.
export interface PlanMeta {
  nl: string;
  mode: string;
  agent?: string;
}

// executor 가 step 실행 직후 넘기는 기록(StepResult 에서 파생 — 코어 결과 그대로).
export interface StepRecord {
  step: PlanStep;
  outcome: CommandOutcome;
  danger?: "destructive" | "inject";
  status: StepStatus;
}

// rollback 기록(M9) — destructive/inject 묶음이 중간 실패해 한정 rollback 이 돌았을 때 무엇을 되돌렸고
//   무엇을 못 되돌렸는지 정직하게 남긴다(감사). restored = 실제 inverse 가 디스패치된 step(되돌림 성공),
//   unrestorable = inverse 가 없어 되돌릴 수 없던 step(가짜 복원 0, RULE 2). 한 plan 에 0..1 회(현재 plan
//   1건 cap). reason = 무엇이 묶음을 실패시켰는지(어느 step·그 에러).
export interface RollbackRecord {
  reason: { code?: string; message?: string; step?: { axis: string; name: string } }; // 묶음 실패 원인.
  restored: Array<{ axis: string; name: string; ok: boolean; code?: string }>; // 실제 디스패치된 inverse + 그 결과.
  unrestorable: Array<{ axis: string; name: string }>; // inverse 없는 실행분(정직 보고).
}

// 한 plan 의 라이브 trace 핸들 — executor 가 이 핸들로 step 을 누적하고 종결한다(이벤트-우선).
export interface PlanTrace {
  planId: string;
  // step 실행 직후 1건 기록(seq 자동 증가). 실패해도 던지지 않는다(영속 실패가 실행을 막으면 안 됨 — 부수효과).
  recordStep: (rec: StepRecord) => Promise<void>;
  // rollback 1건 기록(M9) — 묶음 실패로 한정 rollback 이 돈 직후. restored/unrestorable 를 정직하게 남긴다.
  //   plan 레코드에 rollback 필드로 합쳐 저장(plan 1 : rollback 0..1). 영속 실패는 삼킨다(부수효과).
  recordRollback: (rec: RollbackRecord) => Promise<void>;
  // plan 종결 — 최종 outcome 갱신. committed/discarded/yielded/failed.
  finish: (outcome: PlanOutcome) => Promise<void>;
}

// trace sink — executor 가 주입받는 영속 진입점. begin → (recordStep*) → finish 가 한 plan 의 수명.
//   조회(recentPlans/stepsOf)는 노출 command tower.trace 가 쓴다(RULE 8 관찰 가능).
export interface TraceSink {
  // 이 sink 가 쓰는 세션 키(쓰기·조회가 같은 키 — 조회 응답이 실제 키를 정직하게 보고하도록 노출).
  sessionId: string;
  // plan 시작 — plan 레코드를 outcome="running" 으로 즉시 영속하고 라이브 핸들을 돌려준다.
  begin: (meta: PlanMeta) => Promise<PlanTrace>;
  // 최근 plan(현재 세션, createdAt 내림차순). limit 기본 20.
  recentPlans: (opts?: { limit?: number }) => Promise<TracePlan[]>;
  // 한 plan 의 step(seq 오름차순 = 실행 순서).
  stepsOf: (planId: string) => Promise<TraceStep[]>;
}

export interface TraceOptions {
  sessionId: string; // 현재 세션 식별자(창/세션 네임스페이스). 같은 ns 안에서 세션별 history 분리.
  now?: () => number; // 시계 주입(테스트 결정성). 기본 Date.now.
}

// 컬렉션 define(멱등) — 조회·정렬에 쓰는 인덱스만. 1회 호출(begin 첫 호출 시 lazy, 또는 외부 ensure).
//   RULE 8: 이름은 ns 안의 논리 이름, 코어 스키마 아님. fts 불필요(키 조회만).
const PLANS_SCHEMA = { indexes: ["sessionId", "createdAt", "outcome", "agent"] };
const STEPS_SCHEMA = { indexes: ["sessionId", "planId", "seq", "status"] };

// 코어 결과(CommandOutcome) → step status 파생(단일 진실). 거부/게이트 코드는 명시 매핑, 그 외 ok 플래그.
//   recordStep 호출자(executor)가 danger 거부를 알면 status 를 직접 넘길 수도 있으나, 여기서도 코드로 보강.
export function deriveStatus(outcome: CommandOutcome): StepStatus {
  if (outcome.ok) return "ok";
  if (outcome.code === "CONFIRM_DENIED") return "denied";
  if (outcome.code === "GATE_REQUIRED" || outcome.code === "FORBIDDEN_CHROME") return "gated";
  return "failed";
}

export function createTrace(data: DataApi, opts: TraceOptions): TraceSink {
  const now = opts.now ?? (() => Date.now());
  const sessionId = opts.sessionId;

  // define 멱등 보장(첫 쓰기 전 1회). 동시 begin 경합에도 단일 약속으로 직렬(중복 define 무해하나 1약속 재사용).
  let defined: Promise<void> | null = null;
  const ensureDefined = (): Promise<void> => {
    if (!defined) {
      defined = (async () => {
        await data.define(PLANS, PLANS_SCHEMA);
        await data.define(STEPS, STEPS_SCHEMA);
      })().catch(() => {
        // define 실패(이미 정의 등)는 무해 — 다음 호출이 재시도하지 않게 약속은 유지(put 이 진실 게이트).
      });
    }
    return defined;
  };

  async function begin(meta: PlanMeta): Promise<PlanTrace> {
    await ensureDefined();
    const createdAt = now();
    const doc: Record<string, unknown> = {
      sessionId,
      nl: meta.nl,
      mode: meta.mode,
      createdAt,
      outcome: "running",
    };
    if (meta.agent !== undefined) doc.agent = meta.agent;
    const planId = await data.put(PLANS, doc);
    let seq = 0;
    let rollback: RollbackRecord | undefined; // M9 — 묶음 실패 시 1회 채워짐(현재 plan 1건 cap). finish 가 함께 영속.

    const recordStep = async (rec: StepRecord): Promise<void> => {
      const s = rec.step;
      const stepDoc: Record<string, unknown> = {
        sessionId,
        planId,
        seq: seq++,
        axis: s.axis,
        name: s.name,
        // 코어 결과 그대로 보존(투명 — 의미가 바뀌면 결과가 바뀐다). status 는 명시 우선, 없으면 코드 파생.
        outcome: rec.outcome as Record<string, unknown>,
        status: rec.status ?? deriveStatus(rec.outcome),
        ts: now(),
      };
      if (s.params !== undefined) stepDoc.params = s.params;
      if (s.address !== undefined) stepDoc.address = s.address;
      if (rec.danger !== undefined) stepDoc.danger = rec.danger;
      try {
        await data.put(STEPS, stepDoc);
      } catch {
        // 영속 실패가 실행을 막지 않는다(부수효과) — 다음 step 진행. trace 누락만 발생(가용성 우선).
      }
    };

    const recordRollback = async (rec: RollbackRecord): Promise<void> => {
      rollback = rec; // 현재 plan 1건만(cap). finish 가 plan 레코드에 합쳐 영속한다.
      try {
        await data.put(PLANS, { ...doc, rollback }, { id: planId });
      } catch {
        // 영속 실패가 실행/복원을 막지 않는다(부수효과) — trace 누락만(가용성 우선).
      }
    };

    const finish = async (outcome: PlanOutcome): Promise<void> => {
      try {
        const fin: Record<string, unknown> = { ...doc, outcome, finishedAt: now() };
        if (rollback) fin.rollback = rollback; // M9 — rollback 기록을 종결 갱신에도 보존.
        await data.put(PLANS, fin, { id: planId });
      } catch {
        /* 종결 갱신 실패는 무해 — running 으로 남아도 step 으로 사후 판별 가능 */
      }
    };

    return { planId, recordStep, recordRollback, finish };
  }

  async function recentPlans(o: { limit?: number } = {}): Promise<TracePlan[]> {
    await ensureDefined();
    const rows = await data.query(PLANS, {
      where: { sessionId },
      order: "createdAt",
      desc: true,
      limit: o.limit ?? 20,
    });
    return rows as unknown as TracePlan[];
  }

  async function stepsOf(planId: string): Promise<TraceStep[]> {
    await ensureDefined();
    const rows = await data.query(STEPS, {
      where: { sessionId, planId },
      order: "seq",
      desc: false,
      limit: 1000,
    });
    return rows as unknown as TraceStep[];
  }

  return { sessionId, begin, recentPlans, stepsOf };
}
