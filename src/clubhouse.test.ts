import { describe, expect, it } from "vitest";
import {
  buildSummonPrompt,
  createTagDemux,
  demux,
  detectSummon,
  inviteePreamble,
  relaySummons,
} from "./clubhouse";

const nameOf = (id: string): string =>
  ({ claude: "Claude", codex: "Codex", gemini: "Gemini" })[id] ?? id;

describe("demux — 인밴드 태그 분리(태그 밖=작업, 안=사교)", () => {
  it("태그 없으면 전부 작업, 사교 0", () => {
    expect(demux("그냥 작업 보고입니다.")).toEqual({ work: "그냥 작업 보고입니다.", club: [] });
  });
  it("<회고>를 사교로, 나머지는 작업으로", () => {
    const r = demux("파일을 만들었어요. <회고>처음엔 막막했는데 풀려서 기뻤다</회고>");
    expect(r.work).toBe("파일을 만들었어요.");
    expect(r.club).toEqual([{ kind: "회고", text: "처음엔 막막했는데 풀려서 기뻤다" }]);
  });
  it("<잡담> 채널 분리 + 작업 텍스트 양옆 보존", () => {
    const r = demux("앞부분 <잡담>오늘 날씨 좋네</잡담> 뒷부분");
    expect(r.work).toBe("앞부분  뒷부분".trim());
    expect(r.club).toEqual([{ kind: "잡담", text: "오늘 날씨 좋네" }]);
  });
  it("여러 태그(회고+잡담) 순서대로 수집", () => {
    const r = demux("<회고>회고1</회고>중간<잡담>잡담1</잡담>");
    expect(r.work).toBe("중간");
    expect(r.club).toEqual([
      { kind: "회고", text: "회고1" },
      { kind: "잡담", text: "잡담1" },
    ]);
  });
  it("작업창에 태그 원문이 절대 새지 않는다(< 없음)", () => {
    const r = demux("작업 <회고>속마음</회고> 끝");
    expect(r.work).not.toContain("<");
    expect(r.work).not.toContain("회고");
  });

  it("스트리밍: 태그가 청크 경계에 걸쳐도 정확", () => {
    const d = createTagDemux();
    let live = "";
    // "보고함 <회" | "고>비밀</회" | "고> 끝" 처럼 경계에 걸쳐 들어옴
    live += d.push("보고함 <회");
    live += d.push("고>비밀</회");
    live += d.push("고> 끝");
    const end = d.end();
    // 라이브로 노출된 work 누적엔 태그 원문이 한 조각도 없어야 한다.
    expect(live).not.toContain("<");
    expect(live).not.toContain("회고");
    expect(end.work).toBe("보고함  끝".trim());
    expect(end.club).toEqual([{ kind: "회고", text: "비밀" }]);
  });

  it("스트리밍: 한 글자씩 들어와도 동일 결과", () => {
    const src = "ab<잡담>속</잡담>cd";
    const d = createTagDemux();
    let live = "";
    for (const ch of src) live += d.push(ch);
    const end = d.end();
    expect(live).not.toContain("<");
    expect(end.work).toBe("abcd");
    expect(end.club).toEqual([{ kind: "잡담", text: "속" }]);
  });

  it("닫히지 않은 태그 — best-effort 흡수(작업 뷰 안 깨짐)", () => {
    const r = demux("작업함 <회고>마무리 못한 생각");
    expect(r.work).toBe("작업함");
    expect(r.club).toEqual([{ kind: "회고", text: "마무리 못한 생각" }]);
  });
});

