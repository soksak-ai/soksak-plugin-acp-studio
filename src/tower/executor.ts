// executor.ts — 타워의 유일 실행점(RULE 6). 모든 fast-path(예시행·팔레트)와 향후 slow-path plan 이
//   여기 한 곳을 거쳐 app.commands.execute 로 직렬화된다(입력 race 0, 불변식 강제 1곳).
//
// fast-path: 예시행 → EXAMPLE_COMMANDS 의 command + 라이브 파라미터 / 팔레트행 → 그 command 자체.
//   destructive 는 퍼지매치 금지(정확매치만). danger 면 confirm 게이트 경유 후에야 실행.
//
// ── DANGER-CONFIRM 게이트(보안 핵심, 매트릭스 불변식) ──
//  (a) destructive/inject → confirm 모달이 실행 전에 뜬다. 거부/타임아웃 → 미실행.
//  (b) ⚠️ confirm accept 는 executor 의 dom 도달 밖:
//      - 모달 accept 컨트롤에 data-node 없음 → collectExposed 미수집 → ui.input.click NOT_EXPOSED.
//      - 그리고 executor.runDom 은 "confirm" 을 포함한 보안-chrome 주소를 명시 거부(FORBIDDEN_CHROME)
//        — 악성 plan 이 어떤 우회로도 자기 게이트를 클릭 못 한다. 컨테이너 data-node 는 노출(가시성).
//  (c) 게이트가 실행에 엮인다(단일 if 아님): confirm 수락이 1회용 토큰을 발급하고, 그 토큰을 키로
//      {name, params} 를 보관한 게이트 엔트리만이 실행을 구성한다. 토큰 없이는 name/params 출처 자체가
//      없어 execute 호출을 만들 수 없다 — 검증 분기를 NOP-패치해도 동작 안 함(데이터 의존).

import {
  classifyDanger,
  validatePlan,
  buildPlanSystemPrompt,
  parsePlan,
  planContextFromDomain,
  EXAMPLE_COMMANDS,
  type PlanStep,
  type DomainMap,
} from "./plan";
import { distributePlans, type DistMode, type PlanFor, type AgentPlan } from "./distribute";

export interface CommandOutcome {
  ok: boolean;
  code?: string;
  message?: string;
  [k: string]: unknown;
}

// slow-path planner — 모호 NL 의 planning 턴 단일 seam. systemPrompt(도메인맵 라이브 주입)를 받아
//   에이전트의 PLAN 텍스트(JSON step 배열, 코드펜스 무방)를 돌려준다. main.ts 가 Clubhouse 엔진
//   requestPlan 으로 주입하고, 단위 테스트는 고정 PLAN 을 반환하는 stub 을 주입(라이브 LLM 비의존).
export type Planner = (systemPrompt: string) => Promise<string>;

// step 실행 기록 — 각 step + 그 결과. status step 결과가 보존돼 다음 step·다음 턴 컨텍스트로 흐른다(피드백).
export interface StepResult {
  step: PlanStep;
  result: CommandOutcome;
}

// commit 결과 — 전체 ok + step별 기록(results). 첫 실패에서 멈추되, 그때까지의 results 는 보존.
//   yielded = 사람 인터럽트(pendingHuman)로 중간 양보됨 — 부분 실행 보존(취소-폐기 아님).
export interface CommitResult extends CommandOutcome {
  results?: StepResult[];
  yielded?: boolean;
}

// commit 옵션 — 사람 인터럽트 협조 양보(M6). shouldYield() 가 true 면 다음 step 으로 넘어가기 전에 멈춘다
//   (현재 step 은 이미 종결, 그때까지의 results 보존). 라이브에선 main.ts 가 () => st.pendingHuman.length>0 주입.
export interface CommitOptions {
  shouldYield?: () => boolean;
}

