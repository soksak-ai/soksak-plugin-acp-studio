// rollback.ts (M9) — 한정·정직 rollback 의 순수 부분 (RED→GREEN, RULE 1·2·6).
//
// destructive/inject 묶음을 디스패치하기 전에 관련 view 의 status 스냅샷을 잡는다(theme/sizes 등). 묶음 중간
//   step 이 실패하면 *이미 실행된* step 들을 INVERTIBLE 한 것만 역명령으로 되돌린다 — invertibleStep 이
//   명시 invertible-map 으로 정의(theme.apply→이전 테마, pure toggle→다시 토글, panel.resize/equalize→
//   스냅샷의 이전 sizes 복원). NON-invertible(닫기로 미저장 작업 소실 등)은 가짜 복원 금지 — null 반환.
//
// RULE 2(절대): 못 한 복원을 했다고 거짓말하지 않는다. invertibleStep 이 null 이면 그 step 은 unrestorable.
//   기준 미달 시 단언 약화 금지 — 구현을 고친다.

import { describe, expect, it } from "vitest";
import { invertibleStep, planRollback, type RollbackSnapshot } from "./rollback";
import type { PlanStep } from "./plan";

// 스냅샷 — destructive 묶음 직전에 잡은 복원 기준값(이전 테마/모드, split 별 이전 sizes).
function snap(): RollbackSnapshot {
  return {
    theme: { name: "Cupertino", mode: "dark" },
    sizes: { s1: [0.6, 0.4] },
  };
}

describe("invertibleStep — 명시 invertible-map(순수)", () => {
  it("theme.apply → 스냅샷의 이전 테마로 되돌리는 inverse(invertible)", () => {
    const s: PlanStep = { axis: "command", name: "theme.apply", params: { name: "Midnight", mode: "light" } };
    const inv = invertibleStep(s, snap());
    expect(inv).toEqual({ axis: "command", name: "theme.apply", params: { name: "Cupertino", mode: "dark" } });
  });

  it("pure toggle → 다시 토글(같은 command 재실행 = 원위치, invertible)", () => {
    const s: PlanStep = { axis: "command", name: "project.sidebar.toggle", params: {} };
    const inv = invertibleStep(s, snap());
    expect(inv).toEqual({ axis: "command", name: "project.sidebar.toggle", params: {} });
  });

  it("panel.resize → 스냅샷의 이전 sizes 로 복원(invertible)", () => {
    const s: PlanStep = { axis: "command", name: "panel.resize", params: { split: "s1", sizes: [0.2, 0.8] } };
    const inv = invertibleStep(s, snap());
    expect(inv).toEqual({ axis: "command", name: "panel.resize", params: { split: "s1", sizes: [0.6, 0.4] } });
  });

  it("panel.equalize → 스냅샷의 이전 sizes 로 panel.resize 복원(invertible)", () => {
    const s: PlanStep = { axis: "command", name: "panel.equalize", params: { split: "s1" } };
    const inv = invertibleStep(s, snap());
    expect(inv).toEqual({ axis: "command", name: "panel.resize", params: { split: "s1", sizes: [0.6, 0.4] } });
  });

  it("NON-invertible 닫기(panel.close)는 null — 가짜 복원 금지(정직)", () => {
    const s: PlanStep = { axis: "command", name: "panel.close", params: { group: "g3" } };
    expect(invertibleStep(s, snap())).toBeNull();
  });

  it("NON-invertible view.close/editor.close/window.close/data.import 전부 null", () => {
    for (const name of ["view.close", "editor.close", "window.close", "data.import", "secret.delete"]) {
      expect(invertibleStep({ axis: "command", name, params: {} }, snap())).toBeNull();
    }
  });

  it("이전 sizes 가 스냅샷에 없으면 resize 도 복원 불가 — null(추측 복원 금지)", () => {
    const s: PlanStep = { axis: "command", name: "panel.resize", params: { split: "sX", sizes: [0.2, 0.8] } };
    expect(invertibleStep(s, snap())).toBeNull();
  });
});

describe("planRollback — 이미 실행된 step 들의 역계획(순수, 정직)", () => {
  it("실행된 invertible step 들만 역순 inverse, non-invertible 은 unrestorable 로 분리", () => {
    const executed: PlanStep[] = [
      { axis: "command", name: "theme.apply", params: { name: "Midnight" } }, // invertible
      { axis: "command", name: "panel.close", params: { group: "g3" } }, // non-invertible(실패 직전 성공)
    ];
    const rb = planRollback(executed, snap());
    // 역순(가장 최근 실행부터) — 단, panel.close 는 inverse 불가 → unrestorable, theme.apply 만 inverse.
    expect(rb.inverse.map((s) => s.name)).toEqual(["theme.apply"]);
    expect(rb.inverse[0].params).toEqual({ name: "Cupertino", mode: "dark" });
    expect(rb.unrestorable.map((s) => s.name)).toEqual(["panel.close"]);
  });

  it("status(read) step 은 rollback 대상 아님(부수효과 0 — inverse·unrestorable 양쪽에서 제외)", () => {
    const executed: PlanStep[] = [
      { axis: "status", name: "status.query", params: {} },
      { axis: "command", name: "theme.apply", params: { name: "Midnight" } },
    ];
    const rb = planRollback(executed, snap());
    expect(rb.inverse.map((s) => s.name)).toEqual(["theme.apply"]);
    expect(rb.unrestorable).toEqual([]);
  });

  it("전부 invertible → unrestorable 비고, 역순 inverse", () => {
    const executed: PlanStep[] = [
      { axis: "command", name: "theme.apply", params: { name: "Midnight" } },
      { axis: "command", name: "panel.resize", params: { split: "s1", sizes: [0.1, 0.9] } },
    ];
    const rb = planRollback(executed, snap());
    // 역순 — 마지막 실행(panel.resize)부터 되돌린다.
    expect(rb.inverse.map((s) => s.name)).toEqual(["panel.resize", "theme.apply"]);
    expect(rb.unrestorable).toEqual([]);
  });
});
