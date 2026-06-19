// soksak-plugin-acp-studio — 여러 AI 코딩 에이전트를 한 워크스페이스에서 협업.
//
// 두 뷰: Studio(작업 — 체크박스 로스터·탭 순서 턴제/자유 대화·실파일) + Clubhouse(사교 — 에이전트가 자율로
// 남기는 회고·잡담, P3). acp-core(라이브러리) 의존: 연결/세션/프롬프트는 engine 이 코어 커맨드로 호출,
// session/update 는 app.bus(`acp.update.<connId>`) 라이브 구독. 락인 0 — ACP 표준만.
//
// [P2] 탭(드래그 정렬·체크박스)=참여 로스터, 탭 순서=턴 순서. 참견 모드 토글(turn 턴제 / free 자유).
//   사람 참견 = 언제나 최우선(진행 턴 cancel → 입력 주입 → 재시작, canonical). 역할 고정 X — 자기 턴에 실작업.
//   순수 로직(participants/nextSpeaker/buildPrompt/runExchange)은 conversation.ts(단위검증). 호명·demux 는 P3.

import { createEngine } from "./engine";
import {
  driveExchange,
  type KibitzMode,
  type RosterEntry,
  type Utterance,
} from "./conversation";
import {
  buildSummonPrompt,
  createTagDemux,
  demux,
  detectSummon,
  inviteePreamble,
  relaySummons,
  type ClubPost,
  type ClubSegment,
} from "./clubhouse";

const AGENTS: { id: string; label: string; color: string }[] = [
  { id: "claude", label: "Claude", color: "#d97757" },
  { id: "codex", label: "Codex", color: "#10a37f" },
  { id: "gemini", label: "Gemini", color: "#4285f4" },
];
const NAME: Record<string, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };
const COLOR: Record<string, string> = Object.fromEntries(AGENTS.map((a) => [a.id, a.color]));
const nameOf = (id: string): string => NAME[id] ?? id;
const CHANNEL_EMOJI: Record<string, string> = { 회고: "🪞", 잡담: "💬" };
const FREE_ROUNDS = 2; // free(자유) 모드 라운드 안전판(폭주 방지) — P5 설정화.

const CSS = `
.st{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg,#1e1e1e);color:var(--fg,#ddd);font:13px system-ui,-apple-system,sans-serif;overflow:hidden}
.st-bar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid rgba(127,127,127,.2);flex:0 0 auto;flex-wrap:wrap}
.st-bar b{font-weight:700;letter-spacing:.02em}
.st-tabs{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.st-tab{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:8px;border:1px solid rgba(127,127,127,.28);background:rgba(127,127,127,.08);cursor:grab;font-size:12px;user-select:none;transition:opacity .12s,border-color .12s}
.st-tab.off{opacity:.4}
.st-tab.drag{opacity:.5}
.st-tab .chk{width:13px;height:13px;border-radius:4px;border:1.5px solid currentColor;display:inline-flex;align-items:center;justify-content:center;font-size:10px;line-height:1}
.st-tab .nm{font-weight:600}
.st-kib{margin-left:4px;display:inline-flex;border-radius:8px;overflow:hidden;border:1px solid rgba(127,127,127,.28)}
.st-kib button{appearance:none;border:0;background:transparent;color:inherit;opacity:.6;font:inherit;font-size:11px;padding:3px 9px;cursor:pointer}
.st-kib button.on{opacity:1;background:rgba(127,127,127,.2);font-weight:700}
.st-status{margin-left:auto;font-size:11px;color:var(--fg3,#888)}
.st-msgs{flex:1;min-height:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.st-row{display:flex;flex-direction:column;gap:3px;max-width:88%}
.st-row.user{align-self:flex-end;align-items:flex-end}
.st-row.assistant{align-self:flex-start}
.st-bubble{padding:8px 11px;border-radius:10px;white-space:pre-wrap;word-break:break-word;line-height:1.45}
.st-row.user .st-bubble{background:#2d6cdf;color:#fff}
.st-row.assistant .st-bubble{background:rgba(127,127,127,.14)}
.st-who{font-size:10.5px;color:var(--fg3,#888);padding:0 4px;font-weight:600}
.st-tool{align-self:flex-start;max-width:88%;border:1px solid rgba(127,127,127,.25);border-radius:8px;padding:6px 9px;font-size:12px;background:rgba(127,127,127,.06)}
.st-pending{align-self:flex-start;font-size:11px;color:var(--fg3,#888);display:flex;align-items:center;gap:6px}
.st-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:st-pulse 1.1s ease-in-out infinite}
.st-fail{align-self:flex-start;max-width:88%;font-size:11.5px;color:var(--danger-soft,#d77);border:1px solid var(--danger-soft,#d77);border-radius:8px;padding:6px 9px;white-space:pre-wrap;word-break:break-word;opacity:.85}
@keyframes st-pulse{0%,100%{opacity:.25}50%{opacity:1}}
.st-in{display:flex;gap:8px;padding:8px 10px;border-top:1px solid rgba(127,127,127,.2);flex:0 0 auto}
.st-in textarea{flex:1;resize:none;background:rgba(127,127,127,.1);color:inherit;border:1px solid rgba(127,127,127,.25);border-radius:7px;padding:7px 9px;font:inherit;min-height:20px;max-height:120px}
.st-in button{background:#2d6cdf;color:#fff;border:0;border-radius:7px;padding:0 14px;cursor:pointer;font:inherit;font-weight:600}
.club2{display:flex;flex-direction:column;height:100%;width:100%;background:var(--bg,#1e1e1e);color:var(--fg,#ddd);font:13px system-ui,-apple-system,sans-serif;overflow:hidden}
.club2-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(127,127,127,.2);flex:0 0 auto}
.club2-feed{flex:1;min-height:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.club2-empty{color:var(--fg3,#888);font-size:12px;line-height:1.5;margin:auto;max-width:30em;text-align:center}
.club2-post{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:10px;background:rgba(127,127,127,.08)}
.club2-h{display:flex;align-items:center;gap:6px;font-size:11px}
.club2-av{font-size:14px}
.club2-who{font-weight:700}
.club2-ch{font-size:9.5px;padding:1px 6px;border-radius:8px;background:rgba(127,127,127,.18)}
.club2-ch.회고{color:#a9b665}.club2-ch.잡담{color:#7daea3}
.club2-summon{font-size:10px;color:#d8a657;font-weight:600}
.club2-body{white-space:pre-wrap;word-break:break-word;line-height:1.45}
`;

