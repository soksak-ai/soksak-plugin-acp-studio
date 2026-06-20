// conversation — Studio 대화 순수 로직(앱/DOM 비의존 — vitest 단위검증 대상).
// 참여자(탭 순서)·순차 발화자·canonical 프롬프트·교환 실행·페르소나·진행자 함수.
// 실 연결/세션은 주입된 turn() 뒤로 숨긴다 — 실행 로직을 실 에이전트·인증 없이 결정적으로 검증.
//
// 모델(확정):
//  - 로스터 = 탭(드래그 정렬). 탭 순서 = 발화 순서. 체크된 것 = 참여자.
//  - 모드: turn(순차)=각 1회 탭 순서 / simul(동시)=병렬 1회 / facil(진행)=진행자가 동시/순차/선택으로 조율
//    (라이브 driveFacilitated 는 main.ts). 라운드로빈('free')은 폐기.
//  - canonical: 매 발화 [방 구성(로스터) + 전체 대화] 재주입(세션 메모리 비의존).

export interface RosterEntry {
  id: string;
  checked: boolean;
}
export type KibitzMode = "turn" | "facil" | "simul";
export interface Utterance {
  who: string; // 에이전트 id 또는 "human"
  text: string;
}

export type TurnFn = (agentId: string, prompt: string) => Promise<string>;

// 참여자 = 체크된 에이전트, 탭(배열) 순서 보존 = 발화 순서.
export function participants(roster: RosterEntry[]): string[] {
  return roster.filter((r) => r.checked).map((r) => r.id);
}

// 다음 발화자 — 참여자 각 1회(탭 순서). 한 바퀴 돌면 끝(null). 라운드로빈 폐기 — 한 라운드만.
export function nextSpeaker(parts: string[], agentTurnCount: number): string | null {
  return agentTurnCount < parts.length ? parts[agentTurnCount] : null;
}

// 진행자(facilitator) 기본값 = 체크된 첫 에이전트(탭 순서). 없으면 null. (UI 의 명시 facilitatorId 가 우선)
export function pickFacilitator(roster: RosterEntry[]): string | null {
  const p = participants(roster);
  return p.length ? p[0] : null;
}

export type FacilPattern = "simul" | "turn" | "select" | "none";
// 진행자 발화에서 오케스트레이션 지시 추출 — 다음에 누구를 어떻게 부를지.
//  targets = @지목된 동료(detectMentions 재사용). pattern: '다 같이/동시' → simul, '차례로/순차' → turn,
//  @지목만(태그 없음) → select(그 동료만), 지시 전무 → none(진행자만 답 = 마무리 신호).
export function parseFacilitatorDirective(
  text: string,
  roster: string[],
  facilitatorId: string,
  nameOf: (id: string) => string,
): { pattern: FacilPattern; targets: string[] } {
  const targets = detectMentions(text, roster, facilitatorId, nameOf);
  const simul = /\[동시\]|다\s*같이|동시에|모두\s*(답|의견|말)/.test(text);
  const seq = /\[순차\]|차례(로|대로)|순서대로|돌아가/.test(text);
  let pattern: FacilPattern;
  if (simul) pattern = "simul";
  else if (seq) pattern = "turn";
  else if (targets.length) pattern = "select";
  else pattern = "none";
  return { pattern, targets };
}

// canonical 발화 프롬프트 — 매 발화 [방 구성(로스터) + 전체 대화]를 재주입(세션 메모리 비의존). speaker 1인칭.
// preamble = 상위(페르소나)가 끼우는 지시. 없으면 기본 협업 지시(기본은 대화만 — 사용자 명시 요청 없으면 파일/명령 금지).
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
      `기본은 이 대화창에서 말로만 참여하는 것입니다. 사용자가 명시적으로 작업을 시키지 않았다면 파일을 만들거나 고치지 말고, 명령도 실행하지 마세요. 사용자가 분명히 작업을 지시한 경우에만 당신의 도구로 실제 파일을 만들거나 명령을 실행하세요.`;
  return `${base}${convo}`;
}

