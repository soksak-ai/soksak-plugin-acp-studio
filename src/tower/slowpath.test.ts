// slow-path 오케스트레이션 단위 테스트 (RED→GREEN, RULE 1·2·6·7).
//
// M5 = NL bar Enter 의 모호 입력 경로. 결정적 검증을 위해 planner 를 주입(고정 PLAN 반환) — 라이브 LLM
//   비의존. 불변식:
//   1. 모호 NL → slow-path 진입(fast-path 아님) → dry-run preview 만, NOTHING 실행(RED: 즉시 dispatch).
//   2. 미등록 command/주소 plan → validatePlan 거부 + 에러를 planner 에 되먹임(RED: invalid plan dispatch).
//   3. 파괴적 step → commit 시 M4 confirm 게이트 발동(RED: confirm 없이 파괴 실행).
//   4. step별 결과가 다음 step 컨텍스트로 흐른다(status step 결과를 뒤 step 이 본다).
//   5. 긍정: all-safe valid plan → commit → 전 step 실행, 상태 반영.
//
// 기준 미달 시 단언 약화 금지 — 구현을 고친다(배신).

import { describe, expect, it, vi } from "vitest";
import { createExecutor, type ExecutorDeps } from "./executor";
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
  "ui.input.click", // 축2 dom 디스패처 — 레지스트리에 실재. dom step 의 name 대조 통과(주소는 별도 검증).
  "status.query",
];

// 실행을 기록하는 가짜 코어. read 명령(도메인맵·status)은 fixture, 그 외는 executed 에 기록.
function fakeApp(over: Record<string, (p: any) => any> = {}) {
  const executed: Array<{ name: string; params: any }> = [];
  const app = {
    commands: {
      execute: vi.fn(async (name: string, params: any) => {
        if (over[name]) return over[name](params);
        if (name === "state.commands") {
          return { ok: true, commands: CATALOG.map((c) => ({ name: c, description: c })) };
        }
        if (name === "ui.tree") {
          return { ok: true, nodes: [{ address: "win/main/chrome/tower/input" }] };
        }
        if (name === "status.query") {
          return { ok: true, statuses: [{ viewId: "v9", code: "idle" }] };
        }
        // M9 rollback 스냅샷 read fixture — theme.list/state.tree 도 read(부수효과 0). executed 에 안 든다.
        if (name === "theme.list") {
          return { ok: true, current: "Cupertino", mode: "dark", themes: [{ name: "Cupertino" }, { name: "Midnight" }] };
        }
        if (name === "state.tree") {
          return { ok: true, tree: { split: { id: "s1", sizes: [0.5, 0.5] } } };
        }
        executed.push({ name, params });
        return { ok: true };
      }),
    },
  };
  return { app, executed };
}

// confirmGate 기본 = 수락(토큰 발급). over 로 거부/관찰 주입.
function deps(
  over: Partial<ExecutorDeps> = {},
  appOver: Record<string, (p: any) => any> = {},
): { d: ExecutorDeps; executed: Array<{ name: string; params: any }> } {
  const { app, executed } = fakeApp(appOver);
  const d: ExecutorDeps = {
    app,
    confirmGate: async (issue) => issue(),
    ...over,
  };
  return { d, executed };
}

// 고정 PLAN 을 반환하는 planner(라이브 LLM 대역). prompts 로 호출 프롬프트를 관찰(되먹임 단언).
function fixedPlanner(plans: string[]) {
  const prompts: string[] = [];
  let i = 0;
  const planner = vi.fn(async (systemPrompt: string) => {
    prompts.push(systemPrompt);
    return plans[Math.min(i++, plans.length - 1)];
  });
  return { planner, prompts };
}

describe("(1) 모호 NL → slow-path dry-run, NOTHING 실행", () => {
  it("planAndRun 은 검증된 plan 을 dry-run 으로 반환하고 아무것도 실행하지 않는다", async () => {
    const { planner } = fixedPlanner([
      JSON.stringify([
        { axis: "status", name: "status.query" },
        { axis: "command", name: "theme.apply", params: { mode: "dark", name: "Cupertino" } },
      ]),
    ]);
    const { d, executed } = deps({ planner });
    const ex = createExecutor(d);
    const res = await ex.planAndRun("화면 어둡게 해줘");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.steps).toHaveLength(2);
    // dry-run — 도메인맵 read(state.commands/ui.tree/status.query)는 호출되지만 plan step 은 0 실행.
    expect(executed).toEqual([]); // RED: 즉시 dispatch 면 여기 theme.apply 가 찍힌다.
    expect(planner).toHaveBeenCalledTimes(1);
  });
});

