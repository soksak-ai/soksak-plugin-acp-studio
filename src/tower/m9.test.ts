// m9.test.ts — 편집 가능한 dry-run preview + 한정·정직 rollback 의 executor 통합 (RED→GREEN, RULE 1·2·6·7).
//
// (1) 편집 가능 preview: commit 은 *편집된* plan 을 디스패치한다(원본 아님). 편집(삭제·reorder·param)된 plan 은
//     commit 전에 동일 validatePlan 으로 재검증 — 미등록 command/주소를 들여놓는 편집은 거부(검증 우회 0).
// (2) 한정·정직 rollback: destructive/inject 묶음 디스패치 전 status 스냅샷 캡처. 묶음 중간 step 실패 시 이미
//     실행된 step 들을 INVERTIBLE 한 것만 inverse 로 복원. NON-invertible 은 가짜 복원 금지 — unrestorable
//     로 정직 보고(RULE 2). cap: 현재 plan 1건만(무한 undo 0). rollback 은 system-recovery 라 안전한 이전
//     상태 복원에 confirm 불필요하되, NEW destructive inverse 는 절대 silent 실행 금지(rollback.safeInverse).
//
// 결정적 — fakeApp 이 theme/panel 상태를 들고 실제로 바뀌고 복원되는지 단언(가짜 복원 적발). 기준 미달 시
//   단언 약화 금지 — 구현을 고친다(배신).

import { describe, expect, it, vi } from "vitest";
import { createExecutor, type ExecutorDeps, type ConfirmGate, type ConfirmInfo } from "./executor";
import { createTrace, type DataApi, PLANS } from "./trace";
import { deleteStep, moveStep, editParams } from "./editplan";
import type { PlanStep } from "./plan";

// ── 가짜 app.data(trace 영속 단언용) — reflect.test.ts / trace.test.ts 와 동형 ──
interface FakeStore {
  rows: Map<string, Map<string, Record<string, unknown>>>;
  seq: number;
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
      if (order) rows.sort((a, b) => (opts?.desc ? (b[order] as number) - (a[order] as number) : (a[order] as number) - (b[order] as number)));
      if (typeof opts?.limit === "number") rows = rows.slice(0, opts.limit);
      return rows;
    }),
  };
}

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
  "theme.list",
  "panel.list",
  "state.tree",
];

// 상태를 들고 실제로 변하는 가짜 코어 — theme 가 바뀌고 rollback 으로 되돌아오는지 단언(가짜 복원 적발).
//   destructive(panel.close 등)는 over 로 실패를 주입할 수 있다(묶음 중간 실패 모사).
function fakeApp(over: Record<string, (p: any) => any> = {}) {
  const executed: Array<{ name: string; params: any }> = [];
  const state = { themeName: "Cupertino", themeMode: "dark", sizes: { s1: [0.6, 0.4] as number[] } };
  const app = {
    commands: {
      execute: vi.fn(async (name: string, params: any) => {
        if (over[name]) {
          const r = over[name](params);
          executed.push({ name, params });
          return r;
        }
        if (name === "state.commands") return { ok: true, commands: CATALOG.map((c) => ({ name: c, description: c })) };
        if (name === "ui.tree") return { ok: true, nodes: [{ address: "win/main/chrome/tower/input" }] };
        // status.query / theme.list — rollback 스냅샷 출처(이전 테마/sizes). 라이브 상태를 반영.
        if (name === "status.query") return { ok: true, statuses: [{ viewId: "v9", code: "idle" }] };
        if (name === "theme.list")
          return { ok: true, current: state.themeName, mode: state.themeMode, themes: [{ name: "Cupertino" }, { name: "Midnight" }, { name: "Bare" }] };
        if (name === "panel.list")
          return { ok: true, panels: [{ id: "g3", active: true, rect: { sizes: state.sizes.s1 }, views: [{ id: "v9", kind: "editor" }] }] };
        if (name === "state.tree") return { ok: true, tree: { split: { id: "s1", sizes: state.sizes.s1 } } };
        // 상태 변경 command — 실제로 state 를 바꾼다(rollback 이 진짜 되돌렸는지 검증 가능).
        if (name === "theme.apply") {
          state.themeName = String(params?.name ?? state.themeName);
          if (params?.mode) state.themeMode = String(params.mode);
          executed.push({ name, params });
          return { ok: true };
        }
        if (name === "panel.resize" || name === "panel.equalize") {
          if (params?.split && Array.isArray(params?.sizes)) state.sizes[params.split as "s1"] = params.sizes;
          executed.push({ name, params });
          return { ok: true };
        }
        executed.push({ name, params });
        return { ok: true };
      }),
    },
  };
  return { app, executed, state };
}

