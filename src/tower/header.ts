// 타워 타이틀바 액션 — 우상단 컨트롤 그룹(사이드바·다크모드·설정) 왼쪽에 ✦ 아웃라인 아이콘 1개를 추가.
// 클릭 = AI-명령 모달 토글. active 로 열림 상태를 강조한다(코어 PluginHeaderActions 가 .active 렌더).
//
// 코어 src/ui/headerActions.ts 의 registerHeaderAction 을 app.ui 래퍼(권한 "ui:titlebar")로 호출 —
//   icon 은 24 viewBox 기준 SVG 내부 마크업(currentColor stroke, fill 없음). 코어가 다른 타이틀바
//   아이콘과 동일한 단색 아웃라인(14px, strokeWidth 2, round cap)으로 렌더한다. label 은 폴백.
// data-node 주소(titlebar/<pluginId>/tower)는 코어가 자동 부여 — ui.tree/ui.input.click 으로 검증.

import { createTowerModal, type TowerModal } from "./modal";
import type { Planner, PlanRunResult, PlanRunOptions, DistRunResult, DistRunOptions } from "./executor";
import type { PlanStep } from "./plan";
import type { TraceSink } from "./trace";

// ✦ — Lucide 'sparkle' 아웃라인(단일 4-point). 24 viewBox, currentColor stroke, fill 없음.
//   다른 타이틀바 아이콘(sun/settings/panel-left)과 동일 기하라 단색 아웃라인으로 자연히 어울린다.
const SPARKLE_ICON =
  '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />';

export interface TowerHandle {
  dispose: () => void;
  // 헤드리스 slow-path 구동(노출 command·E2E) — 모달의 executor.planAndRun 직통.
  planAndRun: (nl: string, opts?: PlanRunOptions) => Promise<PlanRunResult>;
  // 다중 에이전트 분배(M6) — 모달의 executor.distributeAndRun 직통.
  distributeAndRun: (nl: string, opts: DistRunOptions) => Promise<DistRunResult>;
  // 결정적 시각 E2E — 모달 UI 에 KNOWN plan dry-run preview 렌더(snapshot 확인용).
  previewInject: (nl: string, steps: PlanStep[]) => Promise<PlanRunResult>;
}

// 타워 타이틀바 액션 + 모달(본문 포함)을 설치한다. 액션 클릭이 모달을 토글하고, active 가 열림 상태를 반영.
// app = ctx.app(모달 본문이 commands.execute/events.on/bus.on 으로 라이브 데이터를 끌어옴),
// label = 표시 텍스트(i18n "AI 명령"), lang = 현재 호스트 언어 접근자(locale.changed 로 갱신됨),
// planner = slow-path planning 턴 seam(main.ts 가 Clubhouse 엔진 requestPlan 으로 주입) — 없으면 모달이
//   slow-path 를 NO_PLANNER 로 보고(에이전트 미연결 시 정직하게).
// trace = 세션/trace 영속 sink(M7, app.data) — 모달 → executor 로 전달. 없으면 영속 0.
export function setupTower(app: any, label: string, lang: () => string, planner?: Planner, trace?: TraceSink): TowerHandle {
  // 모달 상태 변화(열림/닫힘)는 onChange 한 채널로만 헤더 active 에 반영한다(이벤트-우선, 폴링 0).
  //   호출원(아이콘 클릭·닫기버튼·프로그램·향후 ⌘K) 무관하게 active 가 항상 정확.
  const modal: TowerModal = createTowerModal({ title: label, lang, app, planner, trace, onChange: () => render() });

  // active 토글 상태를 액션에 반영하려면 같은 id 로 재등록한다(headerActions 가 id 교체 = 갱신).
  let unregister: (() => void) | null = null;
  const render = () => {
    unregister = app.ui.registerHeaderAction({
      id: "tower",
      label, // 아이콘 폴백
      icon: SPARKLE_ICON,
      title: label,
      active: modal.isOpen(),
      onClick: () => modal.toggle(), // active 갱신은 onChange → render 가 담당
    });
  };
  render();

  return {
    planAndRun: (nl: string, opts?: PlanRunOptions) => modal.planAndRun(nl, opts),
    distributeAndRun: (nl: string, opts: DistRunOptions) => modal.distributeAndRun(nl, opts),
    previewInject: (nl: string, steps: PlanStep[]) => modal.previewInject(nl, steps),
    dispose: () => {
      unregister?.();
      modal.dispose();
    },
  };
}
