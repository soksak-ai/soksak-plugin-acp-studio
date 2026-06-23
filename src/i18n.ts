// UI 문자열 외부화 — t(key, lang) / tp(key, lang, vars) 로 소비.
// 에러 메시지·LLM 시스템 프롬프트·내부 처리용 문자열은 이 파일 대상 아님.

const strings = {
  placeholder: {
    en: "Message… (Enter to send, Shift+Enter for newline, @ to mention a model)",
    ko: "메시지… (Enter 전송, Shift+Enter 줄바꿈, @로 모델 지목)",
  },
  sendBtn: {
    en: "Send",
    ko: "전송",
  },
  statusIdle: {
    en: "Idle",
    ko: "대기",
  },
  modeFacil: {
    en: "Facil",
    ko: "진행",
  },
  modeTurn: {
    en: "Turn",
    ko: "순차",
  },
  modeSimul: {
    en: "Simul",
    ko: "동시",
  },
  crownTitle: {
    en: "Set as facilitator",
    ko: "진행자로 지정",
  },
  statusInterject: {
    en: "Interjected — reflected after current utterance ends",
    ko: "참견 — 현재 발화 종결 후 반영",
  },
  statusQueued: {
    en: "Queued — reflected after current conversation ends",
    ko: "대기 중 — 현재 대화가 끝나면 반영",
  },
  modalTitle: {
    en: "{who} is speaking",
    ko: "{who} 말하는 중",
  },
  modalMsg: {
    en: "Cut in now, or add after they finish?",
    ko: "지금 끼어들까요, 끝나면 넣을까요?",
  },
  btnCut: {
    en: "Cut now",
    ko: "지금 끊기",
  },
  btnWait: {
    en: "Add after",
    ko: "끝나면 넣기",
  },
  btnCancel: {
    en: "Cancel",
    ko: "취소",
  },
  pending: {
    en: "Responding…",
    ko: "응답 중…",
  },
  thinkBadge: {
    en: "💭 Think",
    ko: "💭 생각",
  },
  thinkBadgeTitle: {
    en: "Click to expand/collapse reasoning",
    ko: "클릭하면 리소닝 펼치기/접기",
  },
  whoMe: {
    en: "Me",
    ko: "나",
  },
  queuedTag: {
    en: " · queued",
    ko: " · 대기 중",
  },
  statusSimul: {
    en: "Responding simultaneously…",
    ko: "동시 응답 중…",
  },
  statusFacilDone: {
    en: "Facilitation cap reached — wrapping up",
    ko: "진행 한도 도달 — 마무리",
  },
  whoConversation: {
    en: "Conversation",
    ko: "대화",
  },
  towerTitle: {
    en: "AI Command",
    ko: "AI 명령",
  },
  towerSubtitle: {
    en: "Window control · Command translation · Search",
    ko: "창 제어 · 명령 변환 · 검색",
  },
  towerInputPlaceholder: {
    en: 'Type in natural language — "close the left panel and show the terminal big"',
    ko: '자연어로 입력 — "왼쪽 창 닫고 터미널 크게 보여줘"',
  },
  towerExamplesTitle: {
    en: "Window control — click to let AI run it",
    ko: "창 제어 — 클릭하면 AI가 실행",
  },
  towerPaletteTitle: {
    en: "Commands",
    ko: "명령",
  },
  towerPaletteEmpty: {
    en: "No commands match",
    ko: "일치하는 명령 없음",
  },
  towerLiveTitle: {
    en: "Live",
    ko: "라이브",
  },
  towerLiveEmpty: {
    en: "Agent stream appears here once orchestration starts.",
    ko: "오케스트레이션이 시작되면 에이전트 스트림이 여기 흐릅니다.",
  },
  towerConfirmTitle: {
    en: "Confirm dangerous command",
    ko: "위험 명령 확인",
  },
  towerConfirmDestructive: {
    en: "This will close or remove something. Run it?",
    ko: "이 명령은 닫거나 제거합니다. 실행할까요?",
  },
  towerConfirmInject: {
    en: "This will inject input or send data. Run it?",
    ko: "이 명령은 입력을 주입하거나 데이터를 보냅니다. 실행할까요?",
  },
  towerConfirmRun: {
    en: "Run",
    ko: "실행",
  },
  towerConfirmCancel: {
    en: "Cancel",
    ko: "취소",
  },
  towerRunOk: {
    en: "Done.",
    ko: "완료.",
  },
  towerRunNeedsTarget: {
    en: "No matching target found.",
    ko: "대상을 찾지 못했습니다.",
  },
  towerRunDenied: {
    en: "Cancelled.",
    ko: "취소됨.",
  },
  towerRunFailed: {
    en: "Command failed.",
    ko: "명령 실패.",
  },
  towerPlanning: {
    en: "Planning…",
    ko: "계획 세우는 중…",
  },
  towerPlanTitle: {
    en: "Plan preview — press ⏎ to run",
    ko: "계획 미리보기 — ⏎ 누르면 실행",
  },
  towerPlanRunAll: {
    en: "Run plan",
    ko: "계획 실행",
  },
  towerPlanDiscard: {
    en: "Discard",
    ko: "버리기",
  },
  towerPlanFailed: {
    en: "Could not build a runnable plan.",
    ko: "실행 가능한 계획을 만들지 못했습니다.",
  },
  towerPlanNoAgent: {
    en: "No agent connected — open a Clubhouse view first.",
    ko: "연결된 에이전트가 없습니다 — Clubhouse 뷰를 먼저 여세요.",
  },
  towerPlanDone: {
    en: "Plan executed.",
    ko: "계획 실행 완료.",
  },
  towerPlanStepDelete: {
    en: "Delete step",
    ko: "단계 삭제",
  },
  towerPlanStepUp: {
    en: "Move up",
    ko: "위로",
  },
  towerPlanStepDown: {
    en: "Move down",
    ko: "아래로",
  },
  towerPlanStepParams: {
    en: "Edit params (JSON)",
    ko: "파라미터 수정 (JSON)",
  },
  towerPlanInvalidEdit: {
    en: "Edit rejected — unknown command or address.",
    ko: "편집 거부 — 미등록 command 또는 주소.",
  },
  towerPlanBadJson: {
    en: "Invalid JSON params — kept previous value.",
    ko: "잘못된 JSON 파라미터 — 이전 값 유지.",
  },
} as const;

export type I18nKey = keyof typeof strings;

/** 순수 번역 함수 — lang 없으면 en 폴백. */
export function t(key: I18nKey, lang: string): string {
  const e = strings[key];
  return (e as Record<string, string>)[lang] ?? e.en;
}

/** 플레이스홀더({key}) 치환 포함 번역 함수. */
export function tp(key: I18nKey, lang: string, vars: Record<string, string>): string {
  let s = t(key, lang);
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
