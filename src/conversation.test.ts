import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  detectMentions,
  driveExchange,
  driveSimul,
  facilitatorPreamble,
  inviteePreamble,
  nextSpeaker,
  parseFacilitatorDirective,
  participants,
  pickFacilitator,
  runExchange,
  type RosterEntry,
  type Utterance,
} from "./conversation";

const roster = (ids: string[], checked: string[]): RosterEntry[] =>
  ids.map((id) => ({ id, checked: checked.includes(id) }));
const nameOf = (id: string): string =>
  ({ claude: "Claude", codex: "Codex", gemini: "Gemini" })[id] ?? id;

describe("participants — 체크된 것, 탭 순서 보존", () => {
  it("체크된 에이전트만, 배열(탭) 순서대로", () => {
    expect(participants(roster(["claude", "codex", "gemini"], ["claude", "gemini"]))).toEqual([
      "claude",
      "gemini",
    ]);
  });
  it("드래그로 순서가 바뀌면 참여 순서도 바뀐다", () => {
    expect(participants(roster(["gemini", "claude", "codex"], ["claude", "codex", "gemini"]))).toEqual([
      "gemini",
      "claude",
      "codex",
    ]);
  });
  it("아무도 체크 안 하면 빈 참여자", () => {
    expect(participants(roster(["claude", "codex"], []))).toEqual([]);
  });
});

describe("nextSpeaker — 참여자 각 1회(탭 순서, 한 라운드). 라운드로빈 폐기", () => {
  const parts = ["claude", "codex", "gemini"];
  it("각 1회, 탭 순서, 한 바퀴 후 끝", () => {
    expect(nextSpeaker(parts, 0)).toBe("claude");
    expect(nextSpeaker(parts, 1)).toBe("codex");
    expect(nextSpeaker(parts, 2)).toBe("gemini");
    expect(nextSpeaker(parts, 3)).toBeNull(); // 한 바퀴 끝 — 반복 없음
  });
  it("참여자 0이면 항상 null", () => {
    expect(nextSpeaker([], 0)).toBeNull();
  });
});

describe("pickFacilitator — 진행자 기본값 = 체크된 첫 에이전트(탭 순서)", () => {
  it("첫 체크 참여자", () => {
    expect(pickFacilitator(roster(["claude", "codex"], ["claude", "codex"]))).toBe("claude");
  });
  it("첫 탭이 체크 안 되면 다음 체크된 것", () => {
    expect(pickFacilitator(roster(["claude", "codex"], ["codex"]))).toBe("codex");
  });
  it("드래그 순서가 우선", () => {
    expect(pickFacilitator(roster(["codex", "claude"], ["claude", "codex"]))).toBe("codex");
  });
  it("아무도 없으면 null", () => {
    expect(pickFacilitator(roster(["claude"], []))).toBeNull();
  });
});

describe("parseFacilitatorDirective — 진행자 지시 추출(동시/순차/선택/없음)", () => {
  const r = ["claude", "codex", "gemini"];
  it("'다 같이' → simul, 타겟 비면 전원", () => {
    expect(parseFacilitatorDirective("다 같이 의견 줘요", r, "claude", nameOf)).toEqual({
      pattern: "simul",
      targets: [],
    });
  });
  it("'차례로' → turn", () => {
    expect(parseFacilitatorDirective("차례로 말해봐요", r, "claude", nameOf)).toEqual({
      pattern: "turn",
      targets: [],
    });
  });
  it("@지목만(태그 없음) → select(그 동료)", () => {
    expect(parseFacilitatorDirective("@Codex 이건 어때?", r, "claude", nameOf)).toEqual({
      pattern: "select",
      targets: ["codex"],
    });
  });
  it("@지목 + 동시 → simul + 그 타겟들", () => {
    expect(parseFacilitatorDirective("@Codex @Gemini 다 같이 봐줘", r, "claude", nameOf)).toEqual({
      pattern: "simul",
      targets: ["codex", "gemini"],
    });
  });
  it("지시 전무(마무리) → none", () => {
    expect(parseFacilitatorDirective("정리됐네요. 이대로 갑시다.", r, "claude", nameOf)).toEqual({
      pattern: "none",
      targets: [],
    });
  });
});

