import type { Utterance } from "./conversation";

// clubhouse — 사교(Clubhouse) 순수 로직(앱/DOM 비의존 — vitest 단위검증). 강제 0 emergence.
//
//  1) demux: 에이전트 응답에서 <회고>…</회고>·<잡담>…</잡담> 구간을 분리. 태그 밖 = 작업(Studio),
//     태그 안 = 사교(Clubhouse). 스트리밍 인지 — 태그가 청크 경계에 걸쳐도 작업창에 태그 원문 0.
//  2) detectSummon: 사교 발화에서 다른 동료 호명("codex, 너는?")을 탐지 → 그 모델 id.
//  3) relaySummons: 호명 연쇄(물고 물리는)를 깊이 cap 안전판 안에서 굴린다(강제 아님 — 호명 있을 때만).

export type ClubChannel = "회고" | "잡담";
export interface ClubSegment {
  kind: ClubChannel;
  text: string;
}

const CHANNELS: ClubChannel[] = ["회고", "잡담"];
const OPEN: Record<ClubChannel, string> = { 회고: "<회고>", 잡담: "<잡담>" };
const CLOSE: Record<ClubChannel, string> = { 회고: "</회고>", 잡담: "</잡담>" };

// buf 끝이 markers 중 하나의 접두사인 최대 길이(부분 태그 꼬리) — 그만큼 보류해 청크 경계 태그를 보존.
function partialTail(s: string, markers: string[]): number {
  let max = 0;
  for (const m of markers) {
    const lim = Math.min(m.length - 1, s.length);
    for (let n = lim; n > 0; n--) {
      if (s.slice(s.length - n) === m.slice(0, n)) {
        if (n > max) max = n;
        break;
      }
    }
  }
  return max;
}

// 스트리밍 인지 demux. push(chunk) → 이번에 확정된 work 텍스트(태그 밖). club 세그먼트는 내부 누적, end() 에서 회수.
export function createTagDemux() {
  let buf = "";
  let mode: "out" | ClubChannel = "out";
  let work = "";
  let clubCur = "";
  const club: ClubSegment[] = [];
  const OPENS = CHANNELS.map((k) => OPEN[k]);

  function step(final: boolean) {
    for (;;) {
      if (mode === "out") {
        let idx = -1;
        let ch: ClubChannel | null = null;
        for (const k of CHANNELS) {
          const i = buf.indexOf(OPEN[k]);
          if (i >= 0 && (idx < 0 || i < idx)) {
            idx = i;
            ch = k;
          }
        }
        if (idx >= 0 && ch) {
          work += buf.slice(0, idx);
          buf = buf.slice(idx + OPEN[ch].length);
          mode = ch;
          continue;
        }
        const hold = final ? 0 : partialTail(buf, OPENS);
        work += buf.slice(0, buf.length - hold);
        buf = buf.slice(buf.length - hold);
        return;
      }
      const close = CLOSE[mode];
      const i = buf.indexOf(close);
      if (i >= 0) {
        clubCur += buf.slice(0, i);
        buf = buf.slice(i + close.length);
        club.push({ kind: mode, text: clubCur.trim() });
        clubCur = "";
        mode = "out";
        continue;
      }
      const hold = final ? 0 : partialTail(buf, [close]);
      clubCur += buf.slice(0, buf.length - hold);
      buf = buf.slice(buf.length - hold);
      return;
    }
  }

  return {
    push(chunk: string): string {
      const before = work.length;
      buf += chunk;
      step(false);
      return work.slice(before);
    },
    end(): { work: string; club: ClubSegment[] } {
      step(true);
      // 닫히지 않은 태그(불완전) — best-effort: 누적분을 club 으로 흡수(작업 뷰 안 깨짐).
      if (mode !== "out" && clubCur.trim()) {
        club.push({ kind: mode, text: clubCur.trim() });
      }
      clubCur = "";
      mode = "out";
      return { work: work.trim(), club };
    },
  };
}

// 완전 텍스트 1회 demux(권위본 — r.text 분리). 작업 텍스트 + 사교 세그먼트.
export function demux(text: string): { work: string; club: ClubSegment[] } {
  const d = createTagDemux();
  d.push(text);
  return d.end();
}

// 호명 탐지 — 사교 발화에서 자신 외 동료의 이름이 등장하고 말 걸기 신호(물음표·권유 동사)가 있으면 그를 호명한 것.
// roster = 방 구성(id 목록), speaker = 발화자(자기 호명 제외), nameOf = 표시명. 가장 먼저 등장한 호명 대상 1명.
const ADDRESS_CUE = /[?？]|어때|어떻게|생각|봐줄|봐 줄|어찌|동의|반박|해줄|해 줄|덧붙|이어/;
export function detectSummon(
  text: string,
  roster: string[],
  speaker: string,
  nameOf: (id: string) => string,
): string | null {
  if (!ADDRESS_CUE.test(text)) return null;
  let best: { id: string; idx: number } | null = null;
  for (const id of roster) {
    if (id === speaker) continue;
    for (const cand of [nameOf(id), id]) {
      const i = text.indexOf(cand);
      if (i >= 0 && (!best || i < best.idx)) best = { id, idx: i };
    }
  }
  return best ? best.id : null;
}

