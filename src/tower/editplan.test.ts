// editplan.ts (M9) — 편집 가능한 dry-run preview 의 순수 plan-편집 연산 (RED→GREEN, RULE 1·2·6).
//
// dry-run preview 의 step 은 commit 전에 편집된다 — delete / reorder(up/down) / param edit. 편집 결과는
//   새 PlanStep[] 이고, commit 은 *편집된* plan 을 디스패치한다(원본 아님). 미편집이면 원본 그대로.
//   편집은 순수 — 입력 배열을 변형하지 않고 새 배열을 돌려준다(불변, 멱등 단언 가능).
//
// RED 핵심: 편집 연산이 없거나(원본 그대로) 가변(원본 변형)이면 단언이 깨진다. 순수·정확 인덱싱으로 GREEN.
//   기준 미달 시 단언 약화 금지 — 구현을 고친다.

import { describe, expect, it } from "vitest";
import { deleteStep, moveStep, editParams } from "./editplan";
import type { PlanStep } from "./plan";

function plan(): PlanStep[] {
  return [
    { axis: "status", name: "status.query", params: {} },
    { axis: "command", name: "panel.close", params: { group: "g3" } },
    { axis: "command", name: "theme.apply", params: { name: "Midnight" } },
  ];
}

describe("deleteStep — step 삭제(순수)", () => {
  it("주어진 인덱스의 step 만 제거하고 나머지 순서 보존", () => {
    const out = deleteStep(plan(), 1);
    expect(out.map((s) => s.name)).toEqual(["status.query", "theme.apply"]);
  });

  it("원본 배열을 변형하지 않는다(불변)", () => {
    const p = plan();
    deleteStep(p, 0);
    expect(p.map((s) => s.name)).toEqual(["status.query", "panel.close", "theme.apply"]);
  });

  it("범위 밖 인덱스는 원본 사본을 그대로 돌려준다(무변)", () => {
    const out = deleteStep(plan(), 9);
    expect(out.map((s) => s.name)).toEqual(["status.query", "panel.close", "theme.apply"]);
  });
});

describe("moveStep — reorder up/down(순수)", () => {
  it("down: 인덱스 0 을 1 과 교환(실행 순서가 편집된 순서를 따른다)", () => {
    const out = moveStep(plan(), 0, "down");
    expect(out.map((s) => s.name)).toEqual(["panel.close", "status.query", "theme.apply"]);
  });

  it("up: 인덱스 2 를 1 과 교환", () => {
    const out = moveStep(plan(), 2, "up");
    expect(out.map((s) => s.name)).toEqual(["status.query", "theme.apply", "panel.close"]);
  });

  it("경계: 첫 step up / 마지막 step down 은 무변(범위 밖 이동 금지)", () => {
    expect(moveStep(plan(), 0, "up").map((s) => s.name)).toEqual(["status.query", "panel.close", "theme.apply"]);
    expect(moveStep(plan(), 2, "down").map((s) => s.name)).toEqual(["status.query", "panel.close", "theme.apply"]);
  });

  it("원본 배열을 변형하지 않는다(불변)", () => {
    const p = plan();
    moveStep(p, 0, "down");
    expect(p.map((s) => s.name)).toEqual(["status.query", "panel.close", "theme.apply"]);
  });
});

describe("editParams — 인라인 파라미터 수정(순수)", () => {
  it("해당 step 의 params 를 새 값으로 교체(다른 step 불변)", () => {
    const out = editParams(plan(), 2, { name: "Bare", mode: "light" });
    expect(out[2].params).toEqual({ name: "Bare", mode: "light" });
    expect(out[1].params).toEqual({ group: "g3" });
  });

  it("dom step 의 address 도 params 키로 수정 가능(주소 갱신)", () => {
    const dp: PlanStep[] = [{ axis: "dom", name: "ui.input.click", address: "win/main/chrome/tower/input" }];
    const out = editParams(dp, 0, { address: "win/main/chrome/tower/grip" });
    expect(out[0].address).toBe("win/main/chrome/tower/grip");
  });

  it("원본 step 을 변형하지 않는다(불변)", () => {
    const p = plan();
    editParams(p, 2, { name: "Bare" });
    expect(p[2].params).toEqual({ name: "Midnight" });
  });
});
