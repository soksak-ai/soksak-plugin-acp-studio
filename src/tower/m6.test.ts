// M6 단위 테스트 (RED→GREEN, RULE 1·2·6). 다중 에이전트 분배 + danger 직렬 confirm 큐 + 인터럽트 +
//   executor 유일-실행점 불변식.
//
// 1. 직렬 confirm 큐: 동시(simul) 여러 plan 의 destructive step 이 동시에 confirm 을 요구해도 confirm 은
//    한 번에 정확히 하나만 열린다(FIFO). RED: 큐가 없으면 두 gatedRun 이 confirmGate 를 동시 호출 → 2개 동시.
// 2. 인터럽트: dispatch 중 pendingHuman 신호가 들어오면 현재 step 종결 후 yield, 부분 결과 보존(RED: 폐기·크래시).
// 3. 모드 분배: facil=@지목 split / turn=순차 체인 / simul=병렬 — 모드별 올바른 drive 경로(스텁 엔진).
// 4. 불변식: executor=유일 실행점 — modal/plan 은 app.commands.execute 를 직접 부르지 않는다(정적 grep).
//
// 기준 미달 시 단언 약화 금지 — 구현을 고친다(배신).

import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutor, type ExecutorDeps, type ConfirmGate } from "./executor";
import { distributePlans, type PlanFor } from "./distribute";
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