function deps(
  over: Partial<ExecutorDeps> = {},
  appOver: Record<string, (p: any) => any> = {},
): { d: ExecutorDeps; executed: Array<{ name: string; params: any }>; state: ReturnType<typeof fakeApp>["state"]; app: any } {
  const { app, executed, state } = fakeApp(appOver);
  const d: ExecutorDeps = { app, confirmGate: async (issue) => issue(), ...over };
  return { d, executed, state, app };
}

// ── (1) 편집 가능한 dry-run preview ──
describe("(1) 편집 가능 preview — commit 은 *편집된* plan 을 디스패치(원본 아님)", () => {
  it("step 삭제 → 삭제된 step 은 절대 디스패치되지 않고 나머지만 실행", async () => {
    const original: PlanStep[] = [
      { axis: "command", name: "theme.apply", params: { name: "Midnight" } },
      { axis: "command", name: "panel.equalize", params: { split: "s1" } },
    ];
    const { d, executed } = deps();
    const ex = createExecutor(d);
    // 사람이 0번 step(theme.apply) 삭제 → 편집된 plan.
    const edited = deleteStep(original, 0);
    const res = await ex.revalidateAndRun(edited);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await res.commit();
    const names = executed.map((e) => e.name);
    // theme.apply(삭제됨)는 절대 실행 안 됨, panel.equalize 만 실행.
    expect(names).not.toContain("theme.apply");
    expect(names).toContain("panel.equalize");
  });

  it("reorder(down) → 실행 순서가 편집된 순서를 따른다(원본 순서 아님)", async () => {
    const original: PlanStep[] = [
      { axis: "command", name: "theme.apply", params: { name: "Midnight" } },
      { axis: "command", name: "panel.equalize", params: { split: "s1" } },
    ];
    const { d, executed } = deps();
    const ex = createExecutor(d);
    const edited = moveStep(original, 0, "down"); // panel.equalize 가 먼저.
    const res = await ex.revalidateAndRun(edited);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await res.commit();
    expect(executed.map((e) => e.name)).toEqual(["panel.equalize", "theme.apply"]);
  });

  it("param 편집 → 새 param 이 app.commands.execute 에 쓰인다(옛 param 아님)", async () => {
    const original: PlanStep[] = [{ axis: "command", name: "theme.apply", params: { name: "Midnight" } }];
    const { d, executed } = deps();
    const ex = createExecutor(d);
    const edited = editParams(original, 0, { name: "Bare", mode: "light" });
    const res = await ex.revalidateAndRun(edited);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await res.commit();
    const call = executed.find((e) => e.name === "theme.apply");
    expect(call?.params).toEqual({ name: "Bare", mode: "light" });
  });

  it("편집이 미등록 command/주소를 들여놓으면 재검증이 거부(편집이 검증 우회 0)", async () => {
    const original: PlanStep[] = [{ axis: "command", name: "theme.apply", params: { name: "Midnight" } }];
    const { d, executed } = deps();
    const ex = createExecutor(d);
    // param 편집은 OK 지만 command 이름 자체를 미등록으로 바꾼 악성 편집.
    const edited: PlanStep[] = [{ axis: "command", name: "totally.unknown.command", params: {} }];
    const res = await ex.revalidateAndRun(edited);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("UNKNOWN_COMMAND");
    expect(executed.filter((e) => !["state.commands", "ui.tree", "status.query", "theme.list", "panel.list", "state.tree"].includes(e.name))).toEqual([]);
  });
});