// driveExchange — 한 교환(참여자 각 1회, 탭 순서). 헤드리스 converse·테스트용. 라이브는 main.ts driveSequential.
// 각 발화: canonical 프롬프트 → turn(). turn() 실패/빈 응답은 그 발화만 건너뛴다(대화 지속, 견고함 규율).
// 참견(consumeInterject true)이면 그 발화 폐기 + 같은 화자 재시작. conversation 공유(in-place) — 발화는 여기서 push.
export async function driveExchange(opts: {
  roster: RosterEntry[];
  conversation: Utterance[];
  turn: TurnFn;
  consumeInterject?: () => boolean;
  nameOf?: (id: string) => string;
  preamble?: (speaker: string) => string;
  onTurnStart?: (speaker: string) => void;
  onUtterance?: (u: Utterance) => void;
  onDiscard?: (speaker: string) => void;
}): Promise<void> {
  const parts = participants(opts.roster);
  let agentTurns = 0;
  for (;;) {
    const speaker = nextSpeaker(parts, agentTurns);
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

// driveSimul — 동시(simul) 모드. 턴테이킹 없음: 전원이 같은 맥락(스냅샷)을 보고 **병렬로** 1회씩 응답.
// 서로의 동시 응답은 못 본다(스냅샷 고정). 완료 발화는 도착 순서대로 push. 참견·재시작 없음(원샷 라운드).
export async function driveSimul(opts: {
  roster: RosterEntry[];
  conversation: Utterance[];
  turn: TurnFn;
  nameOf?: (id: string) => string;
  preamble?: (speaker: string) => string;
  onTurnStart?: (speaker: string) => void;
  onUtterance?: (u: Utterance) => void;
}): Promise<void> {
  const parts = participants(opts.roster);
  const snapshot = opts.conversation.slice(); // 고정 — 전원 동일 맥락(서로의 동시 응답은 안 보임)
  await Promise.all(
    parts.map(async (speaker) => {
      opts.onTurnStart?.(speaker);
      const prompt = buildPrompt({
        roster: opts.roster,
        conversation: snapshot,
        speaker,
        nameOf: opts.nameOf,
        preamble: opts.preamble?.(speaker),
      });
      let text = "";
      try {
        text = (await opts.turn(speaker, prompt)).trim();
      } catch {
        text = ""; // 실패 → 빈 발화(건너뜀, 다른 참여자엔 영향 없음)
      }
      if (text) {
        const u: Utterance = { who: speaker, text };
        opts.conversation.push(u);
        opts.onUtterance?.(u);
      }
    }),
  );
}

// 헤드리스 1교환(참견 없음) — driveExchange 위 얇은 래퍼. 대화 복사본으로 돌리고 이번 교환의 발화만 반환.
export async function runExchange(opts: {
  roster: RosterEntry[];
  conversation: Utterance[]; // 원본 변형 안 함(복사)
  turn: TurnFn;
  nameOf?: (id: string) => string;
  preamble?: (speaker: string) => string;
  onUtterance?: (u: Utterance) => void;
}): Promise<Utterance[]> {
  const produced: Utterance[] = [];
  await driveExchange({
    roster: opts.roster,
    conversation: opts.conversation.slice(),
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

// base 방 페르소나 — 방 정체성 + 인간 그룹 대화의 결(모드 무관 공통). 모드별 발언 규범은 호출자가 덧붙인다.
function studioBase(speaker: string, others: string[], place: string, nameOf: (id: string) => string): string {
  const room = others.length
    ? `동료 ${others.join(", ")} 와(과) 당신(${nameOf(speaker)})이 함께 있습니다.`
    : `지금은 당신(${nameOf(speaker)}) 혼자입니다.`;
  const at = `@${others[0] ?? "동료"}`;
  return (
    `여기는 'Studio' — 여러 AI 코딩 에이전트가 한 워크스페이스에서 사용자의 일을 함께 하는 협업 채팅방입니다. ` +
    `${room}${place}\n` +
    `당신은 ${nameOf(speaker)} 본인으로서 자연스럽게 참여하세요:\n` +
    `- 방금 나온 말에 곧바로 반응하세요 — 동의·보충·반론·질문. 길게 독백하지 말고 짧게 주고받으세요.\n` +
    `- 이미 나온 말은 반복하지 마세요. 같은 결론이면 짧게 동의만 하고, 다르면 그 관점을 보태세요.\n` +
    `- 할 말이 없으면 침묵해도 됩니다(침묵도 참여입니다).\n` +
    `- 특정 동료의 답이 필요하면 본문에 '${at}'처럼 '@이름'으로 지목하세요.\n` +
    `- 기본은 이 대화창에서 말로만 참여하는 것입니다. 사용자가 명시적으로 작업을 시키지 않았다면 파일을 만들거나 고치지 말고, 명령도 실행하지 마세요. 사용자가 분명히 작업을 지시한 경우에만 당신의 도구로 실제 파일/명령을 처리하세요(위 작업 디렉터리 기준).\n` +
    `- 당신의 내부 절차(어떤 스킬을 쓰는지, 세션 설정·규칙 확인 등)는 대화에 적지 마세요 — 인사·의견·결과만 자연스럽게.`
  );
}

// 초대장(페르소나) — 매 발화 프롬프트의 preamble. base + 모드별 발언 규범. mode 로 turn/simul/facil-참여자 분기.
export function inviteePreamble(
  speaker: string,
  roster: string[],
  nameOf: (id: string) => string,
  cwd?: string,
  mode?: KibitzMode,
): string {
  const others = roster.filter((id) => id !== speaker).map(nameOf);
  const place = cwd ? ` 작업 디렉터리는 ${cwd} 입니다.` : "";
  const note =
    mode === "simul"
      ? `\n[동시] 지금은 모두가 같은 순간에 답합니다 — 이번 차례엔 서로의 답을 아직 못 봅니다. 되도록 상대의 말을 끝까지 듣고, 누군가 '@이름'으로 지목하면 그 동료의 답을 기다려 주세요. 강제는 아닙니다 — 자연스러우면 그대로 답하세요.`
      : mode === "turn"
        ? `\n[순차] 지금은 차례대로 한 명씩 말합니다. 당신 차례에 짧게 한마디, 남의 차례엔 경청하세요.`
        : mode === "facil"
          ? `\n[진행] 이 방은 진행자가 흐름을 조율합니다. 진행자가 당신을 부르면(또는 '@이름'으로 지목하면) 답하고, 안 불리면 나서지 말고 기다리세요.`
          : "";
  return studioBase(speaker, others, place, nameOf) + note;
}

// 진행자(facilitator) 페르소나 — 진행 모드의 진행자 전용. 사람의 단일 창구 + 동료 조율 + 종료 판단.
export function facilitatorPreamble(
  facilitator: string,
  roster: string[],
  nameOf: (id: string) => string,
  cwd?: string,
): string {
  const others = roster.filter((id) => id !== facilitator).map(nameOf);
  const place = cwd ? ` 작업 디렉터리는 ${cwd} 입니다.` : "";
  const ex = others[0] ?? "동료";
  return (
    studioBase(facilitator, others, place, nameOf) +
    `\n[진행자] 당신은 이 대화의 진행자입니다. 사람은 당신에게 말합니다.\n` +
    `- 직접 답하거나, 동료를 끌어들여 조율하세요. 부르는 법:\n` +
    `   · 다 같이(동시) — "다 같이 의견 줘요" 처럼.\n` +
    `   · 차례로(순차) — "차례로 의견 줘요" 처럼.\n` +
    `   · 특정 동료만 — "@${ex} 이건 어때?" 처럼 '@이름'으로.\n` +
    `- 동료 답이 오면 종합하고, 더 볼 게 없으면 마무리하세요. **아무도 부르지 않고 답하면 대화가 종료**됩니다.\n` +
    `- 이어갈 때는 누구를 어떻게 부를지 위 방식으로 분명히 지시하세요.`
  );
}

// @멘션 — 작업 대화에서 '@이름' 또는 '@id' 로 특정 동료를 지목(직접 답 요청). 자기 자신 제외, 등장 순서·중복 제거.
// '@' 가 명시 신호 — '@' 없는 단순 이름 언급은 호명이 아니다. roster=방 구성 전원(체크 무관 — 구경꾼도 @지목되면 깨어남).
export function detectMentions(
  text: string,
  roster: string[],
  speaker: string,
  nameOf: (id: string) => string,
): string[] {
  const hay = text.toLowerCase();
  const out: { id: string; idx: number }[] = [];
  for (const id of roster) {
    if (id === speaker) continue;
    let best = -1;
    for (const cand of [nameOf(id), id]) {
      const i = hay.indexOf(("@" + cand).toLowerCase());
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    if (best >= 0) out.push({ id, idx: best });
  }
  out.sort((a, b) => a.idx - b.idx);
  return out.map((x) => x.id);
}