describe("buildPrompt — canonical 재주입(방 구성 + 전체 대화)", () => {
  const r = roster(["claude", "codex"], ["claude", "codex"]);
  const conv: Utterance[] = [
    { who: "human", text: "안녕" },
    { who: "claude", text: "반가워요" },
  ];
  it("로스터의 동료(자신 제외)를 알린다", () => {
    const p = buildPrompt({ roster: r, conversation: conv, speaker: "codex" });
    expect(p).toContain("codex");
    expect(p).toContain("claude"); // 동료
  });
  it("전체 대화를 사용자/이름으로 재주입한다", () => {
    const p = buildPrompt({ roster: r, conversation: conv, speaker: "codex" });
    expect(p).toContain("사용자: 안녕");
    expect(p).toContain("claude: 반가워요");
  });
  it("nameOf 로 표시명을 치환한다", () => {
    const p = buildPrompt({
      roster: r,
      conversation: conv,
      speaker: "codex",
      nameOf: (id) => ({ claude: "Claude", codex: "Codex" })[id] ?? id,
    });
    expect(p).toContain("Codex");
    expect(p).toContain("Claude: 반가워요");
  });
  it("preamble 가 있으면 기본 지시를 대체한다", () => {
    const p = buildPrompt({ roster: r, conversation: conv, speaker: "codex", preamble: "초대장X" });
    expect(p.startsWith("초대장X")).toBe(true);
  });
  it("기본 지시 — 사용자 명시 요청 없으면 대화창에서 말로만, 파일/명령 금지", () => {
    const p = buildPrompt({ roster: r, conversation: conv, speaker: "codex" });
    expect(p).toContain("대화창에서 말로만");
    expect(p).toContain("작업을 시키지 않았다면");
    expect(p).toContain("파일을 만들거나 고치지 말고");
    expect(p).toContain("명령도 실행하지 마세요");
    expect(p).toContain("분명히 작업을 지시한 경우에만");
  });
  it("대화가 비면 [지금까지의 대화] 블록이 없다", () => {
    const p = buildPrompt({ roster: r, conversation: [], speaker: "claude" });
    expect(p).not.toContain("[지금까지의 대화]");
  });
});

describe("runExchange — 1교환(각 1회, 탭 순서·canonical·견고함)", () => {
  const r = roster(["claude", "codex", "gemini"], ["claude", "codex", "gemini"]);
  const human: Utterance[] = [{ who: "human", text: "이 과제를 처리하자" }];

  it("참여자 각 1회, 탭 순서로 발화", async () => {
    const seen: string[] = [];
    const out = await runExchange({
      roster: r,
      conversation: human,
      turn: async (id) => {
        seen.push(id);
        return `${id} 응답`;
      },
    });
    expect(seen).toEqual(["claude", "codex", "gemini"]);
    expect(out.map((u) => u.who)).toEqual(["claude", "codex", "gemini"]);
  });

  it("canonical: 뒤 발화자는 앞 발화자의 말을 프롬프트에서 본다", async () => {
    const prompts: Record<string, string> = {};
    await runExchange({
      roster: r,
      conversation: human,
      turn: async (id, prompt) => {
        prompts[id] = prompt;
        return `${id}의 의견`;
      },
    });
    expect(prompts["codex"]).toContain("claude의 의견");
    expect(prompts["gemini"]).toContain("codex의 의견");
  });

  it("빈/실패 발화는 건너뛰되 대화는 지속(견고함)", async () => {
    const out = await runExchange({
      roster: r,
      conversation: human,
      turn: async (id) => {
        if (id === "claude") return "   "; // 빈 발화
        if (id === "codex") throw new Error("prompt 실패");
        return `${id} 응답`;
      },
    });
    expect(out.map((u) => u.who)).toEqual(["gemini"]); // claude(빈)·codex(실패) 제외
  });

  it("onUtterance 로 라이브 통지한다", async () => {
    const live: Utterance[] = [];
    await runExchange({
      roster: r,
      conversation: human,
      turn: async (id) => `${id}!`,
      onUtterance: (u) => live.push(u),
    });
    expect(live.map((u) => u.who)).toEqual(["claude", "codex", "gemini"]);
  });
});