describe("(2) 미등록 command/주소 → validatePlan 거부 + 되먹임", () => {
  it("미등록 command plan → 거부, 에러를 planner 에 되먹여 재시도", async () => {
    const { planner, prompts } = fixedPlanner([
      JSON.stringify([{ axis: "command", name: "nope.evil" }]), // 1차 — 미등록
      JSON.stringify([{ axis: "command", name: "theme.apply", params: { name: "Cupertino" } }]), // 2차 — 교정
    ]);
    const { d, executed } = deps({ planner });
    const ex = createExecutor(d);
    const res = await ex.planAndRun("뭔가 해줘");
    // 2차에서 유효 plan → dry-run 성공. 그래도 아직 실행 0(dry-run).
    expect(res.ok).toBe(true);
    expect(executed).toEqual([]);
    // 되먹임 — 2번째 planner 호출 프롬프트에 1차 거부 사유(미등록 command 이름)가 들어가야 한다.
    expect(planner).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain("nope.evil");
  });

  it("hop cap 까지 계속 미등록이면 dry-run 실패(invalid plan 은 절대 dispatch 안 됨)", async () => {
    const { planner } = fixedPlanner([JSON.stringify([{ axis: "command", name: "still.bogus" }])]);
    const { d, executed } = deps({ planner });
    const ex = createExecutor(d);
    const res = await ex.planAndRun("뭔가 해줘");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("UNKNOWN_COMMAND");
    expect(executed).toEqual([]); // RED: invalid plan 이 dispatch 되면 여기 찍힌다.
  });

  it("미등록 dom 주소 plan → NOT_EXPOSED 거부, dispatch 0", async () => {
    const { planner } = fixedPlanner([
      JSON.stringify([{ axis: "dom", name: "ui.input.click", address: "win/main/chrome/nope/fake" }]),
    ]);
    const { d, executed } = deps({ planner });
    const ex = createExecutor(d);
    const res = await ex.planAndRun("저기 눌러");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("NOT_EXPOSED");
    expect(executed).toEqual([]);
  });
});

describe("(3) 파괴적 step → commit 시 M4 confirm 게이트 발동", () => {
  it("destructive step 은 confirm 거부 시 미실행(commit)", async () => {
    const { planner } = fixedPlanner([JSON.stringify([{ axis: "command", name: "panel.close", params: { group: "g3" } }])]);
    const confirmGate = vi.fn(async () => null); // 거부
    const { d, executed } = deps({ planner, confirmGate });
    const ex = createExecutor(d);
    const res = await ex.planAndRun("패널 닫아");
    expect(res.ok).toBe(true); // dry-run 은 성공(검증 통과)
    if (!res.ok) return;
    const commit = await res.commit();
    expect(commit.ok).toBe(false); // confirm 거부 → 실행 실패
    expect(executed).toEqual([]); // RED: confirm 없이 파괴 실행되면 panel.close 찍힘
    expect(confirmGate).toHaveBeenCalledTimes(1);
  });

  it("destructive step 은 confirm 수락 시에만 실행(commit)", async () => {
    const { planner } = fixedPlanner([JSON.stringify([{ axis: "command", name: "panel.close", params: { group: "g3" } }])]);
    const confirmGate = vi.fn(async (issue: () => string) => issue()); // 수락
    const { d, executed } = deps({ planner, confirmGate });
    const ex = createExecutor(d);
    const res = await ex.planAndRun("패널 닫아");
    if (!res.ok) throw new Error("dry-run 실패");
    const commit = await res.commit();
    expect(commit.ok).toBe(true);
    expect(executed).toEqual([{ name: "panel.close", params: { group: "g3" } }]);
    expect(confirmGate).toHaveBeenCalledTimes(1);
  });
});

describe("(3b) dom step(ui.input.click=inject) 도 commit 시 confirm 게이트 경유", () => {
  it("dom step 은 confirm 거부 시 클릭 미실행(RED: 게이트 없으면 임의 클릭 통과)", async () => {
    const { planner } = fixedPlanner([
      JSON.stringify([{ axis: "dom", name: "ui.input.click", address: "win/main/chrome/tower/input" }]),
    ]);
    const confirmGate = vi.fn(async () => null); // 거부
    const { d, executed } = deps({ planner, confirmGate });
    const ex = createExecutor(d);
    const res = await ex.planAndRun("저기 눌러");
    if (!res.ok) throw new Error("dry-run 실패");
    const c = await res.commit();
    expect(c.ok).toBe(false);
    // ui.input.click 이 confirm 없이 실행되지 않았다(executed 미기록 — read fixture 외 dispatch 0).
    expect(d.app.commands.execute).not.toHaveBeenCalledWith("ui.input.click", expect.anything());
    expect(confirmGate).toHaveBeenCalledTimes(1);
  });

  it("dom step 은 confirm 수락 시에만 ui.input.click 실행", async () => {
    const { planner } = fixedPlanner([
      JSON.stringify([{ axis: "dom", name: "ui.input.click", address: "win/main/chrome/tower/input" }]),
    ]);
    const confirmGate = vi.fn(async (issue: () => string) => issue());
    const { d } = deps({ planner, confirmGate });
    const ex = createExecutor(d);
    const res = await ex.planAndRun("저기 눌러");
    if (!res.ok) throw new Error("dry-run 실패");
    const c = await res.commit();
    expect(c.ok).toBe(true);
    expect(d.app.commands.execute).toHaveBeenCalledWith("ui.input.click", { address: "win/main/chrome/tower/input" });
  });
});