// ── (2) 한정·정직 rollback ──
describe("(2) rollback invertible — 묶음 중간 실패 시 이미 실행된 invertible step 복원", () => {
  it("2-step destructive 묶음에서 step2 실패 → step1(theme.apply, invertible)을 스냅샷 inverse 로 복원", async () => {
    // step1 = theme.apply(invertible), step2 = panel.close(실패 주입). step2 실패 → step1 rollback.
    const { d, executed, state } = deps({}, { "panel.close": () => ({ ok: false, code: "BOOM", message: "강제 실패" }) });
    const ex = createExecutor(d);
    const plan: PlanStep[] = [
      { axis: "command", name: "theme.apply", params: { name: "Midnight", mode: "light" } },
      { axis: "command", name: "panel.close", params: { group: "g3" } },
    ];
    const res = await ex.revalidateAndRun(plan);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = await res.commit();
    expect(r.ok).toBe(false); // 묶음 실패.
    // rollback 이 실제로 inverse 를 디스패치했다 — theme.apply 가 두 번(원래 Midnight, inverse Cupertino).
    const themeCalls = executed.filter((e) => e.name === "theme.apply");
    expect(themeCalls.length).toBe(2);
    expect(themeCalls[1].params).toEqual({ name: "Cupertino", mode: "dark" }); // 스냅샷 inverse.
    // 실제 상태가 복원됨(가짜 복원 적발 — state 가 진짜 Cupertino/dark 로 돌아왔는가).
    expect(state.themeName).toBe("Cupertino");
    expect(state.themeMode).toBe("dark");
    // 보고가 정직 — restored 에 theme.apply(실제 디스패치된 inverse), unrestorable 은 없음(panel.close 는 실패
    //   step 이라 미실행). RollbackResult.restored = {step, result} 형태(in-memory). inverse 결과도 ok.
    expect(r.rollback?.restored?.map((x: any) => x.step.name)).toContain("theme.apply");
    expect(r.rollback?.restored?.[0].result.ok).toBe(true);
    expect((r.rollback?.unrestorable ?? []).length).toBe(0);
  });
});

describe("(2) rollback honesty — non-invertible 실행분은 가짜 복원 금지, unrestorable 정직 보고", () => {
  it("non-invertible(panel.close)이 성공한 뒤 downstream step 실패 → unrestorable 보고, false restored 0", async () => {
    // step1 = panel.close(성공, non-invertible), step2 = view.close(실패 주입). step2 실패 → step1 은 되돌릴 수 없음.
    const { d, executed } = deps(
      {},
      { "panel.close": () => ({ ok: true }), "view.close": () => ({ ok: false, code: "BOOM", message: "강제 실패" }) },
    );
    const ex = createExecutor(d);
    const plan: PlanStep[] = [
      { axis: "command", name: "panel.close", params: { group: "g3" } },
      { axis: "command", name: "view.close", params: { view: "v9" } },
    ];
    const res = await ex.revalidateAndRun(plan);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = await res.commit();
    expect(r.ok).toBe(false);
    // panel.close 는 inverse 가 없다 → 가짜 복원 시도 0. unrestorable(PlanStep[]) 에 정직하게 든다.
    expect(r.rollback?.unrestorable?.map((s: any) => s.name)).toContain("panel.close");
    // restored({step,result}[]) 에 panel.close 가 들어가면 거짓말(RULE 2 배반) — 절대 0.
    expect((r.rollback?.restored ?? []).some((x: any) => x.step.name === "panel.close")).toBe(false);
    // panel.close 의 inverse(예: panel.split/panel.open 류)를 몰래 만들어 실행하지 않았다 — panel.close 만 1회.
    expect(executed.filter((e) => e.name === "panel.close").length).toBe(1);
  });
});

