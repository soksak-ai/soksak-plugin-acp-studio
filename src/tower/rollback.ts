// rollback.ts — 한정·정직 rollback 의 순수 부분(M9). I/O 0.
//
// destructive/inject 묶음을 디스패치하기 전 관련 view 의 status/상태 스냅샷(RollbackSnapshot)을 잡는다(이전
//   테마·모드, split 별 이전 sizes). 묶음 중간 step 이 실패하면 *이미 실행된* step 들을 INVERTIBLE 한 것만
//   역명령으로 되돌린다. INVERTIBLE 의 정의는 명시 map(추측·휴리스틱 0):
//
//   - theme.apply(X)            → theme.apply(스냅샷의 이전 테마/모드)        — 안전한 이전 상태 복원
//   - <pure toggle>.toggle()    → 같은 toggle 재실행(다시 토글 = 원위치)      — 멱등 toggle
//   - panel.resize(split,sizes) → panel.resize(split, 스냅샷의 이전 sizes)    — 이전 비율 복원
//   - panel.equalize(split)     → panel.resize(split, 스냅샷의 이전 sizes)    — 이전 비율 복원
//
//   NON-invertible(닫기로 미저장 작업 소실, 설치/제거, 비밀 삭제, 데이터 import 등)은 inverse 가 없다 —
//   invertibleStep 이 null 을 돌려준다. RULE 2(절대): 못 한 복원을 했다고 거짓말하지 않는다. null = 그
//   step 은 unrestorable 로 정직하게 보고된다(가짜 "restored" 0).
//
// ⚠️ 안전(RULE 0 매트릭스): inverse 는 "안전한 이전 상태로의 복원" 만 허용한다 — 이전 테마·이전 비율·toggle
//   원위치는 전부 비파괴(classifyDanger 미분류). 따라서 rollback 은 NEW destructive 를 만들지 않는다. 만약
//   어떤 inverse 후보가 destructive/inject 로 분류되면 그건 안전한 복원이 아니므로 inverse 에서 배제한다
//   (silent destructive inverse 금지). 이 모듈은 그런 후보를 애초에 만들지 않지만, executor 가 dispatch 직전
//   재확인한다(이중 방어).

import { classifyDanger, type PlanStep } from "./plan";

// destructive 묶음 직전 스냅샷 — 복원 기준값. status.query/theme.list/panel.list 에서 executor 가 채운다.
export interface RollbackSnapshot {
  theme?: { name: string; mode?: string }; // 이전 테마/모드(theme.apply inverse 용).
  sizes?: Record<string, number[]>; // split id → 이전 child 비율(panel.resize/equalize inverse 용).
}

// pure toggle 판별 — 이름이 ".toggle" 로 끝나고 danger 미분류면 멱등 toggle 로 본다(다시 호출 = 원위치).
//   파라미터가 토글 대상을 바꾸지 않는 단순 toggle 에 한함 — 코어 *.toggle 은 인자 없는 단순 토글(검증됨).
function isPureToggle(name: string): boolean {
  return name.endsWith(".toggle") && classifyDanger(name) === undefined;
}

// 한 실행된 step → 그 inverse step(없으면 null). 명시 map 만 — 추측 0. null = unrestorable(정직).
//   read(status)·dom 은 rollback 대상 아님(부수효과 없거나 일반화 불가) → planRollback 이 제외(여기선 null).
export function invertibleStep(step: PlanStep, snap: RollbackSnapshot): PlanStep | null {
  if (step.axis !== "command") return null; // status=read(무효과), dom=일반 inverse 불가.
  const name = step.name;

  // theme.apply → 이전 테마/모드 복원(스냅샷 필수 — 없으면 추측 금지).
  if (name === "theme.apply") {
    if (!snap.theme?.name) return null;
    const params: Record<string, unknown> = { name: snap.theme.name };
    if (snap.theme.mode) params.mode = snap.theme.mode;
    return safeInverse({ axis: "command", name: "theme.apply", params });
  }

  // panel.resize / panel.equalize → 스냅샷의 이전 sizes 로 panel.resize 복원(split 별 sizes 필수).
  if (name === "panel.resize" || name === "panel.equalize") {
    const split = step.params?.split;
    if (typeof split !== "string") return null;
    const prev = snap.sizes?.[split];
    if (!Array.isArray(prev) || !prev.length) return null; // 이전 비율 미캡처 → 추측 복원 금지.
    return safeInverse({ axis: "command", name: "panel.resize", params: { split, sizes: prev } });
  }

  // pure toggle → 같은 toggle 재실행(다시 토글 = 원위치).
  if (isPureToggle(name)) {
    return safeInverse({ axis: "command", name, params: { ...(step.params ?? {}) } });
  }

  // 그 외(닫기·설치·제거·삭제·import 등) = NON-invertible → null(정직).
  return null;
}

// inverse 후보가 안전(비파괴)한 복원인지 최종 확인 — destructive/inject 로 분류되면 inverse 에서 배제한다
//   (silent destructive inverse 금지, RULE 0). 안전한 이전 상태 복원만 통과(theme/resize/toggle 전부 비파괴).
function safeInverse(inv: PlanStep): PlanStep | null {
  return classifyDanger(inv.name) === undefined ? inv : null;
}

// rollback 계획 — 이미 실행된 step 들에서 invertible 만 역순(가장 최근 실행부터) inverse 로, non-invertible
//   command step 은 unrestorable 로 분리한다. read(status)·dom 은 양쪽에서 제외(rollback 대상 아님).
//   honesty(RULE 2): inverse 에 든 것만 "되돌릴 수 있음", unrestorable 에 든 것은 "되돌릴 수 없음" —
//   executor 가 inverse 를 실제 디스패치한 뒤 restored/unrestorable 를 정직하게 보고한다(가짜 restored 0).
export interface RollbackPlan {
  inverse: PlanStep[]; // 디스패치할 역명령(역순). 안전한 이전 상태 복원만.
  unrestorable: PlanStep[]; // 되돌릴 수 없는 원본 command step(정직 보고용 — 가짜 복원 안 함).
}

export function planRollback(executed: PlanStep[], snap: RollbackSnapshot): RollbackPlan {
  const inverse: PlanStep[] = [];
  const unrestorable: PlanStep[] = [];
  // 역순 — 마지막 실행부터 되돌린다(상태 의존 역연산의 올바른 순서).
  for (let i = executed.length - 1; i >= 0; i--) {
    const s = executed[i];
    if (s.axis !== "command") continue; // status=read·dom=대상 아님 → 양쪽 제외.
    const inv = invertibleStep(s, snap);
    if (inv) inverse.push(inv);
    else unrestorable.push(s);
  }
  return { inverse, unrestorable };
}