interface TurnRow {
  toBubble(): HTMLElement;
  fail(reason: string): void;
  remove(): void;
}
interface Current {
  agentId: string;
  connId: number;
  sessionId: string;
  row: TurnRow;
  // 버블은 lazy — 첫 스트리밍 청크(또는 최종 텍스트)에 생성. 그 전엔 row 의 "응답 중…" 인디케이터 유지.
  bubble: HTMLElement | null;
  liveRaw: string;
  demux: ReturnType<typeof createTagDemux>;
}

interface StudioState {
  roster: RosterEntry[]; // 탭 순서(드래그로 변경) — 체크된 것이 참여자
  mode: KibitzMode;
  conv: Utterance[];
  conns: Map<string, number>; // agentId → connId(영속 프로세스, 재사용)
  running: boolean;
  interjected: boolean;
  current: Current | null;
  cwd: string | undefined;
  msgs: HTMLElement;
  status: HTMLElement;
}

export default {
  activate(ctx: any) {
    const app = ctx.app;
    const core = (name: string, params?: any) =>
      app.commands.execute("plugin.soksak-plugin-acp-core." + name, params ?? {});
    const engine = createEngine(app);

    const settingPolicy = (): string | undefined =>
      (app.settings?.get("permissionPolicy") as string) || undefined;
    const settingMode = (): KibitzMode =>
      ((app.settings?.get("kibitzDefault") as string) === "free" ? "free" : "turn");
    const settingDepthCap = (): number =>
      Math.max(1, Number(app.settings?.get("nameTriggerDepthCap")) || 4);
    const projectCwd = (): string | undefined => app.project?.current?.()?.root;

    // ── Clubhouse 피드 영속(app.storage, 프로젝트 root 별) + 라이브 버스(clubhouse.post) ──
    // 저장소 key 는 파일명이 된다(코어 sanitize_key 가 /·: 거부) → cwd 를 djb2 해시 슬러그(영숫자)로.
    const FEED_CAP = 300;
    const feedKey = (cwd?: string): string => {
      const s = cwd || "global";
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
      return `feed${h.toString(36)}`;
    };
    async function loadFeed(cwd?: string): Promise<ClubPost[]> {
      try {
        const v = await app.storage?.read(feedKey(cwd));
        return Array.isArray(v) ? (v as ClubPost[]) : [];
      } catch {
        return [];
      }
    }
    async function appendFeed(cwd: string | undefined, posts: ClubPost[]) {
      if (!posts.length || !app.storage) return;
      try {
        const cur = await loadFeed(cwd);
        await app.storage.write(feedKey(cwd), [...cur, ...posts].slice(-FEED_CAP));
      } catch {
        /* noop */
      }
    }

    // emergent 스레드(한 호명이 응답됨 = 이 relay 체인에 서로 다른 참여자 ≥2)면 열린 `turn.signal` 발행 →
    // 메시지함(turn.ended 구독, root 스코프)이 메시지화·푸시·딥링크. 코어/메시지함과 결합 0(토픽 계약만, 락인 0).
    // chainPosts = 한 턴의 relay 체인 결과(누적 피드 아님 — 독립 발화 2개를 emergence 로 오인하지 않게). 반환=발행 여부.
    async function signalEmergence(cwd: string | undefined, chainPosts: ClubPost[]): Promise<boolean> {
      if ((app.settings?.get("mailboxSignal") as string) === "off") return false; // 사용자가 끔
      const whos = [...new Set(chainPosts.map((p) => p.who))];
      if (whos.length < 2) return false; // 호명 미응답(단발) — 신호 안 함
      const names = whos.map(nameOf).join(", ");
      const topic = (chainPosts[chainPosts.length - 1]?.text ?? "").slice(0, 40);
      try {
        await app.commands.execute("turn.signal", {
          source: "acp",
          root: cwd,
          command: `${names} 가 Clubhouse 에서 이야기 중 — "${topic}"`,
        });
        return true;
      } catch {
        return false;
      }
    }

    // 호명 연쇄 실행 — wake(소환된 에이전트 1회 ask + demux) 를 askAgent 로 조립해 relaySummons 에 주입.
    // 소환 에이전트가 태그를 안 쓰면 전체를 잡담으로(소환됐으니 사교). 반환 = 스레드 전체 posts(시작 발화 포함).
    async function runRelay(
      speaker: string,
      club: ClubSegment[],
      ctx: {
        rosterIds: string[];
        conversation: Utterance[];
        askAgent: (id: string, prompt: string) => Promise<string>;
        onPost?: (p: ClubPost) => void;
      },
    ): Promise<ClubPost[]> {
      const wake = async (id: string, postsSoFar: ClubPost[]): Promise<ClubSegment[]> => {
        const by = postsSoFar.length ? postsSoFar[postsSoFar.length - 1].who : speaker;
        const prompt = buildSummonPrompt({
          summoned: id,
          by,
          roster: ctx.rosterIds,
          nameOf,
          studioConversation: ctx.conversation,
          posts: postsSoFar,
        });
        let resp = "";
        try {
          resp = await ctx.askAgent(id, prompt);
        } catch {
          return [];
        }
        const d = demux(resp);
        if (d.club.length) return d.club;
        const w = d.work.trim();
        return w ? [{ kind: "잡담", text: w }] : [];
      };
      return relaySummons({
        speaker,
        club,
        roster: ctx.rosterIds,
        depthCap: settingDepthCap(),
        nameOf,
        wake,
        onPost: ctx.onPost,
      });
    }

    // 활성(마지막 마운트) Studio 뷰 — send 명령이 라이브 대화를 프로그램적으로 구동(노출 command E2E).
    let activeStudio: StudioState | null = null;

    // ── send(라이브 Studio 에 사람 메시지 주입 — 노출 command 로만 E2E·자동화 구동) ──
    ctx.subscriptions.push(
      app.commands.register("send", {
        description:
          "활성 Studio 뷰에 사람 메시지를 보낸다(textarea 전송과 동일 — 턴 루프 시작/참견). 노출 command 자동화·E2E 용",
        params: { text: { type: "string", required: true, description: "보낼 메시지" } },
        handler: async (p: any) => {
          const text = String(p?.text ?? "").trim();
          if (!text) return { ok: false, error: "text 필수" };
          if (!activeStudio) return { ok: false, error: "활성 Studio 뷰 없음(뷰를 먼저 여세요)" };
          onHuman(activeStudio, text);
          return { ok: true, sent: text, running: activeStudio.running };
        },
      }),
    );

    // ── 헤드리스 ask(단일 에이전트 1회 — E2E·CLI) ──
    ctx.subscriptions.push(
      app.commands.register("ask", {
        description: "프롬프트 1회 — 단일 에이전트 connect+session+prompt 후 텍스트·툴콜 반환(헤드리스)",
        params: {
          agent: { type: "string", description: "preset(claude|codex|gemini, 기본 claude)" },
          text: { type: "string", required: true, description: "프롬프트" },
        },
        handler: async (p: any) => {
          const agent = p.agent || "claude";
          let conn;
          try {
            conn = await engine.connect({ agent }, undefined, settingPolicy());
          } catch (e) {
            return { ok: false, error: String(e) };
          }
          try {
            const r = await engine.ask(conn.connId, conn.sessionId, p.text);
            const toolCalls = r.updates
              .filter((u) => u.sessionUpdate === "tool_call")
              .map((u) => ({ id: u.toolCallId, title: u.title, status: u.status }));
            return { ok: true, stopReason: r.stopReason, text: r.text, toolCalls };
          } catch (e) {
            return { ok: false, error: String(e) };
          } finally {
            await engine.disconnect(conn.connId);
          }
        },
      }),
    );

    // ── 헤드리스 converse(다중 에이전트 턴테이킹 1교환 — 소켓 E2E 표면) ──
    // 탭 순서(agents)대로 참여, 참견 모드(mode)대로 턴. 각 턴 canonical 프롬프트 → 실 에이전트. cwd 에 실파일.
    // 반환: utterances(발화 순서=턴 순서 검증), filesWritten(디스크 사실), order/mode(에코).
    ctx.subscriptions.push(
      app.commands.register("converse", {
        description:
          "다중 에이전트 1교환 — agents(탭 순서)가 mode(turn/free)로 턴테이킹, cwd 에 실파일. 발화·쓴 파일 반환(헤드리스 E2E)",
        params: {
          message: { type: "string", required: true, description: "사람 메시지(과제/프롬프트)" },
          agents: {
            type: "array",
            description:
              "참여 순서 — preset id 문자열(claude,codex,gemini) 또는 {id,cmd,args}(헤드리스 E2E 런치). 기본 3 preset",
          },
          mode: { type: "string", description: "turn(턴제) | free(자유). 기본 설정값" },
          cwd: { type: "string", description: "작업 디렉터리(실파일 검증 대상)" },
          maxRounds: { type: "number", description: "free 모드 라운드 상한(기본 2)" },
        },
        handler: async (p: any) => {
          const raw: any[] =
            Array.isArray(p.agents) && p.agents.length ? p.agents : AGENTS.map((a) => a.id);
          // 각 항목: preset id 문자열 또는 {id,cmd,args}(E2E 런치). UI 는 preset 만 — cmd/args 는 헤드리스 전용.
          const specs = raw.map((a) =>
            typeof a === "string"
              ? { id: a, agent: a as string | undefined, cmd: undefined as string | undefined, args: undefined as string[] | undefined }
              : { id: String(a.id), agent: undefined, cmd: a.cmd as string, args: a.args as string[] },
          );
          const roster: RosterEntry[] = specs.map((s) => ({ id: s.id, checked: true }));
          const mode: KibitzMode = p.mode === "free" ? "free" : p.mode === "turn" ? "turn" : settingMode();
          const cwd = typeof p.cwd === "string" ? p.cwd : projectCwd();
          const conns = new Map<string, number>();
          const skipped: { id: string; error: string }[] = [];
          try {
            // 견고함 — 한 에이전트가 연결 실패해도 건너뛰고 나머지로 대화 지속(전체 실패 금지).
            for (const s of specs) {
              try {
                const c = await engine.connect(
                  s.cmd ? { cmd: s.cmd, args: s.args } : { agent: s.agent },
                  cwd,
                  settingPolicy(),
                );
                conns.set(s.id, c.connId);
              } catch (e) {
                skipped.push({ id: s.id, error: String(e) });
              }
            }
            const before = await engine.snapshot(cwd);
            const rosterIds = roster.map((r) => r.id);
            const conversation: Utterance[] = [{ who: "human", text: p.message }];
            const utterances: Utterance[] = [];
            const club: ClubPost[] = [];
            let signaled = false;
            const askAgent = async (id: string, prompt: string): Promise<string> => {
              const connId = conns.get(id);
              if (connId == null) throw new Error(`연결 없음: ${id}`);
              const sid = await engine.newSession(connId, cwd);
              return (await engine.ask(connId, sid, prompt)).text;
            };
            await driveExchange({
              roster,
              mode,
              conversation,
              maxRounds: typeof p.maxRounds === "number" ? p.maxRounds : FREE_ROUNDS,
              nameOf,
              preamble: (s) => inviteePreamble(s, rosterIds, nameOf),
              turn: async (id, prompt) => {
                const raw = await askAgent(id, prompt); // 미연결이면 throw → driveExchange 가 이 발화 skip
                const { work, club: segs } = demux(raw); // 태그 밖=작업(Studio), 안=사교(Clubhouse)
                const posts = await runRelay(id, segs, {
                  rosterIds,
                  conversation,
                  askAgent,
                  onPost: (pp) => club.push(pp),
                });
                if (await signalEmergence(cwd, posts)) signaled = true; // emergent → 메시지함 신호
                return work;
              },
              onUtterance: (u) => utterances.push(u),
            });
            const filesWritten = engine.diffWritten(before, await engine.snapshot(cwd));
            await appendFeed(cwd, club); // 피드 영속(clubhouse.feed 로 교차검증)
            return { ok: true, order: rosterIds, mode, utterances, club, filesWritten, skipped, signaled };
          } catch (e) {
            return { ok: false, error: String(e) };
          } finally {
            for (const connId of conns.values()) await engine.disconnect(connId);
          }
        },
      }),
    );

    // ── Studio 뷰(다중 에이전트 라이브) ──
    const states = new WeakMap<HTMLElement, StudioState>();
    ctx.subscriptions.push(
      app.ui.registerView("studio", {
        mount(container: HTMLElement) {
          teardown(container);
          // 호스트 슬롯에 확정 높이 부여(kanban 패턴) — .st 가 absolute inset:0 로 채워 flex 레이아웃이
          // 풀린다(컨테이너 height 미정 시 .st{height:100%} 가 0/콘텐츠로 붕괴 → 입력바 클리핑 방지).
          container.style.position = "relative";
          const style = document.createElement("style");
          style.textContent = CSS;
          const root = document.createElement("div");
          root.className = "st";
          buildStudio(container, root);
          container.replaceChildren(style, root);
        },
        unmount(container: HTMLElement) {
          teardown(container);
        },
      }),
    );

    // ── Clubhouse 뷰 — 회고·잡담·호명 피드(영속 로드 + 라이브 버스 구독) ──
    ctx.subscriptions.push(
      app.ui.registerView("clubhouse", {
        async mount(container: HTMLElement) {
          const style = document.createElement("style");
          style.textContent = CSS;
          const root = el("div", "club2");
          const head = el("div", "club2-head");
          head.append(elText("span", "🛋️", "club2-av"), elText("b", "Clubhouse"));
          const feedEl = el("div", "club2-feed");
          const empty = elText(
            "div",
            "아직 잡담이 없습니다. Studio 에서 에이전트들이 일하면, 그들이 남긴 회고·잡담·호명이 여기 쌓입니다.",
            "club2-empty",
          );
          feedEl.appendChild(empty);
          root.append(head, feedEl);
          container.replaceChildren(style, root);

          const renderPost = (p: ClubPost) => {
            empty.remove();
            const row = el("div", "club2-post");
            const h = el("div", "club2-h");
            const who = elText("span", nameOf(p.who), "club2-who");
            who.style.color = COLOR[p.who] ?? "var(--fg,#ddd)";
            h.append(
              elText("span", CHANNEL_EMOJI[p.channel] ?? "💬", "club2-av"),
              who,
              elText("span", p.channel, `club2-ch ${p.channel}`),
            );
            // 호명 화살표 — 이 발화가 동료를 부르면 "→ 이름"(물고 물리는 연쇄 시각화).
            const summoned = detectSummon(
              p.text,
              AGENTS.map((a) => a.id),
              p.who,
              nameOf,
            );
            if (summoned) h.append(elText("span", `→ ${nameOf(summoned)}`, "club2-summon"));
            row.append(h, elText("div", p.text, "club2-body"));
            feedEl.appendChild(row);
            feedEl.scrollTop = feedEl.scrollHeight;
          };

          for (const p of await loadFeed(projectCwd())) renderPost(p);
          const off = app.bus?.on("clubhouse.post", (p: ClubPost) => renderPost(p));
          (container as unknown as { __off?: { dispose(): void } }).__off = off;
        },
        unmount(container: HTMLElement) {
          const off = (container as unknown as { __off?: { dispose(): void } }).__off;
          if (off) {
            try {
              off.dispose(); // Disposable{dispose} — 함수 호출이 아니라 dispose() (clubhouse.post 구독 해제)
            } catch {
              /* noop */
            }
          }
          container.replaceChildren();
        },
      }),
    );

    // ── Clubhouse 피드 커맨드(읽기·비우기 — E2E·확인) ──
    ctx.subscriptions.push(
      app.commands.register("clubhouse.feed", {
        description: "Clubhouse 피드 읽기 — 영속된 회고·잡담·호명 posts(프로젝트 root 별)",
        params: { cwd: { type: "string", description: "프로젝트 root(생략 시 활성)" } },
        handler: async (p: any) => {
          const cwd = typeof p.cwd === "string" ? p.cwd : projectCwd();
          let keys: string[] = [];
          try {
            keys = app.storage ? await app.storage.list() : [];
          } catch {
            /* noop */
          }
          return { ok: true, posts: await loadFeed(cwd), hasStorage: !!app.storage, keys };
        },
      }),
    );
    ctx.subscriptions.push(
      app.commands.register("clubhouse.clear", {
        description: "Clubhouse 피드 비우기(프로젝트 root 별, E2E 리셋)",
        params: { cwd: { type: "string", description: "프로젝트 root(생략 시 활성)" } },
        handler: async (p: any) => {
          const cwd = typeof p.cwd === "string" ? p.cwd : projectCwd();
          try {
            await app.storage?.write(feedKey(cwd), []);
          } catch {
            /* noop */
          }
          return { ok: true };
        },
      }),
    );

    function teardown(container: HTMLElement) {
      const st = states.get(container);
      if (st) {
        if (st === activeStudio) activeStudio = null; // send 명령 dangling 참조 방지
        if (st.current) engine.cancel(st.current.connId, st.current.sessionId);
        for (const connId of st.conns.values()) core("disconnect", { connId }).catch(() => {});
        st.conns.clear();
      }
      states.delete(container);
      container.replaceChildren();
    }

    function buildStudio(container: HTMLElement, root: HTMLElement) {
      const bar = el("div", "st-bar");
      const tabsEl = el("div", "st-tabs");
      const status = el("div", "st-status");
      const msgs = el("div", "st-msgs");
      const inrow = el("div", "st-in");
      const ta = document.createElement("textarea");
      ta.placeholder = "메시지… (Enter 전송, Shift+Enter 줄바꿈) — 언제나 참견 가능";
      ta.rows = 1;
      const send = document.createElement("button");
      send.textContent = "전송";
      inrow.append(ta, send);

      const st: StudioState = {
        roster: AGENTS.map((a) => ({ id: a.id, checked: true })),
        mode: settingMode(),
        conv: [],
        conns: new Map(),
        running: false,
        interjected: false,
        current: null,
        cwd: projectCwd(),
        msgs,
        status,
      };
      states.set(container, st);
      activeStudio = st; // 라이브 send 명령의 타겟(마지막 마운트 = 활성)

      const kib = kibitzToggle(st.mode, (m) => {
        st.mode = m;
      });
      renderTabs(st, tabsEl);
      bar.append(elText("b", "Studio"), tabsEl, kib, status);
      root.append(bar, msgs, inrow);

      const doSend = () => {
        const t = ta.value.trim();
        if (!t) return;
        ta.value = "";
        onHuman(st, t);
      };
      send.addEventListener("click", doSend);
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !(e as any).isComposing) {
          e.preventDefault();
          doSend();
        }
      });
      setStatus(st, "대기");
    }

    // 참견 모드 토글 — turn(턴제) / free(자유).
    function kibitzToggle(initial: KibitzMode, onChange: (m: KibitzMode) => void): HTMLElement {
      const wrap = el("div", "st-kib");
      const mk = (m: KibitzMode, label: string) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.classList.toggle("on", m === initial);
        b.addEventListener("click", () => {
          for (const c of wrap.children) c.classList.remove("on");
          b.classList.add("on");
          onChange(m);
        });
        return b;
      };
      wrap.append(mk("turn", "턴제"), mk("free", "자유"));
      return wrap;
    }

    // 로스터 탭 — 체크박스(참여) + 드래그(순서=턴 순서). 브랜드 색.
    function renderTabs(st: StudioState, tabsEl: HTMLElement) {
      tabsEl.replaceChildren();
      st.roster.forEach((entry, idx) => {
        const a = AGENTS.find((x) => x.id === entry.id);
        const chip = el("div", "st-tab" + (entry.checked ? "" : " off"));
        chip.style.color = a?.color ?? "#888";
        chip.draggable = true;
        const chk = el("span", "chk");
        chk.textContent = entry.checked ? "✓" : "";
        const nm = elText("span", a?.label ?? entry.id, "nm");
        nm.style.color = "var(--fg,#ddd)";
        chip.append(chk, nm);
        chip.addEventListener("click", () => {
          entry.checked = !entry.checked;
          renderTabs(st, tabsEl);
        });
        // 드래그 정렬 — 탭 순서 = 턴 순서.
        chip.addEventListener("dragstart", (e) => {
          chip.classList.add("drag");
          e.dataTransfer?.setData("text/plain", String(idx));
        });
        chip.addEventListener("dragend", () => chip.classList.remove("drag"));
        chip.addEventListener("dragover", (e) => e.preventDefault());
        chip.addEventListener("drop", (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer?.getData("text/plain"));
          if (Number.isNaN(from) || from === idx) return;
          const [moved] = st.roster.splice(from, 1);
          st.roster.splice(idx, 0, moved);
          renderTabs(st, tabsEl);
        });
        tabsEl.appendChild(chip);
      });
    }

    function setStatus(st: StudioState, t: string) {
      st.status.textContent = t;
    }

    // 사람 발화 — 언제나 최우선. 진행 중이면 현재 턴 cancel(참견 → 재시작), 멈춰 있으면 새 교환 시작.
    function onHuman(st: StudioState, text: string) {
      st.conv.push({ who: "human", text });
      renderUser(st, text);
      if (st.running && st.current) {
        st.interjected = true;
        engine.cancel(st.current.connId, st.current.sessionId);
        setStatus(st, `${nameOf(st.current.agentId)} 턴 취소 — 참견 반영 후 재시작`);
      } else if (!st.running) {
        void runLoop(st);
      }
    }

    // 영속 연결 보장(에이전트별 1프로세스 재사용) — 실패 시 사유 반환(조용한 null 금지: 화면에 띄운다).
    async function ensureConn(
      st: StudioState,
      agentId: string,
    ): Promise<{ connId: number } | { error: string }> {
      const existing = st.conns.get(agentId);
      if (existing != null) return { connId: existing };
      const c = await core("connect", { agent: agentId, cwd: st.cwd, permission: settingPolicy() });
      if (!c.ok) return { error: String(c.error || c.message || "연결 실패") };
      st.conns.set(agentId, c.connId);
      return { connId: c.connId };
    }

    // 라이브 교환 루프 — 시퀀싱(턴 순서·참견 재시작)은 검증된 driveExchange. 여기 turn() 은 연결·세션·스트리밍·버블만.
    async function runLoop(st: StudioState) {
      st.running = true;
      await driveExchange({
        roster: st.roster,
        mode: st.mode,
        conversation: st.conv, // 공유 — 에이전트 발화는 driveExchange 가 push
        maxRounds: FREE_ROUNDS,
        nameOf,
        preamble: (s) => inviteePreamble(s, st.roster.map((x) => x.id), nameOf),
        consumeInterject: () => {
          const v = st.interjected;
          st.interjected = false;
          return v;
        },
        onTurnStart: (speaker) => setStatus(st, `${nameOf(speaker)} 응답 중…`),
        turn: async (speaker, prompt) => {
          // 턴 행 — 시작 즉시 "응답 중…" 맥동 인디케이터(B3-c2). 성공=버블, 실패=사유 표시(B2: 조용한 skip 금지).
          const row = renderTurnRow(st, speaker);
          // 실패 = 화면(row.fail) + 세션 보존(st.conv). 에러도 대화에 킵 → 다른 에이전트가 맥락으로 알고
          // 기록에 남는다(예: Codex 연결 실패를 Claude 가 보고 "다들 대기 중"이라 오인하지 않게).
          const failTurn = (reason: string) => {
            row.fail(reason);
            st.conv.push({ who: "system", text: `${nameOf(speaker)} ${reason}` });
          };
          const conn = await ensureConn(st, speaker);
          if ("error" in conn) {
            failTurn(`연결 실패: ${conn.error}`); // codex ENOENT 등 사유를 그대로 노출
            return "";
          }
          const connId = conn.connId;
          let sessionId: string;
          try {
            sessionId = await engine.newSession(connId, st.cwd);
          } catch (e) {
            failTurn(`세션 실패: ${String(e)}`);
            return "";
          }
          // 버블은 아직 안 만든다 — "응답 중…" 인디케이터를 첫 스트리밍 청크(또는 최종 텍스트)까지 유지.
          const cur: Current = {
            agentId: speaker,
            connId,
            sessionId,
            row,
            bubble: null,
            liveRaw: "",
            demux: createTagDemux(),
          };
          st.current = cur;
          st.interjected = false;
          const off = app.bus.on(`acp.update.${connId}`, (evt: any) => onStream(cur, evt));
          let r: any;
          try {
            r = await core("prompt", { connId, sessionId, text: prompt });
          } catch (e) {
            r = { ok: false, error: String(e) };
          }
          off.dispose(); // app.bus.on 은 Disposable{dispose} 반환 — 함수 호출(off()) 은 throw → 구독 누수·누적
          st.current = null;
          if (st.interjected) {
            row.remove(); // 참견 — 행 폐기(driveExchange 가 같은 화자 재시작)
            return "";
          }
          // 권위본 — 코어 dedup r.text 를 demux(태그 밖=작업, 안=사교). 버블은 작업 텍스트로 확정(태그 0).
          const { work, club } = demux(r.ok ? (r.text ?? "") : "");
          if (work) {
            (cur.bubble ?? (cur.bubble = row.toBubble())).textContent = work; // 인디케이터→버블(없었으면 생성)
          } else {
            failTurn(r.ok ? "응답 없음(빈 발화)" : `프롬프트 실패: ${String(r.error ?? "")}`);
          }
          // 사교 — 호명 연쇄(소환된 동료는 ensureConn 으로 깨움) + 피드 버스 emit + 영속.
          if (club.length) {
            const rosterIds = st.roster.map((x) => x.id);
            const liveAsk = async (id: string, pr: string): Promise<string> => {
              const conn = await ensureConn(st, id);
              if ("error" in conn) throw new Error(conn.error);
              const sid = await engine.newSession(conn.connId, st.cwd);
              return (await engine.ask(conn.connId, sid, pr)).text;
            };
            const posts = await runRelay(speaker, club, {
              rosterIds,
              conversation: st.conv,
              askAgent: liveAsk,
              onPost: (pp) => app.bus?.emit("clubhouse.post", pp),
            });
            await appendFeed(st.cwd, posts);
            await signalEmergence(st.cwd, posts); // emergent → 메시지함 신호(푸시·딥링크)
          }
          return work;
        },
      });
      st.running = false;
      st.current = null;
      setStatus(st, "대기");
    }

    // 라이브 스트리밍 — 현재 화자의 agent_message_chunk 를 스트리밍 demux 로 거른다(태그 밖만 버블에 — 작업창에
    // <회고> 원문 노출 0). 코어 dedup 일치: 최종 완결 재전송(누적과 동일) skip. 권위 분리는 완료 시 demux(r.text).
    function onStream(cur: Current, evt: any) {
      const u = evt?.update;
      if (!u || u.sessionUpdate !== "agent_message_chunk") return;
      const t = u.content?.text ?? "";
      if (t !== "" && t === cur.liveRaw) return;
      cur.liveRaw += t;
      const workChunk = cur.demux.push(t);
      if (workChunk) {
        // 첫 실작업 청크에서 "응답 중…" 인디케이터 → 버블 생성(그 전까진 인디케이터 유지).
        if (!cur.bubble) cur.bubble = cur.row.toBubble();
        cur.bubble.textContent = (cur.bubble.textContent || "") + workChunk;
      }
    }

    // ── 렌더 헬퍼 ──
    function renderUser(st: StudioState, text: string) {
      const row = el("div", "st-row user");
      row.append(elText("div", "나", "st-who"), bubble(text));
      st.msgs.appendChild(row);
      scroll(st);
    }
    // 턴 행 — 이름 + 본문(처음엔 "응답 중…" 맥동 인디케이터). toBubble()=빈 버블로 교체(스트리밍),
    // fail(reason)=사유 노출(연결/세션/빈응답 실패를 조용히 숨기지 않음), remove()=행 폐기(참견 재시작).
    function renderTurnRow(st: StudioState, agentId: string) {
      const row = el("div", "st-row assistant");
      const who = elText("div", nameOf(agentId), "st-who");
      who.style.color = COLOR[agentId] ?? "var(--fg3,#888)";
      const pending = el("div", "st-pending");
      pending.append(el("span", "st-dot"), document.createTextNode("응답 중…"));
      row.append(who, pending);
      st.msgs.appendChild(row);
      scroll(st);
      let body: HTMLElement = pending;
      const swap = (next: HTMLElement) => {
        body.replaceWith(next);
        body = next;
        scroll(st);
      };
      return {
        toBubble(): HTMLElement {
          const b = bubble("");
          swap(b);
          return b;
        },
        fail(reason: string) {
          const f = el("div", "st-fail");
          f.textContent = `⚠ ${reason}`;
          f.title = reason; // 전문은 hover 로(여러 줄 stderr 보존)
          swap(f);
        },
        remove() {
          row.remove();
        },
      };
    }
    function scroll(st: StudioState) {
      st.msgs.scrollTop = st.msgs.scrollHeight;
    }

    function el(tag: string, cls: string): HTMLElement {
      const e = document.createElement(tag);
      e.className = cls;
      return e;
    }
    function elText(tag: string, text: string, cls = ""): HTMLElement {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      e.textContent = text;
      return e;
    }
    function bubble(text: string): HTMLElement {
      const b = el("div", "st-bubble");
      b.textContent = text;
      return b;
    }
  },
  deactivate() {},
};