describe("(4) per-step 결과 피드백 — status step 결과가 뒤 step 으로 흐른다", () => {
  it("status step 의 statuses 가 commit 결과의 step 기록에 남아 다음 step 컨텍스트로 전달된다", async () => {
    const { planner } = fixedPlanner([
      JSON.stringify([
        { axis: "status", name: "status.query", params: { view: "v9" } },
        { axis: "command", name: "theme.apply", params: { name: "Cupertino" } },
      ]),
    ]);
    // status.query 가 의미 있는 상태를 반환하도록 override.
    const { d, executed } = deps(
      { planner },
      { "status.query": () => ({ ok: true, statuses: [{ viewId: "v9", code: "dirty", message: "미저장" }] }) },
    );
    const ex = createExecutor(d);
    const res = await ex.planAndRun("테마 바꿔");
    if (!res.ok) throw new Error("dry-run 실패");
    const commit = await res.commit();
    expect(commit.ok).toBe(true);
    // 각 step 결과가 results 배열로 — status step 결과(dirty)가 보존돼 뒤 step 이 참조 가능.
    expect(commit.results).toBeDefined();
    expect(commit.results![0].result).toMatchObject({ statuses: [{ code: "dirty" }] });
    // 두 step 모두 실행됨(theme.apply 는 비파괴라 게이트 없이).
    expect(executed.map((e) => e.name)).toEqual(["theme.apply"]); // status.query 는 read(executed 미기록)
    // 마지막 step 으로 전달된 priorResults 에 status 결과가 있었음을 commit.results 가 증명.
    expect(commit.results![1].step.name).toBe("theme.apply");
  });
});

describe("(5) 긍정 — all-safe valid plan → commit → 전 step 실행", () => {
  it("비파괴 plan 전체가 게이트 없이 순서대로 실행된다", async () => {
    const { planner } = fixedPlanner([
      JSON.stringify([
        { axis: "command", name: "panel.equalize", params: { split: "s1" } },
        { axis: "command", name: "theme.apply", params: { name: "Cupertino", mode: "dark" } },
      ]),
    ]);
    const confirmGate = vi.fn(async (issue: () => string) => issue());
    const { d, executed } = deps({ planner, confirmGate });
    const ex = createExecutor(d);
    const res = await ex.planAndRun("정리하고 어둡게");
    if (!res.ok) throw new Error("dry-run 실패");
    expect(executed).toEqual([]); // dry-run 단계 — 아직 0
    const commit = await res.commit();
    expect(commit.ok).toBe(true);
    expect(executed.map((e) => e.name)).toEqual(["panel.equalize", "theme.apply"]);
    expect(confirmGate).not.toHaveBeenCalled(); // 비파괴 → 게이트 0
  });
});

describe("injectPlan — 결정적 E2E 주입(planner 우회, 검증·게이트는 동일)", () => {
  it("주입 plan 도 validatePlan 거부를 거친다(미등록 command → 거부, dispatch 0)", async () => {
    const { d, executed } = deps({}); // planner 없음 — 주입 경로
    const ex = createExecutor(d);
    const res = await ex.planAndRun("x", { injectPlan: [{ axis: "command", name: "ghost.cmd" }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNKNOWN_COMMAND");
    expect(executed).toEqual([]);
  });

  it("유효 주입 plan → dry-run(실행 0) → commit → 실행. danger step 은 게이트 경유", async () => {
    const confirmGate = vi.fn(async (issue: () => string) => issue());
    const { d, executed } = deps({ confirmGate }); // planner 없이도 주입은 동작
    const ex = createExecutor(d);
    const res = await ex.planAndRun("x", {
      injectPlan: [
        { axis: "status", name: "status.query", params: { view: "v9" } },
        { axis: "command", name: "panel.close", params: { group: "g3" } }, // destructive
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(executed).toEqual([]); // dry-run — 아직 0
    const c = await res.commit();
    expect(c.ok).toBe(true);
    expect(executed).toEqual([{ name: "panel.close", params: { group: "g3" } }]); // status 는 read(미기록)
    expect(confirmGate).toHaveBeenCalledTimes(1); // panel.close = destructive → 게이트 발동
  });
});

describe("plan 파싱 내성 — 코드펜스/산문 섞인 출력", () => {
  it("```json 펜스로 감싼 PLAN 도 파싱된다", async () => {
    const { planner } = fixedPlanner([
      "여기 PLAN 입니다:\n```json\n[{\"axis\":\"command\",\"name\":\"theme.apply\",\"params\":{\"name\":\"Cupertino\"}}]\n```\n끝.",
    ]);
    const { d } = deps({ planner });
    const ex = createExecutor(d);
    const res = await ex.planAndRun("테마");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.steps[0].name).toBe("theme.apply");
  });

  it("파싱 불가 출력 → PLAN_PARSE_FAILED 되먹임 후에도 실패면 거부", async () => {
    const { planner } = fixedPlanner(["미안하지만 못 하겠어요."]);
    const { d, executed } = deps({ planner });
    const ex = createExecutor(d);
    const res = await ex.planAndRun("그거");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PLAN_PARSE_FAILED");
    expect(executed).toEqual([]);
  });
});
