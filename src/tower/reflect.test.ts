// reflect.ts (M8) — post-execution reflection loop + guards 단위 테스트 (RED→GREEN, RULE 1·2·6·7).
//
// M5/M7 의 planAndRun 은 PRE-execution(검증) 루프뿐이다 — plan 이 validatePlan 을 통과하면 dry-run 으로 멈춘다.
// M8 은 그 다음을 더한다: plan 을 디스패치한 뒤 결과를 VERIFY 하고(step status:"failed" 런타임 실패 OR
//   goal-verify status.query 가 의도 상태 미달성을 보이면) 실패를 다음 planning 턴에 되먹여 재계획·재디스패치.
//   verify 는 status.query/step 결과로 — 폴링 0(RULE 7).
//
// 가드(RULE — computer-use step-inflation 교훈): maxSteps(초과 plan 거부) + maxReplans(재계획 상한).
//   상한 초과 → 무한루프 금지, 사람에게 ESCALATE(마지막 실패 표면).
//
// 결정적 — planner 는 스크립트된 plan 을 돌려주는 stub(라이브 LLM 비의존). 기준 미달 시 단언 약화 금지,
//   구현을 고친다(배신).

import { describe, expect, it, vi } from "vitest";
import { createExecutor, type ExecutorDeps, type CommandOutcome } from "./executor";
import { createTrace, type DataApi, type TraceSink } from "./trace";
import type { PlanStep } from "./plan";

const CATALOG = [
  "panel.close",
  "panel.resize",
  "panel.equalize",
  "theme.apply",
  "view.close",
  "editor.close",
  "state.commands",
  "ui.tree",
  "ui.input.click",
  "status.query",
];

// 실행 기록 가짜 코어. read(도메인맵·status)는 fixture, 그 외는 executed 기록 + over 로 결과 주입.
function fakeApp(over: Record<string, (p: any) => any> = {}) {
  const executed: Array<{ name: string; params: any }> = [];
  const app = {
    commands: {
      execute: vi.fn(async (name: string, params: any) => {
        if (over[name]) return over[name](params);
        if (name === "state.commands") return { ok: true, commands: CATALOG.map((c) => ({ name: c, description: c })) };
        if (name === "ui.tree") return { ok: true, nodes: [{ address: "win/main/chrome/tower/input" }] };
        if (name === "status.query") return { ok: true, statuses: [{ viewId: "v9", code: "idle" }] };
        // 예시행(fast-path) resolveParams 가 부르는 라이브 read fixture — theme.list/panel.list/state.tree.
        if (name === "theme.list") return { ok: true, current: "Cupertino", themes: [{ name: "Cupertino" }, { name: "Midnight" }] };
        if (name === "panel.list") return { ok: true, panels: [{ id: "g3", active: true, views: [{ id: "v9", kind: "editor" }] }] };
        if (name === "state.tree") return { ok: true, tree: { split: { id: "s1" } } };
        executed.push({ name, params });
        return { ok: true };
      }),
    },
  };
  return { app, executed };
}

function deps(
  over: Partial<ExecutorDeps> = {},
  appOver: Record<string, (p: any) => any> = {},
): { d: ExecutorDeps; executed: Array<{ name: string; params: any }> } {
  const { app, executed } = fakeApp(appOver);
  const d: ExecutorDeps = { app, confirmGate: async (issue) => issue(), ...over };
  return { d, executed };
}

// 스크립트된 planner — 호출 순서대로 PLAN 텍스트를 돌려준다. prompts 로 되먹임 프롬프트를 관찰.
function scriptedPlanner(plans: string[]) {
  const prompts: string[] = [];
  let i = 0;
  const planner = vi.fn(async (systemPrompt: string) => {
    prompts.push(systemPrompt);
    return plans[Math.min(i++, plans.length - 1)];
  });
  return { planner, prompts };
}

