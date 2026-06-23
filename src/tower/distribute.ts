// distribute.ts — 다중 에이전트 plan 분배(순수, I/O 0 — vitest 단위검증 대상). M6.
//
// slow-path 의 planning 턴을 모드에 따라 여러 에이전트에 나눈다. 실행은 여기서 0 — 분배 결과({agentId, steps})를
//   돌려주면 executor 단일 실행점이 각각 validatePlan + danger 게이트로 디스패치한다(RULE 6 단일 진실 유지).
//
//  - facil(진행): 진행자(👑) 한 명만 planning 턴 → @지목(detectMentions)으로 도메인 동료에게 step 분배.
//      각 step 의 assignee(@지목된 동료 id)대로 그 동료 plan 에 귀속. 미지목 step 은 진행자 자신에게.
//  - turn(순차): 탭 순서대로 각 1회(round-robin 1바퀴). 앞 에이전트의 plan 이 다음 에이전트의 컨텍스트로
//      흘러 의존 step 체인을 형성(verify, not poll). 각자 자기 plan.
//  - simul(동시): 체크된 각 에이전트가 frozen 도메인 스냅샷 기준으로 INDEPENDENT plan 을 병렬 제안.
//      서로의 plan 을 못 본다(스냅샷 고정). 각자 독립 plan → executor 가 confirm 직렬 큐로 안전 디스패치.
//
// 단일 에이전트(1명만 체크)면 모드 무관 단일 plan(M5 기본 default 유지).

import { parsePlan, type PlanStep } from "./plan";

// planning 턴 seam — 한 에이전트에게 systemPrompt(+ 선택적 priorContext)를 주고 PLAN 텍스트를 받는다.
//   main.ts 가 engine.requestPlan(agent, …) 으로 주입. 단위 테스트는 고정 PLAN 반환 스텁을 주입(라이브 LLM 비의존).
export type PlanFor = (agentId: string, systemPrompt: string, priorContext?: string) => Promise<string>;

export type DistMode = "turn" | "facil" | "simul";

// 분배된 한 에이전트의 plan(검증 전 raw steps). executor 가 각각 validatePlan + danger 게이트로 디스패치.
export interface AgentPlan {
  agentId: string;
  steps: PlanStep[];
}

export interface DistributeResult {
  mode: DistMode;
  plans: AgentPlan[]; // 각 에이전트(또는 진행자 분배)의 plan. 빈 plan(파싱 실패·미지목)은 제외.
}

export interface DistributeOptions {
  mode: DistMode;
  participants: string[]; // 체크된 에이전트(탭 순서) — 발화/분배 순서.
  facilitatorId: string; // 진행(facil) 모드 진행자(👑).
  nameOf: (id: string) => string;
  planFor: PlanFor;
  // planning 시스템 프롬프트 빌더(도메인맵 주입) — agentId 별로 약간 다를 수 있으나 기본은 동일 프롬프트.
  //   executor 가 buildPlanSystemPrompt(nl, map) 결과를 클로저로 넘긴다. 없으면 빈 문자열(테스트 편의).
  systemPromptFor?: (agentId: string) => string;
}

// step 의 assignee(@지목 대상) 추출 — plan step 에 명시 assignee 가 있으면 우선, 없으면 params 내 @멘션 스캔.
//   facil 분배에서 진행자가 "@Codex 는 터미널 닫아" 식으로 도메인 동료를 지정한 것을 step 귀속에 쓴다.
function stepAssignee(s: any, participants: string[], nameOf: (id: string) => string): string | null {
  if (s && typeof s.assignee === "string" && participants.includes(s.assignee)) return s.assignee;
  // params/address 텍스트에서 '@이름' 스캔(detectMentions 동형 — @ 명시 신호만).
  const hay = JSON.stringify(s ?? {}).toLowerCase();
  for (const id of participants) {
    for (const cand of [nameOf(id), id]) {
      if (hay.includes(("@" + cand).toLowerCase())) return id;
    }
  }
  return null;
}

export async function distributePlans(opts: DistributeOptions): Promise<DistributeResult> {
  const { mode, participants, facilitatorId, nameOf, planFor } = opts;
  const sys = (id: string) => (opts.systemPromptFor ? opts.systemPromptFor(id) : "");

  // 단일 에이전트 — 모드 무관 단일 plan(M5 기본 default 유지). 분배 분기 진입 안 함.
  if (participants.length <= 1) {
    const id = participants[0];
    if (!id) return { mode, plans: [] };
    const steps = parsePlan(await planFor(id, sys(id))) ?? [];
    return { mode, plans: steps.length ? [{ agentId: id, steps }] : [] };
  }

  if (mode === "simul") {
    // 동시 — 전원 frozen 스냅샷 기준 독립 plan 병렬 제안. 서로의 plan 안 봄(priorContext 0).
    const results = await Promise.all(
      participants.map(async (id) => {
        const steps = parsePlan(await planFor(id, sys(id))) ?? [];
        return { agentId: id, steps };
      }),
    );
    return { mode, plans: results.filter((p) => p.steps.length > 0) };
  }

  if (mode === "turn") {
    // 순차 — 탭 순서 1바퀴. 앞 에이전트 plan 이 다음 컨텍스트로(의존 체인). 각자 자기 plan.
    const plans: AgentPlan[] = [];
    let priorContext = "";
    for (const id of participants) {
      const raw = await planFor(id, sys(id), priorContext || undefined);
      const steps = parsePlan(raw) ?? [];
      if (steps.length) plans.push({ agentId: id, steps });
      // 다음 에이전트가 이 plan 을 의존 맥락으로 본다(이어지는 체인).
      priorContext = `${priorContext}${priorContext ? "\n" : ""}[${nameOf(id)} 의 직전 PLAN]\n${JSON.stringify(steps)}`;
    }
    return { mode, plans };
  }

  // facil(진행) — 진행자만 planning 턴 → @지목으로 도메인 동료에게 step 분배. 미지목 step 은 진행자 자신.
  const fid = participants.includes(facilitatorId) ? facilitatorId : participants[0];
  const raw = await planFor(fid, sys(fid));
  const steps = parsePlan(raw) ?? [];
  // step 별 assignee(@지목) 로 동료에 귀속. 미지목 = 진행자.
  const byAgent = new Map<string, PlanStep[]>();
  for (const s of steps) {
    const who = stepAssignee(s, participants, nameOf) ?? fid;
    const arr = byAgent.get(who) ?? [];
    // assignee 필드는 분배 메타 — 실행 plan 에선 제거(executor 가 axis/name/params 만 본다).
    const { assignee: _drop, ...clean } = s as any;
    arr.push(clean as PlanStep);
    byAgent.set(who, arr);
  }
  const plans: AgentPlan[] = [];
  // 진행자 먼저, 그다음 탭 순서 동료(분배 가시성 일관).
  for (const id of [fid, ...participants.filter((p) => p !== fid)]) {
    const arr = byAgent.get(id);
    if (arr && arr.length) plans.push({ agentId: id, steps: arr });
  }
  return { mode, plans };
}