function fakeApp(over: Record<string, (p: any) => any> = {}) {
  const executed: Array<{ name: string; params: any }> = [];
  const app = {
    commands: {
      execute: vi.fn(async (name: string, params: any) => {
        if (over[name]) return over[name](params);
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

function deps(over: Partial<ExecutorDeps> = {}, appOver: Record<string, (p: any) => any> = {}) {
  const { app, executed } = fakeApp(appOver);
  const d: ExecutorDeps = { app, confirmGate: async (issue) => issue(), ...over };
  return { d, executed };
}

// 외부 deferred(테스트가 직접 해소) — 동시 confirm 의 시점을 제어한다.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// 보류된 비동기 연쇄(프라미스 then 체인 + await)를 모두 흘려보낸다 — setTimeout(매크로태스크)로 한 틱.
//   고정 microtask 카운트는 체인 깊이에 취약하므로, 큐가 정착할 때까지 매크로태스크 경계를 쓴다.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("(M6-1) danger 직렬 confirm 큐 — 동시 destructive 도 한 번에 하나만", () => {
  it("두 plan 의 destructive step 이 동시 commit 되어도 confirm 은 직렬(최대 1개 열림, FIFO)", async () => {
    // confirmGate 를 '열림 카운터' 로 — 호출 즉시 open++, 우리가 풀어줄 때까지 대기. 동시에 2개가 열리면 RED.
    let open = 0;
    let maxOpen = 0;
    const gates: Array<{ resolve: (t: string | null) => void; issue: () => string }> = [];
    const confirmGate: ConfirmGate = (issue) => {
      open++;
      maxOpen = Math.max(maxOpen, open);
      const d = deferred<string | null>();
      gates.push({ resolve: d.resolve, issue });
      return d.promise.then((tok) => {
        open--;
        return tok;
      });
    };
    const { d, executed } = deps({ confirmGate });
    const ex = createExecutor(d);

    const planA: PlanStep[] = [{ axis: "command", name: "panel.close", params: { group: "gA" } }];
    const planB: PlanStep[] = [{ axis: "command", name: "view.close", params: { view: "vB" } }];
    const rA = await ex.planAndRun("x", { injectPlan: planA });
    const rB = await ex.planAndRun("y", { injectPlan: planB });
    if (!rA.ok || !rB.ok) throw new Error("dry-run 실패");

    // 두 commit 을 동시에 시작(simul 병렬 plan 동형). 둘 다 destructive → confirm 큐로 직렬돼야 한다.
    const pA = rA.commit();
    const pB = rB.commit();

    // 보류 연쇄를 흘려 두 gatedRun 이 큐에 진입하도록 한다.
    await flush();

    // RED 의 핵심 — 이 시점에 confirmGate 가 2번 불려 2개 열렸으면 취약(maxOpen 2). 직렬이면 1.
    expect(maxOpen).toBe(1);
    expect(gates.length).toBe(1); // 첫 confirm 만 열림. 둘째는 큐 대기.

    // 첫 confirm 수락 → 첫 step 실행 → 둘째 confirm 이 비로소 열린다.
    gates[0].resolve(gates[0].issue());
    await flush();
    expect(maxOpen).toBe(1); // 여전히 동시 2개 0
    expect(gates.length).toBe(2); // 이제 둘째 confirm 열림(FIFO)

    gates[1].resolve(gates[1].issue());
    const [cA, cB] = await Promise.all([pA, pB]);
    expect(cA.ok).toBe(true);
    expect(cB.ok).toBe(true);
    // 두 destructive 모두 수락 후에야 실행. 동시 2개 confirm 은 절대 없었다.
    expect(executed.map((e) => e.name).sort()).toEqual(["panel.close", "view.close"]);
    expect(maxOpen).toBe(1);
  });

  it("큐 도중 거부된 confirm 은 그 plan 만 실패, 다음 confirm 은 정상 진행", async () => {
    const gates: Array<{ resolve: (t: string | null) => void; issue: () => string }> = [];
    const confirmGate: ConfirmGate = (issue) =>
      new Promise<string | null>((resolve) => gates.push({ resolve, issue }));
    const { d, executed } = deps({ confirmGate });
    const ex = createExecutor(d);
    const rA = await ex.planAndRun("x", { injectPlan: [{ axis: "command", name: "panel.close", params: { group: "gA" } }] });
    const rB = await ex.planAndRun("y", { injectPlan: [{ axis: "command", name: "view.close", params: { view: "vB" } }] });
    if (!rA.ok || !rB.ok) throw new Error("dry-run");
    const pA = rA.commit();
    const pB = rB.commit();
    await flush();
    expect(gates.length).toBe(1);
    gates[0].resolve(null); // 첫 plan 거부
    await flush();
    expect(gates.length).toBe(2); // 거부돼도 다음 confirm 은 열린다(큐 막힘 0)
    gates[1].resolve(gates[1].issue());
    const [cA, cB] = await Promise.all([pA, pB]);
    expect(cA.ok).toBe(false); // 거부된 plan
    expect(cB.ok).toBe(true);
    expect(executed.map((e) => e.name)).toEqual(["view.close"]); // 첫 plan 미실행
  });
});

describe("(M6-2) 인터럽트(pendingHuman) — dispatch 중 끊겨도 현재 step 종결 + 부분 보존", () => {
  it("두 번째 step 직전 yield 신호 → 첫 step 결과 보존, 나머지 미실행", async () => {
    let yielded = false;
    const { d, executed } = deps();
    const ex = createExecutor(d);
    const res = await ex.planAndRun("x", {
      injectPlan: [
        { axis: "command", name: "panel.equalize", params: { split: "s1" } }, // 비파괴
        { axis: "command", name: "theme.apply", params: { name: "Cupertino" } },
      ],
    });
    if (!res.ok) throw new Error("dry-run");
    // shouldYield: 첫 step 이후 인터럽트가 들어온 것으로 모사.
    const commit = await res.commit({
      shouldYield: () => {
        const y = yielded;
        yielded = true; // 첫 호출(첫 step 후)부터 yield
        return y;
      },
    });
    // 첫 step 은 실행·보존, 둘째 step 은 yield 로 미실행. 크래시·전체폐기 아님.
    expect(commit.results).toBeDefined();
    expect(commit.results!.map((r) => r.step.name)).toEqual(["panel.equalize"]);
    expect(commit.yielded).toBe(true);
    expect(executed.map((e) => e.name)).toEqual(["panel.equalize"]); // 부분 실행 보존
  });

  it("yield 신호 없으면 전체 실행(긍정·대조)", async () => {
    const { d, executed } = deps();
    const ex = createExecutor(d);
    const res = await ex.planAndRun("x", {
      injectPlan: [
        { axis: "command", name: "panel.equalize", params: { split: "s1" } },
        { axis: "command", name: "theme.apply", params: { name: "Cupertino" } },
      ],
    });
    if (!res.ok) throw new Error("dry-run");
    const commit = await res.commit({ shouldYield: () => false });
    expect(commit.ok).toBe(true);
    expect(commit.yielded).toBeFalsy();
    expect(executed.map((e) => e.name)).toEqual(["panel.equalize", "theme.apply"]);
  });
});

describe("(M6-3) 모드 분배 — facil split / turn 순차 / simul 병렬", () => {
  const roster = ["claude", "codex", "gemini"];
  const nameOf = (id: string) => ({ claude: "Claude", codex: "Codex", gemini: "Gemini" })[id] ?? id;

  it("simul — 체크된 각 에이전트가 독립 plan 을 병렬로 제안(planner 각 1회)", async () => {
    const calls: string[] = [];
    const planFor: PlanFor = vi.fn(async (agentId: string) => {
      calls.push(agentId);
      return JSON.stringify([{ axis: "command", name: "theme.apply", params: { who: agentId } }]);
    });
    const r = await distributePlans({
      mode: "simul",
      participants: roster,
      facilitatorId: "claude",
      nameOf,
      planFor,
    });
    expect(r.mode).toBe("simul");
    // 각 에이전트가 자기 plan — 3개(병렬, 독립).
    expect(r.plans.map((p) => p.agentId).sort()).toEqual(["claude", "codex", "gemini"]);
    expect(calls.sort()).toEqual(["claude", "codex", "gemini"]);
  });

  it("turn — 순차 체인: 각 에이전트가 앞 에이전트 plan 을 맥락으로 1회씩(round-robin 1바퀴)", async () => {
    const order: string[] = [];
    const seenContext: Record<string, boolean> = {};
    const planFor: PlanFor = vi.fn(async (agentId: string, _sys: string, ctx?: string) => {
      order.push(agentId);
      // 앞 에이전트의 plan 이 컨텍스트(ctx)로 흘러온다(의존 체인).
      seenContext[agentId] = !!(ctx && ctx.length);
      return JSON.stringify([{ axis: "command", name: "panel.resize", params: { step: agentId } }]);
    });
    const r = await distributePlans({
      mode: "turn",
      participants: roster,
      facilitatorId: "claude",
      nameOf,
      planFor,
    });
    expect(r.mode).toBe("turn");
    expect(order).toEqual(["claude", "codex", "gemini"]); // 탭 순서 1바퀴
    // 둘째·셋째는 앞 plan 을 컨텍스트로 받았다(의존 체인). 첫째는 빈 컨텍스트.
    expect(seenContext.claude).toBe(false);
    expect(seenContext.codex).toBe(true);
    expect(seenContext.gemini).toBe(true);
  });

  it("facil — 진행자만 호출되고, @지목으로 도메인 동료에게 분배(plans 가 지목된 동료에 귀속)", async () => {
    const calls: string[] = [];
    const planFor: PlanFor = vi.fn(async (agentId: string) => {
      calls.push(agentId);
      // 진행자가 @지목으로 도메인 분배(codex=터미널, gemini=브라우저). plan step 은 각 동료 명의로.
      return JSON.stringify([
        { axis: "command", name: "panel.close", params: { for: "@Codex" }, assignee: "codex" },
        { axis: "command", name: "theme.apply", params: { for: "@Gemini" }, assignee: "gemini" },
      ]);
    });
    const r = await distributePlans({
      mode: "facil",
      participants: roster,
      facilitatorId: "claude",
      nameOf,
      planFor,
    });
    expect(r.mode).toBe("facil");
    // 진행자(claude)만 planning 턴 — 동료는 진행자가 @지목으로 분배(별도 호출 0).
    expect(calls).toEqual(["claude"]);
    // 분배 결과 — step 의 assignee(@지목)대로 동료에 귀속.
    const byAgent = Object.fromEntries(r.plans.map((p) => [p.agentId, p.steps.length]));
    expect(byAgent.codex).toBe(1);
    expect(byAgent.gemini).toBe(1);
  });

  it("단일 에이전트(1명만 체크)면 모드 무관 단일 plan(M5 기본 유지)", async () => {
    const planFor: PlanFor = vi.fn(async (agentId: string) =>
      JSON.stringify([{ axis: "command", name: "theme.apply", params: { who: agentId } }]),
    );
    for (const mode of ["facil", "turn", "simul"] as const) {
      const r = await distributePlans({
        mode,
        participants: ["claude"],
        facilitatorId: "claude",
        nameOf,
        planFor,
      });
      expect(r.plans).toHaveLength(1);
      expect(r.plans[0].agentId).toBe("claude");
    }
  });
});

describe("(M6-4) 불변식 — executor 가 유일 실행점(정적 grep)", () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it("modal.ts·plan.ts·distribute.ts·header.ts 는 app.commands.execute 를 직접 부르지 않는다", () => {
    // executor.ts·engine.ts 만이 app.commands.execute 를 호출하는 단일 실행점. 그 외 tower 모듈에서
    //   직접 호출이 발견되면 게이트 우회 회귀 — RED. (state.commands 라이브 fetch 는 read 라 modal 이
    //   직접 부를 수 있으나, plan dispatch 경로의 execute 는 executor 만.) 여기선 dispatch 류 호출만 잡는다.
    const files = ["modal.ts", "plan.ts", "distribute.ts", "header.ts"];
    for (const f of files) {
      const src = readFileSync(join(here, f), "utf8");
      // 주석 제거 후 실행 코드만 검사(설명 주석의 'app.commands.execute' 언급은 허용).
      const code = stripComments(src);
      const offenders = code
        .split("\n")
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /\bapp\.commands\.execute\b/.test(l));
      // modal.ts 는 팔레트 라이브 read(state.commands) 1곳만 허용 — dispatch 류(panel.*/ui.input.* 등)는 0.
      const disallowed = offenders.filter(({ l }) => !/state\.commands/.test(l));
      expect(disallowed.map((o) => `${f}:${o.i + 1}: ${o.l.trim()}`)).toEqual([]);
    }
  });

  it("executor.ts 만이 dispatch 실행 호출(app.commands.execute)을 보유한다(단일점 확인)", () => {
    const src = readFileSync(join(here, "executor.ts"), "utf8");
    expect(/\bapp\.commands\.execute\b/.test(stripComments(src))).toBe(true);
  });
});

// 라인주석(//)·블록주석(/* */) 제거(문자열 리터럴 보존은 단순화 — 본 테스트엔 충분).
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}