// ── 가짜 app.data(trace 영속 단언용) — trace.test.ts 와 동형 ──
interface FakeStore {
  rows: Map<string, Map<string, Record<string, unknown>>>;
  seq: number;
}
function newStore(): FakeStore {
  return { rows: new Map(), seq: 0 };
}
function fakeData(store: FakeStore): DataApi {
  const coll = (c: string) => {
    let m = store.rows.get(c);
    if (!m) {
      m = new Map();
      store.rows.set(c, m);
    }
    return m;
  };
  return {
    define: vi.fn(async () => {}),
    put: vi.fn(async (c, doc, opts) => {
      const id = opts?.id ?? `id${++store.seq}`;
      coll(c).set(id, { ...doc, id });
      return id;
    }),
    get: vi.fn(async (c, id) => coll(c).get(id) ?? null),
    query: vi.fn(async (c, opts: any) => {
      let rows = [...coll(c).values()];
      const where = (opts?.where ?? {}) as Record<string, unknown>;
      rows = rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
      const order = typeof opts?.order === "string" ? opts.order : undefined;
      if (order) {
        rows.sort((a, b) => {
          const av = a[order] as number;
          const bv = b[order] as number;
          return opts?.desc ? bv - av : av - bv;
        });
      }
      if (typeof opts?.limit === "number") rows = rows.slice(0, opts.limit);
      return rows;
    }),
  };
}
function clock() {
  let t = 1_000;
  return () => ++t;
}

// ────────────────────────────────────────────────────────────────────────────

describe("(M8-1) runtime step 실패 → 실패 컨텍스트로 재계획 → 교정 plan 성공", () => {
  it("첫 plan 의 step 이 런타임 실패하면 재계획되고(되먹임 프롬프트에 실패 사유 포함) 교정 plan 이 성공한다", async () => {
    // 1차 plan: panel.resize 가 런타임 실패(코어가 ok:false 반환). 2차 plan: theme.apply(성공).
    const { planner, prompts } = scriptedPlanner([
      JSON.stringify([{ axis: "command", name: "panel.resize", params: { split: "bad" } }]),
      JSON.stringify([{ axis: "command", name: "theme.apply", params: { name: "Cupertino" } }]),
    ]);
    // panel.resize 는 런타임 실패(특정 에러 코드/메시지) — verify 가 이 실패를 잡아 재계획해야 한다.
    const { d, executed } = deps(
      { planner },
      {
        "panel.resize": () => ({ ok: false, code: "BAD_SPLIT", message: "split 'bad' not found" }),
        "theme.apply": (p: any) => {
          executed.push({ name: "theme.apply", params: p });
          return { ok: true };
        },
      },
    );
    const ex = createExecutor(d);
    const res = await ex.reflectAndRun("정리해줘");
    expect(res.ok).toBe(true);
    expect(res.outcome).toBe("succeeded");
    // 2회 반복 — 1차(실패) + 2차(성공). RED: reflection 없으면 1회에서 실패로 끝난다(no retry).
    expect(res.iterations).toHaveLength(2);
    expect(res.iterations[0].verified).toBe(false); // 1차는 verify 실패
    expect(res.iterations[1].verified).toBe(true); // 2차는 성공
    // 되먹임 — 2번째 planner 프롬프트에 1차의 실패 step 에러가 실린다(self-correct).
    expect(planner).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain("panel.resize");
    expect(prompts[1]).toMatch(/BAD_SPLIT|split 'bad' not found/);
    // 교정 plan 의 theme.apply 가 실제로 실행됐다.
    expect(executed.some((e) => e.name === "theme.apply")).toBe(true);
  });
});

