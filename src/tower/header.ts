// 타워 타이틀바 액션 — 우상단 컨트롤 그룹(사이드바·다크모드·설정) 왼쪽에 ✦ 아웃라인 아이콘 1개를 추가.
// 클릭 = AI-명령 모달 토글. active 로 열림 상태를 강조한다(코어 PluginHeaderActions 가 .active 렌더).
//
// 코어 src/ui/headerActions.ts 의 registerHeaderAction 을 app.ui 래퍼(권한 "ui:titlebar")로 호출 —
//   icon 은 24 viewBox 기준 SVG 내부 마크업(currentColor stroke, fill 없음). 코어가 다른 타이틀바
//   아이콘과 동일한 단색 아웃라인(14px, strokeWidth 2, round cap)으로 렌더한다. label 은 폴백.
// data-node 주소(titlebar/<pluginId>/tower)는 코어가 자동 부여 — ui.tree/ui.input.click 으로 검증.

import { createTowerModal, type TowerModal } from "./modal";

// ✦ — Lucide 'sparkle' 아웃라인(단일 4-point). 24 viewBox, currentColor stroke, fill 없음.
//   다른 타이틀바 아이콘(sun/settings/panel-left)과 동일 기하라 단색 아웃라인으로 자연히 어울린다.
const SPARKLE_ICON =
  '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />';

export interface TowerHandle {
  dispose: () => void;
}

// 타워 타이틀바 액션 + 모달 셸을 설치한다. 액션 클릭이 모달을 토글하고, active 가 열림 상태를 반영.
// app = ctx.app, label = 표시 텍스트(i18n "AI 명령").
export function setupTower(app: any, label: string): TowerHandle {
  // 모달 상태 변화(열림/닫힘)는 onChange 한 채널로만 헤더 active 에 반영한다(이벤트-우선, 폴링 0).
  //   호출원(아이콘 클릭·닫기버튼·프로그램·향후 ⌘K) 무관하게 active 가 항상 정확.
  const modal: TowerModal = createTowerModal(label, () => render());

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
    dispose: () => {
      unregister?.();
      modal.dispose();
    },
  };
}