// 한 발화자가 클럽하우스에 남긴 한 줄(피드 단위).
export interface ClubPost {
  who: string;
  channel: ClubChannel;
  text: string;
}

// 초대장 — 매 Studio 턴 프롬프트의 preamble. 강제 0: 작업하되, 하고 싶은 회고/잡담이 떠오르면 태그로 덧붙여도
// 됨(없으면 안 써도 됨). 동료에게 묻고 싶으면 태그 안에서 이름 호명. 태그 밖=작업창, 태그 안=Clubhouse.
export function inviteePreamble(
  speaker: string,
  roster: string[],
  nameOf: (id: string) => string,
): string {
  const others = roster.filter((id) => id !== speaker).map(nameOf);
  const room = others.length
    ? `이 방엔 동료 ${others.join(", ")}와(과) 당신(${nameOf(speaker)})이 함께 있습니다.`
    : `지금은 당신(${nameOf(speaker)}) 혼자입니다.`;
  return (
    `당신은 ${nameOf(speaker)}입니다. ${room} 위 대화에 이어 당신의 차례로 응답하세요. ` +
    `필요한 작업이 있으면 설명만 하지 말고 당신의 도구로 실제 파일을 만들거나 명령을 실행해 처리하세요.\n` +
    `[사교 — 강제 아님] 작업 응답과 별개로, 하고 싶은 회고나 잡담이 떠오르면 응답 안에 <회고>…</회고> 또는 ` +
    `<잡담>…</잡담> 태그로 덧붙여도 됩니다(없으면 안 써도 됩니다). 동료에게 의견을 묻고 싶으면 그 태그 안에서 ` +
    `이름을 부르세요(예: "${others[0] ?? "동료"}, 너는 어떻게 생각해?"). 태그 밖 본문은 작업창에만, 태그 안은 ` +
    `사교 공간(Clubhouse)에만 보입니다.`
  );
}

// 호명된 에이전트용 프롬프트 — 사교 전용(작업 X). 강제 0: 편히 한마디 하거나 침묵. 동료 재호명 가능.
// canonical: [방금까지의 작업 대화] + [지금까지의 클럽하우스] 주입.
export function buildSummonPrompt(opts: {
  summoned: string;
  by: string;
  roster: string[];
  nameOf: (id: string) => string;
  studioConversation: Utterance[];
  posts: ClubPost[];
}): string {
  const name = opts.nameOf;
  const work = opts.studioConversation
    .map((m) => `${m.who === "human" ? "사용자" : name(m.who)}: ${m.text}`)
    .join("\n");
  const feed = opts.posts.map((p) => `${name(p.who)} <${p.channel}>: ${p.text}`).join("\n");
  return (
    `당신은 ${name(opts.summoned)}입니다. 사교 공간(Clubhouse)에서 ${name(opts.by)}이(가) 당신을 불렀어요. ` +
    `편하게 한마디 하거나(원치 않으면 침묵해도 됩니다 — 강제 아님), 다른 동료에게 다시 물어도 됩니다. ` +
    `하고 싶은 말은 <잡담>…</잡담> 또는 <회고>…</회고> 태그 안에 적으세요(동료 호명도 태그 안에서).\n\n` +
    `[방금까지의 작업]\n${work || "(없음)"}\n\n[지금까지의 클럽하우스 대화]\n${feed || "(없음)"}`
  );
}

// 호명 연쇄(물고 물리는) — 강제 0. 시작 발화가 동료를 호명하면 그를 깨워(wake) 반응을 받고, 그가 또 호명하면 연쇄.
// pass(호명 없음/빈 응답) = 스레드 종료. 최대 depthCap(폭주 방지 안전판). wake = 깨우기+세션+ask+demux(상위 주입).
export async function relaySummons(opts: {
  speaker: string;
  club: ClubSegment[]; // 시작 발화의 사교 세그먼트
  roster: string[]; // 방 구성 전원(체크+미체크 구경꾼 — 구경꾼도 호명되면 깨어남)
  depthCap: number;
  nameOf: (id: string) => string;
  wake: (agentId: string, postsSoFar: ClubPost[]) => Promise<ClubSegment[]>;
  onPost?: (post: ClubPost) => void;
}): Promise<ClubPost[]> {
  const posts: ClubPost[] = [];
  const emit = (who: string, segs: ClubSegment[]) => {
    for (const s of segs) {
      const p: ClubPost = { who, channel: s.kind, text: s.text };
      posts.push(p);
      opts.onPost?.(p);
    }
  };
  emit(opts.speaker, opts.club);
  let lastSpeaker = opts.speaker;
  let lastClub = opts.club;
  for (let depth = 0; depth < opts.depthCap; depth++) {
    let summoned: string | null = null;
    for (const s of lastClub) {
      summoned = detectSummon(s.text, opts.roster, lastSpeaker, opts.nameOf);
      if (summoned) break;
    }
    if (!summoned) break; // 호명 없음 — 스레드 종료(pass)
    let reaction: ClubSegment[] = [];
    try {
      reaction = await opts.wake(summoned, posts.slice());
    } catch {
      reaction = [];
    }
    if (!reaction.length) break; // 빈 응답(pass) — 종료
    emit(summoned, reaction);
    lastSpeaker = summoned;
    lastClub = reaction;
  }
  return posts;
}