describe("driveExchange — 사람 참견(cancel + 같은 화자 재시작)", () => {
  const r = roster(["a", "b"], ["a", "b"]);

  it("턴 도중 참견하면 그 발화 폐기 + 같은 화자가 사람 메시지 보고 재시작, 턴 미advance", async () => {
    const conv: Utterance[] = [{ who: "human", text: "시작" }];
    let interject = false;
    const seq: string[] = [];
    const prompts: string[] = [];
    let aDone = false;
    await driveExchange({
      roster: r,
      conversation: conv,
      consumeInterject: () => {
        const v = interject;
        interject = false;
        return v;
      },
      turn: async (speaker, prompt) => {
        seq.push(speaker);
        prompts.push(prompt);
        if (speaker === "a" && !aDone) {
          aDone = true;
          // a 첫 턴 "도중" 사람 참견: conversation 에 사람 메시지 + 플래그 set(라이브에선 cancel 이 유발).
          conv.push({ who: "human", text: "잠깐 이렇게 해줘" });
          interject = true;
          return "a 취소될 발화";
        }
        return `${speaker} 발화`;
      },
    });
    // a(취소) → a(재시작) → b. 취소 발화는 대화에 없고, a 재시작 프롬프트는 사람 참견을 본다.
    expect(seq).toEqual(["a", "a", "b"]);
    expect(conv.filter((u) => u.who !== "human").map((u) => u.who)).toEqual(["a", "b"]);
    expect(conv.some((u) => u.text === "a 취소될 발화")).toBe(false);
    expect(prompts[1]).toContain("잠깐 이렇게 해줘");
  });

  it("참견 없으면 turn 모드대로 한 바퀴", async () => {
    const conv: Utterance[] = [{ who: "human", text: "시작" }];
    const seq: string[] = [];
    await driveExchange({
      roster: r,
      conversation: conv,
      turn: async (speaker) => {
        seq.push(speaker);
        return `${speaker}!`;
      },
    });
    expect(seq).toEqual(["a", "b"]);
  });
});

describe("driveSimul — 동시(병렬·스냅샷 고정·도착순 push)", () => {
  const r = roster(["a", "b", "c"], ["a", "b", "c"]);

  it("전원이 같은 맥락(스냅샷)을 보고 병렬 1회 — 서로의 동시 응답은 프롬프트에 없음", async () => {
    const conv: Utterance[] = [{ who: "human", text: "질문" }];
    const prompts: Record<string, string> = {};
    await driveSimul({
      roster: r,
      conversation: conv,
      turn: async (speaker, prompt) => {
        prompts[speaker] = prompt;
        return `${speaker} 답`;
      },
    });
    // 세 참여자 모두 발화(누락 0).
    expect(conv.filter((u) => u.who !== "human").map((u) => u.who).sort()).toEqual(["a", "b", "c"]);
    // 동시 — 어떤 프롬프트에도 다른 참여자의 이번 답이 들어있지 않다(스냅샷 고정).
    for (const p of Object.values(prompts)) {
      expect(p).not.toContain("a 답");
      expect(p).not.toContain("b 답");
      expect(p).not.toContain("c 답");
    }
  });

  it("실제 병렬 — 느린 a 가 끝나기 전에 b 가 시작된다", async () => {
    const conv: Utterance[] = [{ who: "human", text: "q" }];
    const started: string[] = [];
    let releaseA: () => void = () => {};
    const aGate = new Promise<void>((res) => (releaseA = res));
    await driveSimul({
      roster: roster(["a", "b"], ["a", "b"]),
      conversation: conv,
      turn: async (speaker) => {
        started.push(speaker);
        if (speaker === "a") await aGate; // a 는 b 가 시작 신호를 줄 때까지 대기
        if (speaker === "b") releaseA(); // b 가 먼저 진행되면서 a 를 푼다
        return `${speaker}!`;
      },
    });
    // 병렬이 아니면(순차) a 가 aGate 에서 영영 막혀 데드락 → 완료되었다는 것 자체가 동시 증거.
    expect(started).toContain("a");
    expect(started).toContain("b");
  });

  it("한 참여자 실패(throw)는 그 발화만 건너뛰고 나머지는 발화", async () => {
    const conv: Utterance[] = [{ who: "human", text: "q" }];
    await driveSimul({
      roster: r,
      conversation: conv,
      turn: async (speaker) => {
        if (speaker === "b") throw new Error("b 연결 실패");
        return `${speaker}!`;
      },
    });
    expect(conv.filter((u) => u.who !== "human").map((u) => u.who).sort()).toEqual(["a", "c"]);
  });
});