describe("(M8-2) goal-verify 실패(status.query 가 잘못된 사후 상태) → 재계획", () => {
  it("step 은 ok 지만 goalCheck status.query 가 미달성을 보이면 재계획되고 다음 plan 이 목표를 달성한다", async () => {
    // plan 자체는 ok:true 로 실행되지만, goal status.query 가 첫 시도엔 'dirty'(미달성), 두 번째엔 'idle'(달성).
    let queries = 0;
    const { planner } = scriptedPlanner([
      JSON.stringify([{ axis: "command", name: "theme.apply", params: { name: "A" } }]),
      JSON.stringify([{ axis: "command", name: "theme.apply", params: { name: "B" } }]),
    ]);
    const { d } = deps(
      { planner },
      {
        // status.query 는 도메인맵 fetch(매 hop)에도 쓰이고 goalCheck 에도 쓰인다. goalCheck 결과만 바뀌도록
        //   특정 파라미터(goal:true)로 구분 — goal 질의가 첫 번째는 dirty, 두 번째는 idle.
        "status.query": (p: any) => {
          if (p && p.goal) {
            queries++;
            return queries === 1
              ? { ok: true, statuses: [{ viewId: "v9", code: "dirty", message: "아직 목표 미달" }] }
              : { ok: true, statuses: [{ viewId: "v9", code: "idle" }] };
          }
          return { ok: true, statuses: [{ viewId: "v9", code: "idle" }] };
        },
      },
    );
    const ex = createExecutor(d);
    // goalCheck = 사후 상태 검증 step(status.query). verifyGoal 이 statuses 가 'dirty' 면 미달성으로 판정.
    const res = await ex.reflectAndRun("목표 달성해줘", {
      goalCheck: { axis: "status", name: "status.query", params: { goal: true } },
      verifyGoal: (out: CommandOutcome) =>
        !((out as any)?.statuses ?? []).some((s: any) => s.code === "dirty"),
    });
    expect(res.ok).toBe(true);
    expect(res.outcome).toBe("succeeded");
    // RED: goal-verify 없으면 1차에서 step ok 만 보고 성공 선언(잘못). 2회 반복이어야 한다.
    expect(res.iterations).toHaveLength(2);
    expect(res.iterations[0].verified).toBe(false); // step ok 지만 goal 미달
    expect(res.iterations[1].verified).toBe(true);
    expect(planner).toHaveBeenCalledTimes(2);
  });
});

describe("(M8-3) replan cap — 계속 실패하는 planner → maxReplans 에서 escalate", () => {
  it("planner 가 계속 실패 plan 만 내면 maxReplans 에서 멈추고 ESCALATE 한다(유한 반복 + 마지막 실패 표면)", async () => {
    // planner 가 항상 같은 실패 plan 을 낸다 → 영원히 verify 실패. cap 이 없으면 무한루프(RED).
    const { planner } = scriptedPlanner([
      JSON.stringify([{ axis: "command", name: "panel.resize", params: { split: "bad" } }]),
    ]);
    const { d, executed } = deps(
      { planner },
      { "panel.resize": () => ({ ok: false, code: "BAD_SPLIT", message: "split 'bad' not found" }) },
    );
    const ex = createExecutor(d);
    const res = await ex.reflectAndRun("절대 안 되는 일", { maxReplans: 3 });
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe("escalated");
    // 유한 — 초기 시도 1 + 재계획 3 = 4 회(무한 아님). RED: cap 없으면 여기 도달 못 하고 hang.
    expect(res.iterations.length).toBe(4);
    expect(res.iterations.length).toBeLessThanOrEqual(4);
    // escalation 은 마지막 실패를 사람에게 표면화한다.
    expect(res.escalation).toBeDefined();
    expect(res.escalation!.reason).toContain("개입 필요"); // "여기서 막혔습니다 — 개입 필요"
    expect(JSON.stringify(res.escalation!.lastFailure)).toMatch(/BAD_SPLIT|panel\.resize/);
    // planner 는 정확히 4회(초기 + 3 재계획) — 무한 호출 아님.
    expect(planner).toHaveBeenCalledTimes(4);
  });
});