describe("(2) rollback cap — 현재 plan 1건만, 직전 plan 은 건드리지 않음(무한 undo 0)", () => {
  it("앞선 plan 에서 바꾼 theme 는 다음 plan 의 rollback 에 휩쓸리지 않는다", async () => {
    const { d, executed, state } = deps({}, { "panel.close": () => ({ ok: false, code: "BOOM", message: "실패" }) });
    const ex = createExecutor(d);
    // plan A — theme 를 Midnight 로 바꾸고 성공(rollback 없음). 이게 "직전 plan".
    const a = await ex.revalidateAndRun([{ axis: "command", name: "theme.apply", params: { name: "Midnight", mode: "light" } }]);
    expect(a.ok).toBe(true);
    if (a.ok) await a.commit();
    expect(state.themeName).toBe("Midnight");
    const beforeB = executed.length;
    // plan B — theme 를 Bare 로 바꾼 뒤 panel.close 실패 → B 의 rollback 은 B 의 theme 만 되돌린다(→ Midnight,
    //   B 시작 시 스냅샷). 절대 plan A 까지 거슬러 Cupertino 로 가지 않는다(cap = 현재 plan 1건).
    const b = await ex.revalidateAndRun([
      { axis: "command", name: "theme.apply", params: { name: "Bare", mode: "dark" } },
      { axis: "command", name: "panel.close", params: { group: "g3" } },
    ]);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const rb = await b.commit();
    expect(rb.ok).toBe(false);
    // B 의 rollback 후 theme 는 B 시작 시점(Midnight)으로 — A 의 Cupertino 가 아님.
    expect(state.themeName).toBe("Midnight");
    expect(state.themeName).not.toBe("Cupertino");
    // B 단계에서 실행된 theme.apply 는 Bare(원래) + Midnight(inverse) 둘뿐 — A 의 plan 은 재실행 0.
    const themeCallsInB = executed.slice(beforeB).filter((e) => e.name === "theme.apply").map((e) => e.params.name);
    expect(themeCallsInB).toEqual(["Bare", "Midnight"]);
  });
});