describe("inviteePreamble — 방 정체성 + base 결 + 모드별 발언 규범", () => {
  it("Studio 협업방·cwd·메타금지·독백금지·침묵허용·@이름", () => {
    const p = inviteePreamble("claude", ["claude", "codex"], nameOf, "/repo");
    expect(p).toContain("Studio");
    expect(p).toContain("협업");
    expect(p).toContain("/repo");
    expect(p).toContain("내부 절차"); // 메타 서술 금지
    expect(p).toContain("Codex"); // 동료
    expect(p).toContain("독백");
    expect(p).toContain("침묵");
    expect(p).toContain("@이름");
  });
  it("기본은 대화만 — 사용자 명시 요청 없으면 파일/명령 금지(주입 지시어)", () => {
    const p = inviteePreamble("claude", ["claude", "codex"], nameOf, "/repo");
    expect(p).toContain("대화창에서 말로만");
    expect(p).toContain("작업을 시키지 않았다면");
    expect(p).toContain("파일을 만들거나 고치지 말고");
    expect(p).toContain("명령도 실행하지 마세요");
    expect(p).toContain("분명히 작업을 지시한 경우에만");
  });
  it("mode=simul — 동시 노트(끝까지·기다림, 강제 아님)", () => {
    const p = inviteePreamble("claude", ["claude", "codex"], nameOf, "/repo", "simul");
    expect(p).toContain("[동시]");
    expect(p).toContain("끝까지");
    expect(p).toContain("기다려");
    expect(p).toContain("강제는 아닙니다");
  });
  it("mode=turn — 순차 노트(차례대로·경청)", () => {
    const p = inviteePreamble("claude", ["claude", "codex"], nameOf, "/repo", "turn");
    expect(p).toContain("[순차]");
    expect(p).toContain("차례");
    expect(p).toContain("경청");
  });
  it("mode=facil — 진행 참여자 노트(진행자가 부르면 답·안 불리면 대기)", () => {
    const p = inviteePreamble("claude", ["claude", "codex"], nameOf, "/repo", "facil");
    expect(p).toContain("[진행]");
    expect(p).toContain("진행자");
    expect(p).toContain("기다리");
  });
  it("mode 없으면 모드 노트 없음(base 만)", () => {
    const p = inviteePreamble("claude", ["claude", "codex"], nameOf, "/repo");
    expect(p).not.toContain("[동시]");
    expect(p).not.toContain("[순차]");
    expect(p).not.toContain("[진행]");
  });
  it("Clubhouse 잔재 없음", () => {
    const p = inviteePreamble("claude", ["claude", "codex"], nameOf, "/repo", "facil");
    expect(p).not.toContain("<회고>");
    expect(p).not.toContain("Clubhouse");
  });
});

describe("facilitatorPreamble — 진행자 전용(조율·종료 판단)", () => {
  it("진행자 역할·동시/순차/@선택·마무리=아무도 안 부름", () => {
    const p = facilitatorPreamble("claude", ["claude", "codex"], nameOf, "/repo");
    expect(p).toContain("진행자");
    expect(p).toContain("다 같이"); // 동시 부르는 법
    expect(p).toContain("차례로"); // 순차
    expect(p).toContain("@"); // @선택
    expect(p).toContain("종료"); // 아무도 안 부르면 종료
    expect(p).toContain("Codex"); // 동료
  });
});

describe("detectMentions — @지목(작업 대화에서 특정 동료 직접 호출)", () => {
  const r = ["claude", "codex", "gemini"];
  it("'@이름' 지목 → 그 id", () => {
    expect(detectMentions("이건 @Codex 가 검증해줘", r, "claude", nameOf)).toEqual(["codex"]);
  });
  it("'@id'(소문자)로도", () => {
    expect(detectMentions("@gemini 확인 부탁", r, "claude", nameOf)).toEqual(["gemini"]);
  });
  it("'@' 없는 단순 이름 언급은 지목 아님", () => {
    expect(detectMentions("Codex 와 함께 짰다", r, "claude", nameOf)).toEqual([]);
  });
  it("자기 자신 @지목 제외", () => {
    expect(detectMentions("@Claude 내가 한다", r, "claude", nameOf)).toEqual([]);
  });
  it("여럿 @지목 — 등장 순서·중복 제거", () => {
    expect(detectMentions("@Gemini 랑 @Codex, 또 @Gemini", r, "claude", nameOf)).toEqual([
      "gemini",
      "codex",
    ]);
  });
  it("체크 안 된 구경꾼도 roster 에 있으면 @지목 가능", () => {
    expect(detectMentions("@Gemini 의견?", r, "codex", nameOf)).toEqual(["gemini"]);
  });
});