// dry-run 결과(실행 0). 검증 통과 시 steps + commit() 반환. commit() 호출 시에만 디스패치(사람 ⏎).
export type PlanRunResult =
  | { ok: true; steps: PlanStep[]; commit: (opts?: CommitOptions) => Promise<CommitResult> }
  | { ok: false; code: string; message: string; steps?: PlanStep[] };

// 분배 dry-run 결과(M6) — 모드별 다중 에이전트 plan. 각 에이전트의 검증된 steps + 단일 commit(전 plan 디스패치).
//   commit 은 simul 이면 병렬(confirm 직렬 큐가 안전 직렬화), turn/facil 이면 순서대로. shouldYield 협조 양보 지원.
export type DistRunResult =
  | {
      ok: true;
      mode: DistMode;
      plans: Array<{ agentId: string; steps: PlanStep[] }>;
      commit: (opts?: CommitOptions) => Promise<DistCommitResult>;
    }
  | { ok: false; code: string; message: string };

export interface DistCommitResult extends CommandOutcome {
  // 에이전트별 commit 결과(부분 실패·yield 보존). 각 plan 은 독립 — 하나 실패해도 나머지는 자기 결과를 남긴다.
  perAgent: Array<{ agentId: string; result: CommitResult }>;
  yielded?: boolean;
}

// 분배 옵션 — 모드/참여자/진행자 + 에이전트별 planning 턴 seam(planFor). main.ts 가 engine 으로 주입.
export interface DistRunOptions {
  mode: DistMode;
  participants: string[];
  facilitatorId: string;
  nameOf: (id: string) => string;
  planFor: PlanFor;
}

// slow-path 옵션 — planner 미주입 시(deps.planner 도 없으면) NO_PLANNER. hops = 자기교정 상한.
export interface PlanRunOptions {
  hops?: number; // self-correct 최대 시도(기본 3) — 미등록/파싱 실패 되먹임 횟수 상한(RULE 폭주 방지).
  // 결정적 E2E 주입 — planner 를 우회해 KNOWN plan 을 직접 검증→dry-run 한다(라이브 LLM 비의존). 보안
  //   우회 아님: 주입 plan 도 동일하게 validatePlan(미등록 거부) + dispatchPlan(danger 게이트)을 거친다.
  //   순수 검증·실행 경로를 라이브 에이전트 없이 단언하기 위한 테스트 hook(노출 command tower.plan 이 사용).
  injectPlan?: PlanStep[];
}

// confirm 게이트 — 사람이 수락하면 issue() 로 1회용 토큰을 발급하고 그 토큰을 반환한다.
//   거부/타임아웃 → null(토큰 미발급). 실모달은 DOM(아래 createConfirmModal)이 구현, 테스트는 주입.
export type ConfirmGate = (issue: () => string, info: ConfirmInfo) => Promise<string | null>;

export interface ConfirmInfo {
  command: string;
  danger: "destructive" | "inject";
  params: Record<string, unknown>;
}

export interface ExecutorDeps {
  app: any; // ctx.app — commands.execute 단일 코어 호출 seam.
  confirmGate: ConfirmGate;
  lang?: () => string;
  planner?: Planner; // slow-path planning 턴 seam(main.ts 가 Clubhouse 엔진으로 주입). 없으면 NO_PLANNER.
}

// confirm 모달이 노출하는 data-node 경로(소스 단일 진실). 컨테이너만 노출(가시성), accept 는 비노출.
//   executor.test.ts 가 이 집합으로 "accept 비노출" 계약을 단언한다.
export const CONFIRM_EXPOSED_NODES = ["tower/confirm", "tower/confirm/cancel"] as const;

// 보안-chrome 주소 판별 — executor 의 dom 도달에서 영구 차단. confirm 게이트 표면은 절대 클릭 대상 아님.
function isForbiddenChrome(address: string): boolean {
  return /(^|\/)tower\/confirm(\/|$)/.test(address) || /(^|\/)modal\/confirm-close(\/|$)/.test(address);
}

