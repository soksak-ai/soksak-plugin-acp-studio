// trace.ts — 세션/trace 영속 단위 테스트 (RED→GREEN, RULE 1·7·8). M7.
//
// 불변식:
//   1. commit 된 plan → plan 레코드 + 각 step 레코드 + outcome 이 영속된다(RED: 배선 없으면 trace 비어 있음).
//   2. dry-run-discarded plan → discarded 로 기록되고 step 은 executed 로 안 남는다.
//   3. confirm 거부된 destructive step → 거부(미실행)로 기록.
//   4. 영속 — 같은 ns 의 새 trace 인스턴스(=reload 후 재조회)에서도 plan/step 이 살아 있다(RED: 인메모리면 소실).
//   5. step 순서 + per-step result/status 가 충실(의미가 바뀌면 결과가 바뀐다 — trace 가 정확).
//
// app.data 만 쓴다(ns=pluginId 격리, raw SQL 0, 코어 변경 0). 코어 커플링 없음을 fakeData(순수 메모리 KV)로 단언.
//   fakeData 는 코어 app.data 표면(define/put/get/query)을 그대로 흉내 — 같은 ns 면 인스턴스가 바뀌어도
//   같은 store 를 공유(reload 모사: store 는 디스크처럼 살아남고, trace 인스턴스만 새로 만든다).

import { describe, expect, it, vi } from "vitest";
import { createExecutor, type ExecutorDeps } from "./executor";
import { createTrace, PLANS, STEPS, type DataApi, type TraceSink } from "./trace";
import type { PlanStep } from "./plan";

