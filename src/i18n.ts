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