// ── (2) rollback trace 영속(M7 통합) — 무엇을 되돌렸고 못 되돌렸는지 감사에 정직하게 남는다 ──
describe("(2) rollback trace — restored/unrestorable 가 plan 레코드에 정직하게 영속된다", () => {
  it("묶음 실패 rollback 후 tower.trace 의 plan 레코드에 rollback{reason, restored, unrestorable} 기록", async () => {
    const store: FakeStore = { rows: new Map(), seq: 0 };
    let t = 1000;
    const trace = createTrace(fakeData(store), { sessionId: "sess-m9", now: () => ++t });
    // step1 = theme.apply(invertible 성공), step2 = panel.close(성공·non-invertible), step3 = view.close(실패).
    //   → step3 실패. rollback: theme.apply inverse 복원(restored), panel.close 는 unrestorable(정직).
    const { d } = deps(
      { trace },
      { "panel.close": () => ({ ok: true }), "view.close": () => ({ ok: false, code: "BOOM", message: "강제 실패" }) },
    );
    const ex = createExecutor(d);
    const res = await ex.revalidateAndRun(
      [
        { axis: "command", name: "theme.apply", params: { name: "Midnight", mode: "light" } },
        { axis: "command", name: "panel.close", params: { group: "g3" } },
        { axis: "command", name: "view.close", params: { view: "v9" } },
      ],
      { trace: { nl: "rollback audit", mode: "solo" } },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = await res.commit();
    expect(r.ok).toBe(false);
    // 영속된 plan 레코드를 조회 — rollback 필드가 정직하게 기록됐는가.
    const plans = await trace.recentPlans();
    expect(plans.length).toBe(1);
    const rb = (plans[0] as any).rollback;
    expect(rb).toBeTruthy();
    expect(rb.reason.step.name).toBe("view.close"); // 묶음을 실패시킨 원인.
    expect(rb.restored.map((s: any) => s.name)).toContain("theme.apply"); // 실제 되돌림.
    expect(rb.restored.every((s: any) => s.ok)).toBe(true);
    expect(rb.unrestorable.map((s: any) => s.name)).toContain("panel.close"); // 못 되돌림(정직).
    // 거짓말 금지 — panel.close 가 restored 에 들면 배반(RULE 2).
    expect(rb.restored.some((s: any) => s.name === "panel.close")).toBe(false);
  });
});

// ── (2) autoDenyConfirm — 헤드리스 결정적 rollback 구동(소켓 E2E 백킹). deny 만, accept 경로 0 ──
describe("(2) autoDenyConfirm — destructive 자동 거부로 결정적 rollback(헤드리스)", () => {
  it("autoDenyConfirm 묶음: theme.apply(invertible) → destructive 자동 거부 → theme rollback 복원", async () => {
    // confirmGate 가 수락이어도 autoDenyConfirm 이 우선 — destructive 는 결정적으로 거부(미실행) → rollback.
    const { d, executed, state } = deps({ confirmGate: async (issue) => issue() });
    const ex = createExecutor(d);
    const res = await ex.revalidateAndRun([
      { axis: "command", name: "theme.apply", params: { name: "Midnight", mode: "light" } },
      { axis: "command", name: "panel.close", params: { group: "g3" } },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = await res.commit({ autoDenyConfirm: true });
    expect(r.ok).toBe(false);
    // panel.close 는 autoDeny 로 미실행(executed 에 없음) — destructive 자동 승인 경로 0.
    expect(executed.some((e) => e.name === "panel.close")).toBe(false);
    // theme.apply 가 두 번(원래 Midnight + inverse Cupertino) — rollback 이 실제 복원.
    expect(executed.filter((e) => e.name === "theme.apply").length).toBe(2);
    expect(state.themeName).toBe("Cupertino");
    expect(r.rollback?.restored?.map((x: any) => x.step.name)).toContain("theme.apply");
  });
});

describe("(2) rollback 게이트 — 안전 inverse 는 confirm 불필요, NEW destructive 는 silent 실행 0", () => {
  it("rollback 의 theme.apply inverse 는 confirm 게이트를 거치지 않는다(안전한 이전 상태 복원)", async () => {
    const confirm = vi.fn((issue: () => string, _info: ConfirmInfo): Promise<string | null> => Promise.resolve(issue()));
    const { d, executed } = deps({ confirmGate: confirm as unknown as ConfirmGate }, { "panel.close": () => ({ ok: false, code: "BOOM", message: "실패" }) });
    const ex = createExecutor(d);
    const plan: PlanStep[] = [
      { axis: "command", name: "theme.apply", params: { name: "Midnight" } }, // 비파괴 → confirm 0
      { axis: "command", name: "panel.close", params: { group: "g3" } }, // destructive → confirm 1회
    ];
    const res = await ex.revalidateAndRun(plan);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    await res.commit();
    // confirm 은 panel.close 1회만(원래 묶음의 destructive). rollback 의 theme.apply inverse 는 confirm 0
    //   (안전한 이전 상태 복원 = 비파괴). 만약 rollback 이 confirm 을 또 띄웠으면 2회였을 것.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][1].command).toBe("panel.close");
    // 두 번째 theme.apply(inverse)가 실제로 실행됐다(confirm 없이) — 안전 복원.
    expect(executed.filter((e) => e.name === "theme.apply").length).toBe(2);
  });
});