// ── 가짜 app.data — 코어 데이터 표면의 순수 메모리 구현(reload 모사용 외부 store) ──
//   store 는 테스트가 보유 → 같은 store 로 trace 를 두 번 만들면 reload 후 재조회와 동형(영속 단언).
interface FakeStore {
  rows: Map<string, Map<string, Record<string, unknown>>>; // coll → id → doc(scope 무관 — ns 격리는 코어 책임).
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

// 결정적 시계 — ts 단조 증가(순서 단언이 시계 떨림에 안 흔들리게).
function clock() {
  let t = 1_000;
  return () => ++t;
}

const CATALOG = [
  "panel.close",
  "panel.equalize",
  "theme.apply",
  "view.close",
  "state.commands",
  "ui.tree",
  "status.query",
];

// 실행 기록 가짜 코어(executor 와 동일 패턴) + trace 주입.
function fakeApp() {
  const executed: Array<{ name: string; params: any }> = [];
  const app = {
    commands: {
      execute: vi.fn(async (name: string, params: any) => {
        if (name === "state.commands") return { ok: true, commands: CATALOG.map((c) => ({ name: c, description: c })) };
        if (name === "ui.tree") return { ok: true, nodes: [{ address: "win/main/chrome/tower/input" }] };
        if (name === "status.query") return { ok: true, statuses: [{ viewId: "v9", code: "idle" }] };
        // M9 rollback 스냅샷 read fixture — theme.list/state.tree 도 read(부수효과 0, executed 에 안 든다).
        if (name === "theme.list") return { ok: true, current: "Cupertino", mode: "dark", themes: [{ name: "Cupertino" }, { name: "Midnight" }] };
        if (name === "state.tree") return { ok: true, tree: { split: { id: "s1", sizes: [0.5, 0.5] } } };
        executed.push({ name, params });
        return { ok: true };
      }),
    },
  };
  return { app, executed };
}

function deps(
  trace: TraceSink,
  over: Partial<ExecutorDeps> = {},
): { d: ExecutorDeps; executed: Array<{ name: string; params: any }> } {
  const { app, executed } = fakeApp();
  const d: ExecutorDeps = {
    app,
    confirmGate: async (issue) => issue(), // 기본 수락
    trace,
    ...over,
  };
  return { d, executed };
}

describe("(1) commit 된 plan → plan + steps + outcome 영속", () => {
  it("주입 plan 을 commit 하면 plan 레코드·step 레코드·outcome=committed 가 저장된다", async () => {
    const store = newStore();
    const trace = createTrace(fakeData(store), { sessionId: "s1", now: clock() });
    const { d } = deps(trace);
    const ex = createExecutor(d);
    const plan: PlanStep[] = [
      { axis: "status", name: "status.query", params: { view: "v9" } },
      { axis: "command", name: "theme.apply", params: { name: "Cupertino", mode: "dark" } },
    ];
    const res = await ex.planAndRun("어둡게", { injectPlan: plan, trace: { nl: "어둡게", mode: "facil" } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // dry-run 단계 — 아직 trace 비어 있음(실행 0).
    expect(await trace.recentPlans({ limit: 10 })).toEqual([]); // RED: dry-run 에 기록되면 실패
    const c = await res.commit();
    expect(c.ok).toBe(true);
    const plans = await trace.recentPlans({ limit: 10 });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ nl: "어둡게", mode: "facil", outcome: "committed" });
    const steps = await trace.stepsOf(plans[0].id);
    expect(steps.map((s) => s.name)).toEqual(["status.query", "theme.apply"]);
    expect(steps.every((s) => s.status === "ok")).toBe(true);
  });
});

describe("(2) dry-run-discarded plan → discarded, step 미실행 기록", () => {
  it("commit 하지 않고 버린 plan 은 discarded 로 남고 step 은 executed 로 안 남는다", async () => {
    const store = newStore();
    const trace = createTrace(fakeData(store), { sessionId: "s1", now: clock() });
    const { d, executed } = deps(trace);
    const ex = createExecutor(d);
    const plan: PlanStep[] = [{ axis: "command", name: "theme.apply", params: { name: "Cupertino" } }];
    const res = await ex.planAndRun("테마", { injectPlan: plan, trace: { nl: "테마", mode: "turn" } });
    if (!res.ok) throw new Error("dry-run 실패");
    // commit 대신 폐기 — discard() 가 plan 을 discarded outcome 으로 기록(실행 0).
    await res.discard();
    expect(executed).toEqual([]); // 실행 0
    const plans = await trace.recentPlans({ limit: 10 });
    expect(plans).toHaveLength(1);
    expect(plans[0].outcome).toBe("dry-run-discarded");
    // step 은 실행 기록(status=ok)으로 남지 않는다 — discarded plan 은 step 0.
    const steps = await trace.stepsOf(plans[0].id);
    expect(steps).toEqual([]);
  });
});

describe("(3) confirm 거부된 destructive step → 거부(미실행) 기록", () => {
  it("destructive step 이 confirm 거부되면 trace 에 denied 로 남고 실행되지 않는다", async () => {
    const store = newStore();
    const trace = createTrace(fakeData(store), { sessionId: "s1", now: clock() });
    const confirmGate = vi.fn(async () => null); // 거부
    const { d, executed } = deps(trace, { confirmGate });
    const ex = createExecutor(d);
    const plan: PlanStep[] = [{ axis: "command", name: "panel.close", params: { group: "g3" } }];
    const res = await ex.planAndRun("패널 닫아", { injectPlan: plan, trace: { nl: "패널 닫아", mode: "facil" } });
    if (!res.ok) throw new Error("dry-run 실패");
    const c = await res.commit();
    expect(c.ok).toBe(false);
    expect(executed).toEqual([]); // 미실행
    const plans = await trace.recentPlans({ limit: 10 });
    expect(plans).toHaveLength(1);
    expect(plans[0].outcome).toBe("failed");
    const steps = await trace.stepsOf(plans[0].id);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ name: "panel.close", danger: "destructive", status: "denied" });
  });
});

describe("(4) 영속 — reload(새 trace 인스턴스)에서도 살아 있다", () => {
  it("commit 후 같은 store 의 새 trace 인스턴스가 plan·step 을 재조회한다(인메모리면 소실=RED)", async () => {
    const store = newStore();
    const trace1 = createTrace(fakeData(store), { sessionId: "s1", now: clock() });
    const { d } = deps(trace1);
    const ex = createExecutor(d);
    const plan: PlanStep[] = [
      { axis: "status", name: "status.query" },
      { axis: "command", name: "theme.apply", params: { name: "Cupertino" } },
    ];
    const res = await ex.planAndRun("x", { injectPlan: plan, trace: { nl: "테마 적용", mode: "simul" } });
    if (!res.ok) throw new Error("dry-run 실패");
    await res.commit();

    // ── reload 모사 — 같은 store(디스크 동형), 완전히 새 trace 인스턴스로 재조회 ──
    const trace2 = createTrace(fakeData(store), { sessionId: "s1", now: clock() });
    const plans = await trace2.recentPlans({ limit: 10 });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ nl: "테마 적용", mode: "simul", outcome: "committed" });
    const steps = await trace2.stepsOf(plans[0].id);
    expect(steps.map((s) => s.name)).toEqual(["status.query", "theme.apply"]);
  });
});

