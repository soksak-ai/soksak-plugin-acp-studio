// editplan.ts — 편집 가능한 dry-run preview 의 순수 plan-편집 연산(M9). I/O 0.
//
// dry-run preview 의 step 은 commit 전에 사람이 편집한다 — delete / reorder(up/down) / param edit. 편집은
//   순수 — 입력 배열·step 을 변형하지 않고 새 PlanStep[] 를 돌려준다(불변). commit 은 *편집된* plan 을
//   디스패치한다(원본 아님). 편집된 plan 은 modal/executor 가 commit 전에 validatePlan 으로 재검증한다 —
//   미등록 command/주소를 들여놓는 편집은 거부된다(편집이 검증을 우회하지 않는다, RULE 6 단일 진실).
//
// 여기엔 검증이 없다(검증의 단일 진실은 plan.ts validatePlan). 이 모듈은 오직 "어떤 plan 으로 바뀌는가" 만
//   순수하게 계산한다 — 검증은 호출자가 같은 validatePlan 으로 한다(이중 진실 0).

import type { PlanStep } from "./plan";

// 한 step 의 얕은 복제(params 도 복제해 원본 불변 보장). dom 의 address 등 모든 필드 보존.
function cloneStep(s: PlanStep): PlanStep {
  return { ...s, ...(s.params ? { params: { ...s.params } } : {}) };
}

// 입력 plan 의 불변 사본(각 step 까지 복제). 모든 편집 연산이 이 위에서 동작한다.
function copy(steps: PlanStep[]): PlanStep[] {
  return steps.map(cloneStep);
}

// step 삭제 — index 의 step 만 제거, 나머지 순서 보존. 범위 밖이면 무변 사본(방어). 원본 불변.
export function deleteStep(steps: PlanStep[], index: number): PlanStep[] {
  const out = copy(steps);
  if (index < 0 || index >= out.length) return out;
  out.splice(index, 1);
  return out;
}

// reorder — index 의 step 을 up(앞)/down(뒤) 이웃과 교환. 경계(첫 up·마지막 down) 무변. 원본 불변.
export function moveStep(steps: PlanStep[], index: number, dir: "up" | "down"): PlanStep[] {
  const out = copy(steps);
  if (index < 0 || index >= out.length) return out;
  const target = dir === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= out.length) return out; // 범위 밖 이동 금지.
  const tmp = out[index];
  out[index] = out[target];
  out[target] = tmp;
  return out;
}

// 인라인 파라미터 수정 — index step 의 params 를 통째로 교체. dom step 은 address 키도 받아 갱신(주소 편집).
//   params 키 안에 address 가 오면 step.address 로 승격(축2 dom 검증이 step.address 를 보므로). 원본 불변.
export function editParams(steps: PlanStep[], index: number, params: Record<string, unknown>): PlanStep[] {
  const out = copy(steps);
  if (index < 0 || index >= out.length) return out;
  const s = out[index];
  const next: Record<string, unknown> = { ...params };
  if (s.axis === "dom" && typeof next.address === "string") {
    s.address = next.address as string;
    delete next.address;
  }
  s.params = next;
  return out;
}