describe("detectSummon — 호명 탐지(이름 + 말걸기 신호)", () => {
  const roster = ["claude", "codex", "gemini"];
  it("동료 이름 + 물음표 → 그 동료 호명", () => {
    expect(detectSummon("Codex, 너는 어떻게 생각해?", roster, "claude", nameOf)).toBe("codex");
  });
  it("권유 동사(어때) 신호로도 호명", () => {
    expect(detectSummon("Gemini 이거 어때", roster, "claude", nameOf)).toBe("gemini");
  });
  it("말걸기 신호 없이 이름만 — 호명 아님", () => {
    expect(detectSummon("Codex 와 함께 짰다", roster, "claude", nameOf)).toBeNull();
  });
  it("자기 이름은 호명 대상 아님", () => {
    expect(detectSummon("Claude 생각엔 이게 맞아?", roster, "claude", nameOf)).toBeNull();
  });
  it("여럿 등장 시 먼저 나온 동료를 호명", () => {
    expect(detectSummon("Gemini 랑 Codex 중 누가 맞을까?", roster, "claude", nameOf)).toBe("gemini");
  });
  it("id(소문자)로도 탐지", () => {
    expect(detectSummon("codex 어떻게 볼래?", roster, "claude", nameOf)).toBe("codex");
  });
});

describe("relaySummons — 호명 연쇄(물고 물리는 emergence, 강제 0)", () => {
  const roster = ["claude", "codex", "gemini"];

  it("호명이 연쇄되면 물고 물린다(claude→codex→gemini), pass 로 종료", async () => {
    const wake = async (id: string) => {
      if (id === "codex") return [{ kind: "잡담" as const, text: "Gemini 너는 어때?" }];
      if (id === "gemini") return [{ kind: "잡담" as const, text: "난 만족스러워" }];
      return [];
    };
    const posts = await relaySummons({
      speaker: "claude",
      club: [{ kind: "잡담", text: "Codex, 어떻게 생각해?" }],
      roster,
      depthCap: 5,
      nameOf,
      wake,
    });
    expect(posts.map((p) => p.who)).toEqual(["claude", "codex", "gemini"]);
  });

  it("호명 없으면 시작 발화만(pass)", async () => {
    const posts = await relaySummons({
      speaker: "claude",
      club: [{ kind: "회고", text: "오늘 잘 풀렸다" }],
      roster,
      depthCap: 5,
      nameOf,
      wake: async () => [{ kind: "잡담", text: "불려나옴" }],
    });
    expect(posts.map((p) => p.who)).toEqual(["claude"]);
  });

  it("depthCap 안전판 — 무한 호명(claude↔codex)을 막는다", async () => {
    const wake = async (id: string) =>
      id === "codex"
        ? [{ kind: "잡담" as const, text: "Claude 너는?" }]
        : [{ kind: "잡담" as const, text: "Codex 너는?" }];
    const posts = await relaySummons({
      speaker: "claude",
      club: [{ kind: "잡담", text: "Codex 어때?" }],
      roster: ["claude", "codex"],
      depthCap: 3,
      nameOf,
      wake,
    });
    expect(posts.length).toBeLessThanOrEqual(4); // 시작 1 + 최대 3
    expect(posts.length).toBeGreaterThanOrEqual(2);
  });

  it("빈 응답(pass)이면 종료", async () => {
    const posts = await relaySummons({
      speaker: "claude",
      club: [{ kind: "잡담", text: "Codex 어때?" }],
      roster,
      depthCap: 5,
      nameOf,
      wake: async () => [],
    });
    expect(posts.map((p) => p.who)).toEqual(["claude"]);
  });
});

describe("프롬프트 빌더", () => {
  it("inviteePreamble — 동료·태그 안내·호명 예시·강제 아님", () => {
    const p = inviteePreamble("claude", ["claude", "codex"], nameOf);
    expect(p).toContain("Codex");
    expect(p).toContain("<회고>");
    expect(p).toContain("<잡담>");
    expect(p).toContain("강제");
  });
  it("buildSummonPrompt — 작업·클럽하우스 맥락 주입", () => {
    const p = buildSummonPrompt({
      summoned: "gemini",
      by: "codex",
      roster: ["claude", "codex", "gemini"],
      nameOf,
      studioConversation: [
        { who: "human", text: "과제X" },
        { who: "claude", text: "했음" },
      ],
      posts: [{ who: "codex", channel: "잡담", text: "Gemini 어때?" }],
    });
    expect(p).toContain("Gemini");
    expect(p).toContain("과제X");
    expect(p).toContain("Codex");
  });
});