// 16바이트 랜덤 토큰(게이트 1회분). crypto 우선, 없으면 Math.random 폴백(테스트/노드 환경).
function randomToken(): string {
  try {
    const g: any = globalThis as any;
    if (g.crypto?.getRandomValues) {
      const b = new Uint8Array(16);
      g.crypto.getRandomValues(b);
      return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* 폴백 */
  }
  return `t${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export interface TowerExecutor {
  runExample: (index: number) => Promise<CommandOutcome>;
  runCommand: (name: string, params?: Record<string, unknown>) => Promise<CommandOutcome>;
  runDom: (address: string) => Promise<CommandOutcome>;
  runPlan: (steps: PlanStep[]) => Promise<CommandOutcome>;
  // slow-path(M5) — 모호 NL → 도메인맵 라이브 주입 planning 턴 → 검증 → dry-run(실행 0) + commit().
  planAndRun: (nl: string, opts?: PlanRunOptions) => Promise<PlanRunResult>;
  // 다중 에이전트 분배(M6) — 모호 NL → 모드별(facil split / turn 체인 / simul 병렬) 다중 plan → 각 검증
  //   → 단일 dry-run(실행 0) + commit(). danger step 의 confirm 은 직렬 큐로 한 번에 하나만(simul 안전).
  distributeAndRun: (nl: string, opts: DistRunOptions) => Promise<DistRunResult>;
}

// 게이트의 유일 실행 통로(sealedDispatch) 접근 심볼 — 테스트가 "토큰만으로는 못 뚫는다"를 실증하려면
//   gatedRun 의 분기를 건너뛰고 sealedDispatch 를 직접 쳐 봐야 한다(단일 if NOP 공격 동형). 일반 코드는
//   이 심볼을 모르므로 우발 접근 0 — 적대 테스트만이 이 능력을 가진다(공격 표면 확장 아님, 검증용).
export const SEALED = Symbol("tower.executor.sealed");

export function createExecutor(deps: ExecutorDeps): TowerExecutor {
  const { app, confirmGate } = deps;
  const exec = (name: string, params?: Record<string, unknown>): Promise<CommandOutcome> =>
    app.commands.execute(name, params ?? {});

  // ── 게이트 엔트리 저장소(토큰 → {name, params}). (c) 데이터 의존의 핵심 ──
  //   destructive/inject 실행의 name/params 는 오직 confirm 이 발급한 토큰을 통해서만 얻는다. 토큰이 없으면
  //   조회 결과도 없어 sealedDispatch 가 execute 를 구성할 수 없다. 1회용(조회 즉시 삭제 = replay 차단).
  const gates = new Map<string, { name: string; params: Record<string, unknown> }>();

  // ── danger 직렬 confirm 큐(M6, 안전모델 §danger 직렬 큐) ──
  //   simul 다수 에이전트의 병렬 plan 이 동시에 destructive/inject step 을 commit 하면 confirm 요구가
  //   동시에 발생한다. 두 confirm 모달이 한꺼번에 뜨면 사람이 헷갈리고 자가승인·오승인 위험이 커진다.
  //   따라서 confirmGate 호출 자체를 FIFO 로 직렬화한다 — 한 번에 정확히 하나만 열린다. 앞 confirm 이
  //   해소(수락/거부/타임아웃)된 뒤에야 다음 confirm 이 열린다(이벤트-우선: tail 프라미스 체인, 폴링 0).
  let confirmTail: Promise<void> = Promise.resolve();
  function enqueueConfirm(issue: () => string, info: ConfirmInfo): Promise<string | null> {
    // 새 confirm 을 현재 tail 뒤에 잇는다. tail 이 끝날 때까지 confirmGate 는 호출조차 안 된다(동시 0).
    const run = confirmTail.then(() => confirmGate(issue, info));
    // tail 전진 — 이 confirm 이 끝나야(성공/실패 무관) 다음이 시작. catch 로 큐 막힘 0(거부도 통과).
    confirmTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // 유일한 destructive/inject 실행 통로 — 토큰으로 게이트 엔트리를 꺼내 그 안의 name/params 로만 실행한다.
  //   인자로 받은 name/params 가 아니라 *엔트리* 가 진실 → 토큰 위조 시 엔트리 부재로 미실행(단일 if 아님).
  async function sealedDispatch(token: string): Promise<CommandOutcome> {
    const entry = gates.get(token);
    if (!entry) {
      // 위조/만료/소비된 토큰 — 실행을 구성할 데이터가 없음. (c) NOP-패치 내성: 여기에 분기가 아니라
      //   데이터 부재가 막는다. 검증을 지워도 entry 가 undefined 라 .name 접근이 곧 실패.
      return { ok: false, code: "GATE_REQUIRED", message: "확인 게이트 토큰이 없거나 만료됨(실행 불가)" };
    }
    gates.delete(token); // 1회용 소비.
    return exec(entry.name, entry.params);
  }

  // danger command 게이트 통과 → 실행. confirm 이 토큰 발급(issue)하면서 게이트 엔트리에 name/params 봉인.
  async function gatedRun(
    name: string,
    params: Record<string, unknown>,
    danger: "destructive" | "inject",
  ): Promise<CommandOutcome> {
    const issue = (): string => {
      const token = randomToken();
      gates.set(token, { name, params }); // 수락 순간에만 실행 데이터가 존재.
      return token;
    };
    // confirm 은 직렬 큐를 거친다 — 동시 destructive(simul 병렬 plan)도 한 번에 하나만 열린다(FIFO).
    const token = await enqueueConfirm(issue, { command: name, danger, params });
    if (token == null) {
      return { ok: false, code: "CONFIRM_DENIED", message: "사용자가 위험 명령 확인을 거부/취소함" };
    }
    return sealedDispatch(token);
  }

  // 단일 command 실행(fast-path 종점). 비파괴 = 직행, danger = 게이트 경유.
  async function runCommand(name: string, params: Record<string, unknown> = {}): Promise<CommandOutcome> {
    const danger = classifyDanger(name);
    if (danger) return gatedRun(name, params, danger);
    return exec(name, params); // 비파괴 → 즉시 직행(에이전트 우회).
  }

  // dom 디스패치(축2) — 노출 주소를 ui.input.click 으로. 단, 보안-chrome(confirm)은 영구 거부.
  //   (b) 악성 plan 이 confirm accept 주소를 넣어도 여기서 차단 → 자가승인 0.
  //   ⚠️ ui.input.click 은 코어가 inject 로 분류한다 — 클릭은 입력 주입(임의 UI 조작 가능). 따라서 dom
  //   디스패치도 danger 게이트(confirm)를 거친다(plan 의 dom step 이 사람 확인 없이 임의 클릭 못 함).
  //   forbidden-chrome 거부가 먼저(게이트조차 안 띄움), 그다음 inject 게이트. 코어 권한은 commands:inject.
  async function runDom(address: string): Promise<CommandOutcome> {
    if (isForbiddenChrome(address)) {
      return { ok: false, code: "FORBIDDEN_CHROME", message: `보안 chrome 은 클릭 대상이 아님: ${address}` };
    }
    return gatedRun("ui.input.click", { address }, "inject"); // 클릭=inject → confirm 게이트 경유.
  }

  // 예시행 실행 — text → command + 라이브 파라미터 해소 → runCommand(게이트 포함).
  async function runExample(index: number): Promise<CommandOutcome> {
    const spec = EXAMPLE_COMMANDS[index];
    if (!spec) return { ok: false, code: "UNKNOWN_EXAMPLE", message: `예시 인덱스 범위 밖: ${index}` };
    let params: Record<string, unknown> | null;
    try {
      params = await spec.resolveParams((n, p) => exec(n, p));
    } catch (e) {
      return { ok: false, code: "RESOLVE_FAILED", message: String((e as Error)?.message ?? e) };
    }
    if (params == null) {
      return { ok: false, code: "NEEDS_TARGET", message: `대상을 찾지 못함: "${spec.text}"` };
    }
    return runCommand(spec.command, params);
  }

  // 단일 step 디스패치(축별 라우팅, 단일 진실) — runPlan·planAndRun.commit 공용. danger command 는
  //   runCommand 가 게이트 경유. dom 은 runDom(보안-chrome 영구 거부). status 는 read 직행(비파괴).
  async function dispatchStep(s: PlanStep): Promise<CommandOutcome> {
    if (s.axis === "dom") return runDom(s.address as string);
    if (s.axis === "status") return exec(s.name, s.params ?? {}); // 축3 — read, 게이트 없음.
    return runCommand(s.name, s.params ?? {}); // 축1 — 비파괴 직행 / danger 게이트.
  }

  // 라이브 3축 도메인맵 캡처 — 호출 직전 스냅샷(축1 state.commands · 축2 ui.tree · 축3 status.query).
  //   slow-path 가 이걸로 시스템 프롬프트를 주입하고, 같은 스냅샷으로 validatePlan(단일 진실).
  async function fetchDomainMap(): Promise<DomainMap> {
    const [cat, tree, st] = await Promise.all([
      exec("state.commands"),
      exec("ui.tree"),
      exec("status.query").catch(() => ({ statuses: [] })),
    ]);
    return {
      commands: (Array.isArray((cat as any)?.commands) ? (cat as any).commands : []).map((c: any) => ({
        name: c.name,
        description: c.description,
      })),
      addresses: (Array.isArray((tree as any)?.nodes) ? (tree as any).nodes : []).map((n: any) => n.address),
      statuses: Array.isArray((st as any)?.statuses) ? (st as any).statuses : [],
    };
  }

  // plan 디스패치(step별, 첫 실패에서 멈춤) — 각 step 결과를 results 에 기록(피드백). status step 결과는
  //   보존돼 다음 step·다음 턴 컨텍스트로 흐른다(verify, not poll). danger step 은 confirm 게이트 경유.
  //   인터럽트(shouldYield): 다음 step 진입 전 사람 참견(pendingHuman)이 있으면 양보 — 현재까지 실행한
  //   step 결과(results)는 보존하고 yielded:true 로 멈춘다(취소-폐기 아님, Clubhouse 참견 모델 동형).
  async function dispatchPlan(steps: PlanStep[], opts: CommitOptions = {}): Promise<CommitResult> {
    const results: StepResult[] = [];
    for (const s of steps) {
      // step 진입 전 협조 양보 — 부분 실행 보존하고 멈춘다(현재 step 은 시작 안 함, 앞 step 들은 보존).
      if (opts.shouldYield?.()) return { ok: true, yielded: true, results };
      const r = await dispatchStep(s);
      results.push({ step: s, result: r });
      if (!r.ok) return { ok: false, code: r.code, message: r.message, results };
    }
    return { ok: true, results };
  }

  // slow-path plan 실행(직접 step 주입 경로) — 라이브 도메인맵으로 전수 검증 후 step별 디스패치.
  //   fast-path/직접 plan 용(검증 + 실행). 모호 NL 의 dry-run 경로는 planAndRun.
  async function runPlan(steps: PlanStep[]): Promise<CommandOutcome> {
    const map = await fetchDomainMap();
    const v = validatePlan(steps, planContextFromDomain(map));
    if (!v.ok) return { ok: false, code: v.code, message: v.message, index: (v as any).index };
    return dispatchPlan(steps);
  }

  // slow-path 오케스트레이션(M5) — 모호 NL → 도메인맵 라이브 주입 planning 턴 → 파싱 → 검증.
  //   검증 실패(미등록 command/주소·파싱 실패)는 에러를 다음 planning 프롬프트에 되먹여 self-correct
  //   (hops 상한, RULE 폭주 방지). 성공 시 **실행하지 않고** dry-run(steps + commit) 반환 — 사람이
  //   ⏎(commit) 해야 비로소 dispatchPlan 으로 디스패치(안전모델: slow-path 는 항상 dry-run 우선).
  async function planAndRun(nl: string, opts: PlanRunOptions = {}): Promise<PlanRunResult> {
    // 결정적 주입(E2E) — KNOWN plan 을 planner 우회로 검증→dry-run. 라이브 도메인맵으로 검증은 동일.
    if (opts.injectPlan) {
      const map = await fetchDomainMap();
      const v = validatePlan(opts.injectPlan, planContextFromDomain(map));
      if (!v.ok) return { ok: false, code: v.code, message: v.message, steps: opts.injectPlan };
      const frozen = opts.injectPlan;
      return { ok: true, steps: frozen, commit: (copts) => dispatchPlan(frozen, copts) };
    }
    if (!deps.planner) {
      return { ok: false, code: "NO_PLANNER", message: "planning 엔진이 연결되지 않음(에이전트 미연결)" };
    }
    const planner = deps.planner;
    const maxHops = Math.max(1, opts.hops ?? 3);
    let correction: string | undefined;
    let lastErr: { code: string; message: string; steps?: PlanStep[] } = {
      code: "PLAN_PARSE_FAILED",
      message: "PLAN 을 만들지 못했습니다.",
    };
    for (let hop = 0; hop < maxHops; hop++) {
      // 매 hop 라이브 도메인맵 재캡처 — 직전 step 이 화면을 바꿨을 수 있으므로 항상 최신(이벤트-우선 verify).
      const map = await fetchDomainMap();
      const prompt = buildPlanSystemPrompt(nl, map, correction);
      let raw: string;
      try {
        raw = await planner(prompt);
      } catch (e) {
        lastErr = { code: "PLANNER_FAILED", message: String((e as Error)?.message ?? e) };
        correction = `플래너 호출 실패: ${lastErr.message}`;
        continue;
      }
      const steps = parsePlan(raw);
      if (!steps) {
        lastErr = { code: "PLAN_PARSE_FAILED", message: "PLAN(JSON 배열)을 파싱하지 못했습니다." };
        correction = "직전 출력에서 JSON 배열 PLAN 을 찾지 못했습니다. 설명 없이 JSON 배열만 출력하세요.";
        continue;
      }
      const v = validatePlan(steps, planContextFromDomain(map));
      if (!v.ok) {
        lastErr = { code: v.code, message: v.message, steps };
        // 되먹임 — 거부된 step 의 사유(미등록 이름/주소)를 다음 프롬프트에 그대로 싣는다(self-correct).
        correction = `step #${(v as any).index} 거부: ${v.message}`;
        continue;
      }
      // 검증 통과 — dry-run(실행 0) + commit 클로저. commit 시에만 dispatchPlan(사람 ⏎).
      const frozen = steps;
      return { ok: true, steps: frozen, commit: (copts) => dispatchPlan(frozen, copts) };
    }
    return { ok: false, ...lastErr };
  }

  // 다중 에이전트 분배 오케스트레이션(M6) — 모드별로 planning 턴을 여러 에이전트에 나누고(distribute.ts),
  //   각 에이전트 plan 을 라이브 도메인맵으로 전수 검증(미등록 거부)한 뒤 단일 dry-run + commit 을 돌려준다.
  //   실행은 commit 에서만(slow-path 는 항상 dry-run 우선). simul commit 은 병렬 — 그래서 confirm 직렬 큐가
  //   필수(동시 destructive 도 한 번에 하나). turn/facil 은 순서대로 디스패치. 검증 실패 plan 은 그 에이전트만
  //   제외하지 않고 전체를 거부하면 한 동료 오타가 전체를 막는다 — 대신 그 plan 은 commit 에서 실패로 보고하고
  //   나머지는 자기 결과를 남긴다(독립성). 단, dry-run 단계의 검증 실패는 plans 에서 사유와 함께 표면화한다.
  async function distributeAndRun(nl: string, opts: DistRunOptions): Promise<DistRunResult> {
    const map = await fetchDomainMap();
    const ctx = planContextFromDomain(map);
    // 도메인맵 라이브 주입 — 분배의 각 planning 턴이 같은 어휘/주소/상태를 본다(단일 진실).
    const systemPromptFor = (_id: string) => buildPlanSystemPrompt(nl, map);
    const dist = await distributePlans({
      mode: opts.mode,
      participants: opts.participants,
      facilitatorId: opts.facilitatorId,
      nameOf: opts.nameOf,
      planFor: opts.planFor,
      systemPromptFor,
    });
    if (!dist.plans.length) {
      return { ok: false, code: "NO_PLAN", message: "어느 에이전트도 유효한 PLAN 을 만들지 못했습니다." };
    }
    // 각 plan 검증(미등록 거부). 한 plan 이라도 검증 실패면 그 에이전트·사유를 담아 거부(self-correct 표면).
    const validated: AgentPlan[] = [];
    for (const p of dist.plans) {
      const v = validatePlan(p.steps, ctx);
      if (!v.ok) {
        return {
          ok: false,
          code: v.code,
          message: `${opts.nameOf(p.agentId)} 의 PLAN step #${(v as any).index} 거부: ${v.message}`,
        };
      }
      validated.push(p);
    }
    const frozen = validated.map((p) => ({ agentId: p.agentId, steps: p.steps }));
    const commit = async (copts?: CommitOptions): Promise<DistCommitResult> => {
      const perAgent: Array<{ agentId: string; result: CommitResult }> = [];
      if (opts.mode === "simul") {
        // 동시 — 전 plan 병렬 디스패치. danger confirm 은 enqueueConfirm(FIFO)이 한 번에 하나로 직렬화.
        const settled = await Promise.all(
          frozen.map(async (p) => ({ agentId: p.agentId, result: await dispatchPlan(p.steps, copts) })),
        );
        perAgent.push(...settled);
      } else {
        // 순차(turn)·진행(facil) — 분배 순서대로. 매 plan 전 협조 양보(인터럽트) 체크.
        for (const p of frozen) {
          if (copts?.shouldYield?.()) return { ok: true, yielded: true, perAgent };
          perAgent.push({ agentId: p.agentId, result: await dispatchPlan(p.steps, copts) });
        }
      }
      const yielded = perAgent.some((a) => a.result.yielded);
      const ok = perAgent.every((a) => a.result.ok);
      return { ok, yielded, perAgent };
    };
    return { ok: true, mode: dist.mode, plans: frozen, commit };
  }

  const api: TowerExecutor = { runExample, runCommand, runDom, runPlan, planAndRun, distributeAndRun };
  // 적대 테스트 전용 봉인 통로 — gatedRun 분기를 우회해 토큰만으로 sealedDispatch 를 직접 호출(NOP 공격
  //   동형). 데이터 의존이라 위조/소비 토큰 → 게이트 엔트리 부재 → 0 실행을 단언한다(검증을 지워도 막힘).
  Object.defineProperty(api, SEALED, { value: sealedDispatch, enumerable: false });
  return api;
}

// ── 테스트 전용: 게이트 단일-분기 NOP 공격을 모사하는 경로 ──
//   '공격자' 가 gatedRun 의 if 를 제거하고 임의 토큰으로 sealedDispatch 를 직접 호출한다고 가정한다.
//   SEALED 심볼로 진짜 sealedDispatch 를 토큰만으로 직접 호출 → 위조/소비 토큰이면 게이트 엔트리가
//   없어 0 실행(데이터 의존이라 NOP 으로 못 뚫음)을 단언한다. 게이트가 단일 if 였다면 이 호출이 실행을
//   냈을 것(취약). 엔트리가 진실이라 막힌다(GREEN).
export async function __unsafeDispatchForNopTest(ex: TowerExecutor, token: string): Promise<CommandOutcome> {
  const sealed = (ex as unknown as Record<symbol, (t: string) => Promise<CommandOutcome>>)[SEALED];
  return sealed(token);
}