describe("(M8-4) maxSteps 가드 — 한도 초과 plan 은 halt(디스패치 안 함)", () => {
  it("plan step 수가 maxSteps 를 넘으면 그 plan 은 거부되고 디스패치되지 않는다(RED: unbounded)", async () => {
    // 21-step plan(기본 maxSteps 20 초과). planner 가 거대 plan 을 낸다.
    const huge: PlanStep[] = Array.from({ length: 21 }, () => ({
      axis: "command" as const,
      name: "theme.apply",
      params: { name: "A" },
    }));
    const { planner } = scriptedPlanner([JSON.stringify(huge)]);
    const { d, executed } = deps({ planner });
    const ex = createExecutor(d);
    const res = await ex.reflectAndRun("거대한 일", { maxSteps: 20, maxReplans: 0 });
    expect(res.ok).toBe(false);
    // maxSteps 초과 → 디스패치 0. theme.apply 가 21번 실행되면 RED(unbounded).
    expect(executed).toEqual([]);
    // 마지막 반복이 too-many-steps 사유를 담는다.
    const last = res.iterations[res.iterations.length - 1];
    expect(last.rejected).toBe(true);
    expect(last.rejectCode).toBe("TOO_MANY_STEPS");
  });

  it("maxSteps 초과가 재계획으로 self-correct 되면 작은 plan 으로 성공한다", async () => {
    const huge: PlanStep[] = Array.from({ length: 21 }, () => ({
      axis: "command" as const,
      name: "theme.apply",
      params: { name: "A" },
    }));
    const { planner, prompts } = scriptedPlanner([
      JSON.stringify(huge), // 1차 — 초과
      JSON.stringify([{ axis: "command", name: "theme.apply", params: { name: "B" } }]), // 2차 — 작음
    ]);
    const { d, executed } = deps({ planner });
    const ex = createExecutor(d);
    const res = await ex.reflectAndRun("거대한 일", { maxSteps: 20, maxReplans: 2 });
    expect(res.ok).toBe(true);
    expect(res.outcome).toBe("succeeded");
    // 되먹임 — 2차 프롬프트에 step 한도 초과 사유가 들어간다.
    expect(prompts[1]).toMatch(/20|step|단계/);
    expect(executed.map((e) => e.name)).toEqual(["theme.apply"]);
  });
});

describe("(M8-5) fast-path 0비용 — 정확매치 fast-path 는 절대 엔진/planner 미경유", () => {
  it("예시행(정확매치) 실행은 planner 를 0회 부른다(reflection 루프 미진입)", async () => {
    const { planner } = scriptedPlanner([JSON.stringify([{ axis: "command", name: "theme.apply" }])]);
    const { d, executed } = deps({ planner });
    const ex = createExecutor(d);
    // "다음 테마로 바꿔줘" = EXAMPLE_COMMANDS[4](theme.apply, 비파괴) — fast-path 직행.
    const r = await ex.runExample(4);
    expect(r.ok).toBe(true);
    // RED: fast-path 가 reflection 루프로 라우팅되면 planner 가 불린다. 0이어야 한다.
    expect(planner).not.toHaveBeenCalled();
    expect(executed.map((e) => e.name)).toEqual(["theme.apply"]);
  });

  it("팔레트 직접 command(비파괴)도 planner 0회", async () => {
    const { planner } = scriptedPlanner([JSON.stringify([])]);
    const { d, executed } = deps({ planner });
    const ex = createExecutor(d);
    await ex.runCommand("panel.equalize", { split: "s1" });
    expect(planner).not.toHaveBeenCalled();
    expect(executed.map((e) => e.name)).toEqual(["panel.equalize"]);
  });
});