describe("(5) step 순서 + per-step result/status 충실", () => {
  it("seq 순서가 plan step 순서와 일치하고 각 step 의 axis/status 가 정확히 기록된다", async () => {
    const store = newStore();
    const trace = createTrace(fakeData(store), { sessionId: "s1", now: clock() });
    const { d } = deps(trace, {
      // status.query 가 dirty 를 반환하도록 — per-step result 가 그대로 보존되는지 단언.
    });
    // status override 를 위해 app 을 직접 패치.
    (d.app.commands.execute as any).mockImplementation(async (name: string, params: any) => {
      if (name === "state.commands") return { ok: true, commands: CATALOG.map((c) => ({ name: c, description: c })) };
      if (name === "ui.tree") return { ok: true, nodes: [{ address: "win/main/chrome/tower/input" }] };
      if (name === "status.query") return { ok: true, statuses: [{ viewId: "v9", code: "dirty", message: "미저장" }] };
      return { ok: true };
    });
    const ex = createExecutor(d);
    const plan: PlanStep[] = [
      { axis: "status", name: "status.query", params: { view: "v9" } },
      { axis: "command", name: "panel.equalize", params: { split: "s1" } },
      { axis: "command", name: "theme.apply", params: { name: "Midnight" } },
    ];
    const res = await ex.planAndRun("정리", { injectPlan: plan, trace: { nl: "정리", mode: "turn" } });
    if (!res.ok) throw new Error("dry-run 실패");
    await res.commit();
    const plans = await trace.recentPlans({ limit: 10 });
    const steps = await trace.stepsOf(plans[0].id);
    // 순서 충실 — seq 단조 + plan 순서 일치.
    expect(steps.map((s) => s.seq)).toEqual([0, 1, 2]);
    expect(steps.map((s) => s.axis)).toEqual(["status", "command", "command"]);
    expect(steps.map((s) => s.name)).toEqual(["status.query", "panel.equalize", "theme.apply"]);
    // status step 의 결과(dirty)가 outcome 으로 충실히 보존.
    expect(steps[0].status).toBe("ok");
    expect((steps[0].outcome as any)?.statuses?.[0]?.code).toBe("dirty");
    // command step 은 params 가 그대로 기록(투명).
    expect((steps[1].params as any)?.split).toBe("s1");
  });
});

describe("distributeAndRun 도 trace 에 plan·step·outcome 을 기록(M6 경로)", () => {
  it("simul 다중 plan commit → 각 plan + step 이 trace 에 남는다", async () => {
    const store = newStore();
    const trace = createTrace(fakeData(store), { sessionId: "s1", now: clock() });
    const { d } = deps(trace);
    const ex = createExecutor(d);
    // planFor 스텁 — 각 에이전트가 고정 plan 반환.
    const planFor = vi.fn(async (agentId: string) => {
      if (agentId === "claude") return JSON.stringify([{ axis: "command", name: "theme.apply", params: { name: "Cupertino" } }]);
      return JSON.stringify([{ axis: "command", name: "panel.equalize", params: { split: "s1" } }]);
    });
    const res = await ex.distributeAndRun("정리해줘", {
      mode: "simul",
      participants: ["claude", "codex"],
      facilitatorId: "claude",
      nameOf: (id) => id,
      planFor,
      trace: { nl: "정리해줘", mode: "simul" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = await res.commit();
    expect(c.ok).toBe(true);
    const plans = await trace.recentPlans({ limit: 10 });
    // 2 에이전트 = 2 plan 레코드(각자 agent 표기), 모두 committed.
    expect(plans).toHaveLength(2);
    expect(plans.every((p) => p.outcome === "committed")).toBe(true);
    const agents = plans.map((p) => p.agent).sort();
    expect(agents).toEqual(["claude", "codex"]);
  });
});

describe("trace collection 이름 — 플러그인 ns 격리(코어 커플링 0)", () => {
  it("plan/step 컬렉션 이름이 안정적이다(코어 테이블 아님 — app.data ns)", () => {
    expect(PLANS).toBe("tower_plans");
    expect(STEPS).toBe("tower_steps");
  });
});
