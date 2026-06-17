// conversation — Studio 대화 순수 로직(앱/DOM 비의존 — vitest 단위검증 대상).
// 참여자(탭 순서)·참견 모드별 다음 발화자·canonical 턴 프롬프트·한 교환(exchange) 실행.
// 실 연결/세션은 주입된 turn() 뒤로 숨긴다 — 실행 로직을 실 에이전트·인증 없이 결정적으로 검증.
//
// 모델(사용자 확정):
//  - 로스터 = 탭(드래그 정렬). 탭 순서 = 턴 순서. 체크된 것 = 주요 참여자.
//  - 참견 모드: turn(턴제) = 참여자 각 1회, 탭 순서. free(자유) = 라운드 반복(끼어들기 emergent),
//    maxRounds 바퀴 안전판(강제 아님 — 호명 기반 종료는 P3에서 합류).
//  - canonical: 매 턴 [방 구성(로스터) + 전체 대화] 재주입(세션 메모리 비의존).

export interface RosterEntry {
  id: string;
  checked: boolean;
}
export type KibitzMode = "turn" | "free";
export interface Utterance {
  who: string; // 에이전트 id 또는 "human"
  text: string;
}

export type TurnFn = (agentId: string, prompt: string) => Promise<string>;

// 참여자 = 체크된 에이전트, 탭(배열) 순서 보존 = 턴 순서.
export function participants(roster: RosterEntry[]): string[] {
  return roster.filter((r) => r.checked).map((r) => r.id);
}

// 다음 발화자 — 이번 교환에서 나온 에이전트 발화 수(agentTurnCount) 기준.
//  turn: 참여자 각 1회(탭 순서). 한 바퀴 돌면 끝(null).
//  free: 탭 순서 라운드 반복, 최대 maxRounds 바퀴(폭주 방지 cap — 강제 아닌 안전판). 초과 시 끝.
export function nextSpeaker(
  parts: string[],
  mode: KibitzMode,
  agentTurnCount: number,
  maxRounds: number,
): string | null {
  if (parts.length === 0) return null;
  if (mode === "turn") return agentTurnCount < parts.length ? parts[agentTurnCount] : null;
  const cap = Math.max(1, maxRounds) * parts.length;
  return agentTurnCount < cap ? parts[agentTurnCount % parts.length] : null;
}

// canonical 턴 프롬프트 — 매 턴 [방 구성(로스터) + 전체 대화]를 재주입(세션 메모리 비의존). speaker 1인칭.
// preamble = 상위(P3 초대장 등)가 끼우는 추가 지시. 없으면 기본 협업 지시(역할 고정 X — 자기 턴에 실작업).
export function buildPrompt(opts: {
  roster: RosterEntry[];
  conversation: Utterance[];
  speaker: string;
  nameOf?: (id: string) => string;
  preamble?: string;
}): string {
  const name = (id: string) => (opts.nameOf ? opts.nameOf(id) : id);
  const others = opts.roster
    .filter((r) => r.checked && r.id !== opts.speaker)
    .map((r) => name(r.id));
  const room = others.length
    ? `이 작업공간엔 동료 ${others.join(", ")}와(과) 당신(${name(opts.speaker)})이 함께 있습니다.`
    : `지금은 당신(${name(opts.speaker)}) 혼자입니다.`;
  const lines = opts.conversation.map(
    (m) => `${m.who === "human" ? "사용자" : name(m.who)}: ${m.text}`,
  );
  const convo = lines.length ? `\n\n[지금까지의 대화]\n${lines.join("\n\n")}` : "";
  const base =
    opts.preamble ??
    `당신은 ${name(opts.speaker)}입니다. ${room} 위 대화에 이어 당신의 차례로 응답하세요. ` +
      `필요한 작업이 있으면 설명만 하지 말고 당신의 도구로 실제 파일을 만들거나 명령을 실행해 처리하세요.`;
  return `${base}${convo}`;
}

// driveExchange — 한 교환의 핵심 루프(라이브·헤드리스 공용). 참견 모드대로 참여자가 턴을 돈다. 각 턴:
// canonical 프롬프트 → turn(). turn() 실패/빈 응답은 그 발화만 건너뛴다(대화 지속, 견고함 규율).
//
// 사람 참견 — turn() 도중 사람이 끼어들면(호출자가 conversation 에 사람 메시지 append + 플래그 set),
// 그 턴 직후 consumeInterject() 가 true → 그 발화를 폐기하고 **같은 화자를 재시작**한다(턴 미advance →
// conversation 에 반영된 사람 메시지를 보고 다시 말함). 렌더·연결·cancel 은 turn()/콜백으로 분리(DOM/엔진 비의존).
// conversation 은 호출자와 공유(in-place) — 에이전트 발화는 여기서 push.
export async function driveExchange(opts: {
  roster: RosterEntry[];
  mode: KibitzMode;
  conversation: Utterance[]; // 공유(in-place) — 사람 메시지는 호출자가, 에이전트 발화는 여기서 append
  maxRounds: number;
  turn: TurnFn;
  consumeInterject?: () => boolean; // 직전 턴 중 사람 참견? (읽으며 리셋) — 없으면 참견 없음
  nameOf?: (id: string) => string;
  preamble?: (speaker: string) => string;
  onTurnStart?: (speaker: string) => void;
  onUtterance?: (u: Utterance) => void;
  onDiscard?: (speaker: string) => void; // 참견으로 폐기된 발화
}): Promise<void> {
  const parts = participants(opts.roster);
  let agentTurns = 0;
  for (;;) {
    const speaker = nextSpeaker(parts, opts.mode, agentTurns, opts.maxRounds);
    if (!speaker) break;
    opts.onTurnStart?.(speaker);
    const prompt = buildPrompt({
      roster: opts.roster,
      conversation: opts.conversation,
      speaker,
      nameOf: opts.nameOf,
      preamble: opts.preamble?.(speaker),
    });
    let text = "";
    try {
      text = (await opts.turn(speaker, prompt)).trim();
    } catch {
      text = ""; // 실패 → 빈 발화로 취급(건너뜀)
    }
    if (opts.consumeInterject?.()) {
      opts.onDiscard?.(speaker);
      continue; // 사람 참견 — 발화 폐기, 같은 화자 재시작(턴 미advance)
    }
    if (text) {
      const u: Utterance = { who: speaker, text };
      opts.conversation.push(u);
      opts.onUtterance?.(u);
    }
    agentTurns++;
  }
}

// 헤드리스 1교환(참견 없음) — driveExchange 위 얇은 래퍼. 대화 복사본으로 돌리고 이번 교환의 에이전트 발화만 반환.
export async function runExchange(opts: {
  roster: RosterEntry[];
  mode: KibitzMode;
  conversation: Utterance[]; // 원본 변형 안 함(복사)
  maxRounds: number;
  turn: TurnFn;
  nameOf?: (id: string) => string;
  preamble?: (speaker: string) => string;
  onUtterance?: (u: Utterance) => void;
}): Promise<Utterance[]> {
  const produced: Utterance[] = [];
  await driveExchange({
    roster: opts.roster,
    mode: opts.mode,
    conversation: opts.conversation.slice(),
    maxRounds: opts.maxRounds,
    turn: opts.turn,
    nameOf: opts.nameOf,
    preamble: opts.preamble,
    onUtterance: (u) => {
      produced.push(u);
      opts.onUtterance?.(u);
    },
  });
  return produced;
}