describe("(M8-6) danger 게이트 — 재계획된 destructive step 도 confirm 우회 불가", () => {
  it("재계획 plan 의 destructive step 도 confirm 게이트를 거친다(거부 → 미실행)", async () => {
    // 1차 plan: 런타임 실패. 2차 plan: destructive(panel.close) — confirm 거부 → 미실행.
    const { planner } = scriptedPlanner([
      JSON.stringify([{ axis: "command", name: "panel.resize", params: { split: "bad" } }]),
      JSON.stringify([{ axis: "command", name: "panel.close", params: { group: "g3" } }]),
    ]);
    const confirmGate = vi.fn(async () => null); // 거부
    const { d, executed } = deps(
      { planner, confirmGate },
      { "panel.resize": () => ({ ok: false, code: "BAD_SPLIT", message: "split 'bad' not found" }) },
    );
    const ex = createExecutor(d);
    const res = await ex.reflectAndRun("패널 닫아", { maxReplans: 2 });
    // panel.close 는 destructive → confirm 거부 → 미실행. 따라서 2차도 verify 실패 → 결국 escalate.
    expect(res.ok).toBe(false);
    expect(res.outcome).toBe("escalated");
    // RED: 재계획이 게이트를 우회하면 panel.close 가 confirm 없이 실행된다. executed 에 없어야 한다.
    expect(executed.some((e) => e.name === "panel.close")).toBe(false);
    expect(confirmGate).toHaveBeenCalled(); // panel.close 에서 게이트가 실제로 불렸다(우회 0).
  });

  it("재계획 destructive step 도 confirm 수락 시에만 실행(긍정 대조)", async () => {
    const { planner } = scriptedPlanner([
      JSON.stringify([{ axis: "command", name: "panel.resize", params: { split: "bad" } }]),
      JSON.stringify([{ axis: "command", name: "panel.close", params: { group: "g3" } }]),
    ]);
    const confirmGate = vi.fn(async (issue: () => string) => issue()); // 수락
    const { d, executed } = deps(
      { planner, confirmGate },
      { "panel.resize": () => ({ ok: false, code: "BAD_SPLIT", message: "x" }) },
    );
    const ex = createExecutor(d);
    const res = await ex.reflectAndRun("패널 닫아", { maxReplans: 2 });
    expect(res.ok).toBe(true);
    expect(res.outcome).toBe("succeeded");
    expect(executed.some((e) => e.name === "panel.close")).toBe(true);
    expect(confirmGate).toHaveBeenCalled();
  });
});

describe("(M8-7) trace 기록 — 재계획 반복 + escalation 이 영속된다", () => {
  it("각 재계획이 새 plan 레코드로 세션에 링크되고 escalation 이 outcome 으로 기록된다", async () => {
    const store = newStore();
    const trace: TraceSink = createTrace(fakeData(store), { sessionId: "s1", now: clock() });
    const { planner } = scriptedPlanner([
      JSON.stringify([{ axis: "command", name: "panel.resize", params: { split: "bad" } }]),
    ]);
    const { d } = deps(
      { planner, trace },
      { "panel.resize": () => ({ ok: false, code: "BAD_SPLIT", message: "split bad" }) },
    );
    const ex = createExecutor(d);
    const res = await ex.reflectAndRun("계속 실패", {
      maxReplans: 2,
      trace: { nl: "계속 실패", mode: "reflect" },
    });
    expect(res.outcome).toBe("escalated");
    const plans = await trace.recentPlans({ limit: 20 });
    // 초기 시도 1 + 재계획 2 = 3 plan 레코드(각 반복이 독립 plan). RED: 배선 0이면 trace 비어 있음.
    expect(plans.length).toBe(3);
    // 모두 같은 세션에 링크.
    expect(plans.every((p) => p.sessionId === "s1")).toBe(true);
    // 각 plan 의 step 이 기록됐다(panel.resize, status=failed).
    const steps = await trace.stepsOf(plans[0].id);
    expect(steps.some((s) => s.name === "panel.resize" && s.status === "failed")).toBe(true);
  });

  it("성공 시 — 마지막(성공) plan 의 outcome=committed, 그 전(실패) plan 들도 기록된다", async () => {
    const store = newStore();
    const trace: TraceSink = createTrace(fakeData(store), { sessionId: "s1", now: clock() });
    const { planner } = scriptedPlanner([
      JSON.stringify([{ axis: "command", name: "panel.resize", params: { split: "bad" } }]),
      JSON.stringify([{ axis: "command", name: "theme.apply", params: { name: "Cupertino" } }]),
    ]);
    const { d } = deps(
      { planner, trace },
      { "panel.resize": () => ({ ok: false, code: "BAD_SPLIT", message: "x" }) },
    );
    const ex = createExecutor(d);
    const res = await ex.reflectAndRun("결국 성공", {
      maxReplans: 3,
      trace: { nl: "결국 성공", mode: "reflect" },
    });
    expect(res.outcome).toBe("succeeded");
    const plans = await trace.recentPlans({ limit: 20 });
    expect(plans.length).toBe(2);
    const outcomes = plans.map((p) => p.outcome).sort();
    // 하나는 실패(첫 시도), 하나는 committed(교정).
    expect(outcomes).toEqual(["committed", "failed"]);
  });
});
