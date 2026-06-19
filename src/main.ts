// soksak-plugin-acp-studio — 여러 AI 코딩 에이전트를 한 워크스페이스에서 하나의 대화로 협업.
//
// 한 뷰: Studio(체크박스 로스터·탭 순서 턴제/자유/동시 대화·실파일). 사교(회고·잡담)는 별도 채널이 아니라
//   대화 자체에 자연스럽게 녹는다(페르소나가 유도) — 동료 직접 호출은 본문 '@이름' 한 채널로 단일화.
// acp-core(라이브러리) 의존: 연결/세션/프롬프트는 engine 이 코어 커맨드로 호출, session/update 는
//   app.bus(`acp.update.<connId>`) 라이브 구독. 락인 0 — ACP 표준만.
//
// 탭(드래그 정렬·체크박스)=참여 로스터, 탭 순서=턴 순서. 모드: turn(각 1회)/free(라운드 반복)/simul(전원 병렬).
//   사람 참견 = 언제나 최우선(진행 턴 중단 → 부분응답 종결 보존 → 입력 주입 → 재구동). 자기 턴에 실작업.
//   순수 로직(participants/nextSpeaker/buildPrompt/inviteePreamble/detectMentions/drive*)은 conversation.ts(단위검증).

import { createEngine } from "./engine";
import {
  buildPrompt,
  detectMentions,
  driveExchange,
  driveSimul,
  facilitatorPreamble,
  inviteePreamble,
  parseFacilitatorDirective,
  participants,
  pickFacilitator,
  type KibitzMode,
  type RosterEntry,
  type Utterance,
} from "./conversation";

const AGENTS: { id: string; label: string; color: string; hidden?: boolean }[] = [
  { id: "claude", label: "Claude", color: "#d97757" },
  { id: "codex", label: "Codex", color: "#10a37f" },
  // gemini: gemini-cli 가 2026-06-18 부터 Pro/Ultra·무료 티어 서비스 종료, antigravity-cli(agy)는 ACP 미구현
  //   (Issue #31) → Google 계열 ACP 경로 없음. 임시 hidden(부활: hidden 해제 + acp-core 에 agy --acp preset).
  { id: "gemini", label: "Gemini", color: "#4285f4", hidden: true },
];
// 로스터·기본 참여자에 쓰는 활성 목록(hidden 제외). NAME/COLOR/nameOf 는 전체 유지 — 과거 대화의 Gemini 렌더 안전.
const ACTIVE_AGENTS = AGENTS.filter((a) => !a.hidden);
const NAME: Record<string, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };
const COLOR: Record<string, string> = Object.fromEntries(AGENTS.map((a) => [a.id, a.color]));
const nameOf = (id: string): string => NAME[id] ?? id;
const FACIL_MAX_ROUNDS = 6; // 진행 모드 하드 안전판 — 진행자가 안 멈추면 강제 마무리(무한 불가). 설정 override.

const CSS = `
.st{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg,#1e1e1e);color:var(--fg,#ddd);font:13px system-ui,-apple-system,sans-serif;overflow:hidden}
.st-bar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid rgba(127,127,127,.2);flex:0 0 auto;flex-wrap:wrap}
.st-bar b{font-weight:700;letter-spacing:.02em}
.st-tabs{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.st-tab{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:8px;border:1px solid rgba(127,127,127,.28);background:rgba(127,127,127,.08);cursor:grab;font-size:12px;user-select:none;touch-action:none;transition:opacity .12s,border-color .12s}
.st-tab.off{opacity:.4}
.st-tab.drag{cursor:grabbing;opacity:.95;border-color:currentColor;box-shadow:0 3px 10px rgba(0,0,0,.35);transform:scale(1.06);position:relative;z-index:3}
.st-tab .chk{width:13px;height:13px;border-radius:4px;border:1.5px solid currentColor;display:inline-flex;align-items:center;justify-content:center;font-size:10px;line-height:1}
.st-tab .nm{font-weight:600}
.st-crown{cursor:pointer;font-size:10px;opacity:.3;user-select:none;filter:grayscale(1)}
.st-crown:hover{opacity:.7}
.st-crown.on{opacity:1;filter:none}
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
.st-who{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:10.5px;color:var(--fg3,#888);padding:0 4px}
.st-who-name{font-weight:600}
.st-who-time{font-weight:400;opacity:.75;font-variant-numeric:tabular-nums}
.st-think{cursor:pointer;font-weight:400;font-size:10px;color:var(--fg3,#888);border:1px solid rgba(127,127,127,.3);border-radius:6px;padding:0 5px;user-select:none}
.st-think:hover{border-color:rgba(127,127,127,.55)}
.st-think.open{color:var(--fg2,#bbb);background:rgba(127,127,127,.12)}
.st-think-body{align-self:flex-start;max-width:88%;margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--fg3,#888);background:rgba(127,127,127,.06);border-left:2px solid rgba(127,127,127,.35);border-radius:4px;padding:6px 9px;white-space:pre-wrap;word-break:break-word}
.st-tool{align-self:flex-start;max-width:88%;border:1px solid rgba(127,127,127,.25);border-radius:8px;padding:6px 9px;font-size:12px;background:rgba(127,127,127,.06)}
.st-pending{align-self:flex-start;font-size:11px;color:var(--fg3,#888);display:flex;align-items:center;gap:6px}
.st-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:st-pulse 1.1s ease-in-out infinite}
.st-fail{align-self:flex-start;max-width:88%;font-size:11.5px;color:var(--danger-soft,#d77);border:1px solid var(--danger-soft,#d77);border-radius:8px;padding:6px 9px;white-space:pre-wrap;word-break:break-word;opacity:.85}
.st-box-time{display:block;text-align:right;font-size:9px;opacity:.5;margin-top:3px;font-variant-numeric:tabular-nums}
@keyframes st-pulse{0%,100%{opacity:.25}50%{opacity:1}}
.st-in{display:flex;gap:8px;padding:8px 10px;border-top:1px solid rgba(127,127,127,.2);flex:0 0 auto;position:relative}
.st-mention{position:absolute;left:10px;bottom:calc(100% + 4px);min-width:160px;background:var(--bg2,#262626);border:1px solid rgba(127,127,127,.35);border-radius:8px;padding:4px;box-shadow:0 6px 20px rgba(0,0,0,.4);z-index:20}
.st-mention-item{display:flex;align-items:center;gap:5px;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:12.5px}
.st-mention-item.on{background:rgba(127,127,127,.2)}
.st-mention-at{opacity:.6}
.st-mention-nm{font-weight:600;color:var(--fg,#ddd)}
.st-in textarea{flex:1;resize:none;background:rgba(127,127,127,.1);color:inherit;border:1px solid rgba(127,127,127,.25);border-radius:7px;padding:7px 9px;font:inherit;min-height:20px;max-height:120px}
.st-in button{background:#2d6cdf;color:#fff;border:0;border-radius:7px;padding:0 14px;cursor:pointer;font:inherit;font-weight:600}
.st-cut{font-weight:400;opacity:.7;font-size:9px;font-style:italic} /* 참견으로 중단된 부분응답 표식 */
`;

interface TurnRow {
  toBubble(): HTMLElement;
  fail(reason: string): void;
  setEnd(): void;
  setReasoning(text: string): void;
  remove(): void;
}
interface Current {
  agentId: string;
  connId: number;
  sessionId: string;
  row: TurnRow;
  // 버블은 lazy — 첫 스트리밍 청크(또는 최종 텍스트)에 생성. 그 전엔 row 의 "응답 중…" 인디케이터 유지.
  bubble: HTMLElement | null;
  liveRaw: string; // 스트리밍 raw 누적 — dedup + 참견 중단 시 '말해진 부분' 보존(종결처리)
}

interface StudioState {
  roster: RosterEntry[]; // 탭 순서(드래그로 변경) — 체크된 것이 참여자
  mode: KibitzMode;
  conv: Utterance[];
  conns: Map<string, number>; // agentId → connId(영속 프로세스, 재사용)
  running: boolean;
  facilitatorId: string; // 진행(facil) 모드의 진행자(👑) — 기본 첫 체크, 탭 👑 클릭으로 변경
  pendingHuman: string[]; // 진행 중 들어온 사람 참견 — 현재 턴 종결 후 세션 주입(취소-제거 아님)
  actives: Set<Current>; // 진행 중인 발화들(순차=최대 1, 동시=최대 N) — 중단·정리 대상
  cwd: string | undefined;
  msgs: HTMLElement;
  tabsEl: HTMLElement; // 로스터 탭 컨테이너 — 세션 오류 시 자동 체크 해제 후 재렌더
  kibEl: HTMLElement; // 모드 토글(순차/진행/동시) 컨테이너 — setMode 가 버튼 하이라이트 동기화
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
    const settingMode = (): KibitzMode => {
      const v = app.settings?.get("kibitzDefault") as string;
      return v === "turn" || v === "simul" ? v : "facil"; // 기본 = 진행(주력)
    };
    const settingDepthCap = (): number =>
      Math.max(1, Number(app.settings?.get("nameTriggerDepthCap")) || 4);
    const settingFacilMax = (): number =>
      Math.max(1, Number(app.settings?.get("facilMaxRounds")) || FACIL_MAX_ROUNDS);
    const projectCwd = (): string | undefined => app.project?.current?.()?.root;

    // 활성(마지막 마운트) Studio 뷰 — send 명령이 라이브 대화를 프로그램적으로 구동(노출 command E2E).
    let activeStudio: StudioState | null = null;

    // ── send(라이브 Studio 에 사람 메시지 주입 — 노출 command 로만 E2E·자동화 구동) ──
    ctx.subscriptions.push(
      app.commands.register("send", {
        description:
          "활성 Studio 뷰에 사람 메시지를 보낸다(textarea 전송과 동일 — 대화 구동/참견). 노출 command 자동화·E2E 용",
        params: {
          text: { type: "string", required: true, description: "보낼 메시지" },
          mode: { type: "string", description: "turn|facil|simul — 전송 전 모드 설정(E2E·자동화). 생략 시 유지" },
        },
        handler: async (p: any) => {
          const text = String(p?.text ?? "").trim();
          if (!text) return { ok: false, error: "text 필수" };
          if (!activeStudio) return { ok: false, error: "활성 Studio 뷰 없음(뷰를 먼저 여세요)" };
          if (p?.mode === "turn" || p?.mode === "facil" || p?.mode === "simul") {
            setMode(activeStudio, p.mode); // 버튼 클릭과 동치 — 하이라이트·👑 동기화
          }
          onHuman(activeStudio, text);
          return { ok: true, sent: text, mode: activeStudio.mode, running: activeStudio.running };
        },
      }),
    );

    // ── state(활성 Studio 라이브 상태 — E2E·자동화 관찰: 스트리밍 시작 시점 폴링 등) ──
    ctx.subscriptions.push(
      app.commands.register("state", {
        description:
          "활성 Studio 의 라이브 상태(모드·진행 여부·대화 수·로스터 체크·진행 중 발화의 message 스트리밍 길이)",
        params: {},
        handler: async () => {
          const st = activeStudio;
          if (!st) return { ok: false, error: "활성 Studio 뷰 없음" };
          return {
            ok: true,
            mode: st.mode,
            facilitator: st.facilitatorId, // 진행 모드 진행자(👑)
            running: st.running,
            conv: st.conv.length,
            pending: st.pendingHuman.length,
            roster: st.roster.map((r) => ({ id: r.id, checked: r.checked })),
            // streamed = 지금까지 받은 message 청크 누적 길이(thought 제외) — >0 이면 '출력 시작'.
            actives: [...st.actives].map((c) => ({ id: c.agentId, streamed: c.liveRaw.length })),
          };
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
          "다중 에이전트 1교환 — agents(탭 순서)가 각 1회 턴테이킹, cwd 에 실파일. 발화·쓴 파일 반환(헤드리스 E2E)",
        params: {
          message: { type: "string", required: true, description: "사람 메시지(과제/프롬프트)" },
          agents: {
            type: "array",
            description:
              "참여 순서 — preset id 문자열(claude,codex,gemini) 또는 {id,cmd,args}(헤드리스 E2E 런치). 기본 활성 preset",
          },
          cwd: { type: "string", description: "작업 디렉터리(실파일 검증 대상)" },
        },
        handler: async (p: any) => {
          const raw: any[] =
            Array.isArray(p.agents) && p.agents.length ? p.agents : ACTIVE_AGENTS.map((a) => a.id);
          // 각 항목: preset id 문자열 또는 {id,cmd,args}(E2E 런치). UI 는 preset 만 — cmd/args 는 헤드리스 전용.
          const specs = raw.map((a) =>
            typeof a === "string"
              ? { id: a, agent: a as string | undefined, cmd: undefined as string | undefined, args: undefined as string[] | undefined }
              : { id: String(a.id), agent: undefined, cmd: a.cmd as string, args: a.args as string[] },
          );
          const roster: RosterEntry[] = specs.map((s) => ({ id: s.id, checked: true }));
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
            const askAgent = async (id: string, prompt: string): Promise<string> => {
              const connId = conns.get(id);
              if (connId == null) throw new Error(`연결 없음: ${id}`);
              const sid = await engine.newSession(connId, cwd);
              return (await engine.ask(connId, sid, prompt)).text;
            };
            await driveExchange({
              roster,
              conversation,
              nameOf,
              preamble: (s) => inviteePreamble(s, rosterIds, nameOf, cwd, "turn"),
              turn: async (id, prompt) => (await askAgent(id, prompt)).trim(), // 미연결이면 throw → 이 발화 skip
              onUtterance: (u) => utterances.push(u),
            });
            const filesWritten = engine.diffWritten(before, await engine.snapshot(cwd));
            return { ok: true, order: rosterIds, utterances, filesWritten, skipped };
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

    function teardown(container: HTMLElement) {
      const st = states.get(container);
      if (st) {
        if (st === activeStudio) activeStudio = null; // send 명령 dangling 참조 방지
        for (const c of st.actives) engine.cancel(c.connId, c.sessionId); // 진행 중 전부 취소(동시=N)
        for (const connId of st.conns.values()) core("disconnect", { connId }).catch(() => {});
        st.conns.clear();
      }
      states.delete(container);
      container.replaceChildren();
    }

    function buildStudio(container: HTMLElement, root: HTMLElement) {
      const bar = el("div", "st-bar");
      const tabsEl = el("div", "st-tabs");
      const kibEl = el("div", "st-kib");
      const status = el("div", "st-status");
      const msgs = el("div", "st-msgs");
      const inrow = el("div", "st-in");
      const ta = document.createElement("textarea");
      ta.placeholder = "메시지… (Enter 전송, Shift+Enter 줄바꿈, @로 모델 지목) — 언제나 참견 가능";
      ta.rows = 1;
      ta.dataset.node = "input"; // contributes.nodes — 외부 주소(ui.input) 노출
      const send = document.createElement("button");
      send.textContent = "전송";
      send.dataset.node = "send";
      const mentionPop = el("div", "st-mention"); // @자동완성 팝업(체크된 참가 모델)
      mentionPop.style.display = "none";
      inrow.append(mentionPop, ta, send);

      const st: StudioState = {
        roster: ACTIVE_AGENTS.map((a) => ({ id: a.id, checked: true })),
        mode: settingMode(),
        conv: [],
        conns: new Map(),
        running: false,
        facilitatorId: ACTIVE_AGENTS[0]?.id ?? "", // 기본 진행자 = 첫 활성 에이전트
        pendingHuman: [],
        actives: new Set(),
        cwd: projectCwd(),
        msgs,
        tabsEl,
        kibEl,
        status,
      };
      states.set(container, st);
      activeStudio = st; // 라이브 send 명령의 타겟(마지막 마운트 = 활성)

      buildKibitz(st); // 모드 버튼(순차/진행/동시) — 클릭은 setMode 통과
      renderTabs(st, tabsEl);
      bar.append(elText("b", "Studio"), tabsEl, kibEl, status);
      root.append(bar, msgs, inrow);

      const doSend = () => {
        const t = ta.value.trim();
        if (!t) return;
        ta.value = "";
        hideMention();
        onHuman(st, t);
      };

      // @자동완성 — 커서 앞 '@부분단어'를 잡아 체크된 참가 모델 후보를 팝업. ↑↓ 이동, Enter/Tab/클릭 확정, Esc 닫기.
      let menTokens: { label: string; id: string }[] = [];
      let menActive = -1;
      let menStart = -1; // '@' 위치(교체 시작점)
      const hideMention = () => {
        mentionPop.style.display = "none";
        menActive = -1;
        menStart = -1;
      };
      const renderMention = () => {
        mentionPop.replaceChildren();
        menTokens.forEach((t, i) => {
          const row = el("div", "st-mention-item" + (i === menActive ? " on" : ""));
          row.style.color = COLOR[t.id] ?? "var(--fg,#ddd)";
          row.append(elText("span", "@", "st-mention-at"), elText("span", t.label, "st-mention-nm"));
          row.addEventListener("pointerdown", (e) => {
            e.preventDefault(); // textarea blur 방지
            pickMention(i);
          });
          mentionPop.appendChild(row);
        });
      };
      const pickMention = (i: number) => {
        const tok = menTokens[i];
        if (!tok || menStart < 0) return;
        const before = ta.value.slice(0, menStart);
        const after = ta.value.slice(ta.selectionStart);
        const insert = `@${tok.label} `;
        ta.value = before + insert + after;
        const caret = before.length + insert.length;
        ta.setSelectionRange(caret, caret);
        hideMention();
        ta.focus();
      };
      const updateMention = () => {
        const caret = ta.selectionStart;
        const pre = ta.value.slice(0, caret);
        const m = /@([^\s@]*)$/.exec(pre); // 커서 앞 '@단어'(공백 전까지)
        if (!m) return hideMention();
        const q = m[1].toLowerCase();
        const checked = new Set(participants(st.roster));
        menTokens = ACTIVE_AGENTS.filter((a) => checked.has(a.id))
          .map((a) => ({ label: a.label, id: a.id }))
          .filter((t) => !q || t.label.toLowerCase().startsWith(q) || t.id.startsWith(q));
        if (!menTokens.length) return hideMention();
        menStart = caret - m[0].length; // '@' 위치
        menActive = 0;
        renderMention();
        mentionPop.style.display = "block";
      };

      send.addEventListener("click", doSend);
      ta.addEventListener("input", updateMention);
      ta.addEventListener("keydown", (e) => {
        const open = mentionPop.style.display !== "none";
        if (open) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            menActive = (menActive + 1) % menTokens.length;
            return renderMention();
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            menActive = (menActive - 1 + menTokens.length) % menTokens.length;
            return renderMention();
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            return pickMention(menActive);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            return hideMention();
          }
        }
        if (e.key === "Enter" && !e.shiftKey && !(e as any).isComposing) {
          e.preventDefault();
          doSend();
        }
      });
      setStatus(st, "대기");
    }

    // 모드 변경 단일 경로 — 버튼 클릭·send 명령 모두 여기로. st.mode + 버튼 하이라이트 + 탭(👑) 을 함께 동기화.
    function setMode(st: StudioState, m: KibitzMode) {
      st.mode = m;
      for (const c of Array.from(st.kibEl.children) as HTMLElement[]) {
        c.classList.toggle("on", c.dataset.mode === m);
      }
      renderTabs(st, st.tabsEl); // 진행 모드 진입/이탈 시 👑 표시 갱신
    }

    // 모드 버튼(순차/진행/동시) — st.kibEl 에 채운다. 클릭은 setMode 통과(하이라이트·👑 동기화).
    function buildKibitz(st: StudioState) {
      const mk = (m: KibitzMode, label: string) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.dataset.mode = m;
        b.classList.toggle("on", m === st.mode);
        b.addEventListener("click", () => setMode(st, m));
        return b;
      };
      st.kibEl.append(mk("facil", "진행"), mk("turn", "순차"), mk("simul", "동시"));
    }

    // 로스터 탭 — 체크박스(참여) + 드래그(순서=턴 순서). 브랜드 색.
    function renderTabs(st: StudioState, tabsEl: HTMLElement) {
      tabsEl.replaceChildren();
      st.roster.forEach((entry) => {
        const a = AGENTS.find((x) => x.id === entry.id);
        const chip = el("div", "st-tab" + (entry.checked ? "" : " off"));
        chip.style.color = a?.color ?? "#888";
        chip.dataset.id = entry.id; // pointer reorder 의 드롭 타겟 식별
        chip.dataset.node = `tab/${entry.id}`; // contributes.nodes — 에이전트 탭 외부 노출(주소 tab/<agentId>)
        const chk = el("span", "chk");
        chk.textContent = entry.checked ? "✓" : "";
        const nm = elText("span", a?.label ?? entry.id, "nm");
        nm.style.color = "var(--fg,#ddd)";
        chip.append(chk, nm);
        // 진행 모드 — 체크된 탭에 👑(진행자 지정). 현 진행자만 채워진 왕관(시각). 지정은 아래 pointer 처리.
        if (st.mode === "facil" && entry.checked) {
          const crown = elText("span", "👑", "st-crown" + (entry.id === st.facilitatorId ? " on" : ""));
          crown.title = "진행자로 지정";
          chip.append(crown);
        }
        // 상호작용 — element setPointerCapture 가 이 웹뷰에서 불안정해 드래그가 "탭"으로 처리됐다(체크 토글 오작동).
        //   코어처럼 pointerdown 후 **window** 레벨 pointermove/up 으로 확실히 추적. 이동 있음=라이브 reorder(토글 안 함),
        //   이동 없음=탭(👑 위면 진행자 지정, 아니면 체크 토글).
        chip.addEventListener("pointerdown", (e) => {
          if ((e as PointerEvent).button !== 0) return;
          e.preventDefault();
          const startX = (e as PointerEvent).clientX;
          let moved = false;
          const onMove = (ev: PointerEvent) => {
            if (!moved && Math.abs(ev.clientX - startX) > 5) {
              moved = true;
              chip.classList.add("drag");
            }
            if (!moved) return;
            // 삽입 위치 = 중심이 포인터보다 오른쪽인 첫 형제 앞(없으면 맨 뒤). 갭 무관, 라이브로 칩이 따라 이동.
            let ref: Element | null = null;
            for (const s of Array.from(tabsEl.children)) {
              if (s === chip) continue;
              const r = s.getBoundingClientRect();
              if (ev.clientX < r.left + r.width / 2) {
                ref = s;
                break;
              }
            }
            if (chip.nextSibling !== ref) tabsEl.insertBefore(chip, ref);
          };
          const onUp = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            chip.classList.remove("drag");
            if (moved) {
              // 드래그 — 라이브로 옮긴 DOM 순서를 st.roster 에 반영(체크 토글 절대 안 함).
              const order = (Array.from(tabsEl.children) as HTMLElement[]).map((c) => c.dataset.id ?? "");
              st.roster.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
            } else {
              // 탭(이동 없음) — 👑 위면 진행자 지정, 아니면 체크 토글.
              const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
              if (under?.closest(".st-crown") && st.mode === "facil") st.facilitatorId = entry.id;
              else entry.checked = !entry.checked;
            }
            renderTabs(st, tabsEl);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        });
        tabsEl.appendChild(chip);
      });
    }

    function setStatus(st: StudioState, t: string) {
      st.status.textContent = t;
    }

    // 사람 발화 — 언제나 최우선. 멈춰 있으면 바로 구동. 진행 중이면 현재 발화(들)를 '지금까지'로 끊고(중단)
    // 부분응답을 종결 보존한 뒤, 사람 입력을 그 뒤로 세션 주입하고 새 라운드 재구동(취소-제거 아님 — 사람 대화처럼).
    // 진행 중일 땐 사람 메시지를 여기서 push/render 하지 않는다 — 드라이브가 부분응답 종결 직후 주입(올바른 순서).
    function onHuman(st: StudioState, text: string) {
      if (!st.running) {
        st.conv.push({ who: "human", text });
        renderUser(st, text);
        void runLoop(st);
        return;
      }
      st.pendingHuman.push(text);
      for (const c of st.actives) engine.cancel(c.connId, c.sessionId); // 진행 중 전부 중단(동시=N)
      setStatus(st, "참견 — 현재 발화 종결 후 반영");
    }

    // 대기 중 사람 입력을 세션에 주입 — 부분응답 종결 직후 호출(순서: 발화 → 사람). conv push + 렌더.
    function injectPending(st: StudioState) {
      for (const t of st.pendingHuman) {
        st.conv.push({ who: "human", text: t });
        renderUser(st, t);
      }
      st.pendingHuman = [];
    }

    // 세션 오류(순단 포함) → 해당 에이전트 자동 체크 해제(roster 드롭). 다음 라운드 참여에서 빠지고, 사람이
    // 탭을 다시 켜서 재소환한다(이상하면 사람이 판단). 이미 꺼져 있으면 no-op.
    function dropAgent(st: StudioState, agentId: string) {
      const entry = st.roster.find((r) => r.id === agentId);
      if (entry?.checked) {
        entry.checked = false;
        renderTabs(st, st.tabsEl);
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

    // 한 발화 — 연결·세션·라이브 스트리밍·버블 확정. 순차/동시 공용. 성공/부분=work 반환(호출자가 conv 에 push).
    // 참견 중단 시 코어가 최종 텍스트를 못 줘도 스트리밍된 부분(liveRaw)을 '말해진 것'으로 종결 보존(취소-제거 아님).
    // 연결/세션/프롬프트 오류(순단 포함)=사유 행 + system 메시지 + 해당 에이전트 자동 체크 해제. 침묵(빈 ok)=흔적 없이.
    async function runOneTurn(st: StudioState, speaker: string, prompt: string): Promise<string> {
      const row = renderTurnRow(st, speaker);
      const fail = (reason: string) => {
        row.fail(reason);
        row.setEnd();
        st.conv.push({ who: "system", text: `${nameOf(speaker)} ${reason}` });
        dropAgent(st, speaker); // 세션 오류 → 자동 체크 해제(사람이 재체크로 재소환)
      };
      const conn = await ensureConn(st, speaker);
      if ("error" in conn) {
        fail(`연결 실패: ${conn.error}`); // codex ENOENT 등 사유를 그대로 노출
        return "";
      }
      const connId = conn.connId;
      let sessionId: string;
      try {
        sessionId = await engine.newSession(connId, st.cwd);
      } catch (e) {
        fail(`세션 실패: ${String(e)}`);
        return "";
      }
      // 버블은 아직 안 만든다 — "응답 중…" 인디케이터를 첫 스트리밍 청크(또는 최종 텍스트)까지 유지.
      const cur: Current = { agentId: speaker, connId, sessionId, row, bubble: null, liveRaw: "" };
      st.actives.add(cur); // 동시=N개 병렬 등록(각자 connId 로 독립 스트리밍)
      const off = app.bus.on(`acp.update.${connId}`, (evt: any) => onStream(cur, evt));
      let r: any;
      try {
        r = await core("prompt", { connId, sessionId, text: prompt });
      } catch (e) {
        r = { ok: false, error: String(e) };
      }
      off.dispose(); // app.bus.on 은 Disposable{dispose} 반환 — 함수 호출(off()) 은 throw → 구독 누수·누적
      st.actives.delete(cur);
      // work = 코어 dedup 최종 r.text 우선, 없으면 스트리밍된 부분(liveRaw — 참견 중단 시 '지금까지' 보존).
      const streamed = cur.liveRaw.trim();
      const work = (r.ok && (r.text ?? "").trim()) || streamed;
      if (work) {
        (cur.bubble ?? (cur.bubble = row.toBubble())).textContent = work; // 인디케이터→버블(없었으면 생성)
        row.setEnd();
        if (typeof r.reasoning === "string" && r.reasoning) row.setReasoning(r.reasoning); // 💭 배지
        return work;
      }
      if (!r.ok) {
        fail(`프롬프트 실패: ${String(r.error ?? "")}`); // 오류 → 노출 + 자동 드롭
        return "";
      }
      row.remove(); // 빈 ok = 의도된 침묵(또는 참견 직격, 한 글자도 안 나옴) — 흔적 없이(침묵도 참여)
      return "";
    }

    // @멘션 해소 — 주 구동 뒤, 새 발화에서 '@이름' 지목을 수집해 그 동료를 발화시킨다(체크 안 된 구경꾼도 깨움).
    // 지목된 발화가 또 누굴 부르면 연쇄. depthCap(설정 nameTriggerDepthCap) 안전판. 참견 들어오면 즉시 양보.
    async function resolveMentions(st: StudioState, scanFrom: number) {
      const ids = st.roster.map((x) => x.id);
      let from = scanFrom;
      for (let depth = 0; depth < settingDepthCap(); depth++) {
        const targets: string[] = [];
        for (const u of st.conv.slice(from)) {
          if (u.who === "human" || u.who === "system") continue;
          for (const id of detectMentions(u.text, ids, u.who, nameOf)) {
            if (!targets.includes(id)) targets.push(id);
          }
        }
        from = st.conv.length; // 다음 스캔은 새 발화만(무한 재호명 방지)
        if (!targets.length) return;
        for (const id of targets) {
          if (st.pendingHuman.length) return; // 참견 — 상위 루프가 주입·재구동
          setStatus(st, `${nameOf(id)} 지목 응답 중…`);
          const prompt = buildPrompt({
            roster: st.roster,
            conversation: st.conv,
            speaker: id,
            nameOf,
            preamble: `${inviteePreamble(id, ids, nameOf, st.cwd, st.mode)}\n(당신이 @${nameOf(id)} 으로 지목되었습니다 — 위 대화에 이어 답하세요.)`,
          });
          const work = await runOneTurn(st, id, prompt);
          if (work) st.conv.push({ who: id, text: work });
        }
      }
    }

    // 순차(turn) 구동 — 탭 순서대로 각 1회(라운드로빈 폐기 — 한 바퀴). 매 발화 전후 참견(pendingHuman) 체크 시
    // 라운드 중단(상위가 사람 입력 주입·재구동). 라운드 중 체크 해제된 에이전트(오류 자동 드롭·수동)는 건너뜀.
    async function driveSequential(st: StudioState, ids: string[]) {
      const parts = participants(st.roster);
      for (const speaker of parts) {
        if (st.pendingHuman.length) return; // 참견 — 라운드 중단
        if (!st.roster.find((r) => r.id === speaker)?.checked) continue; // 중도 드롭 — 건너뜀
        setStatus(st, `${nameOf(speaker)} 응답 중…`);
        const prompt = buildPrompt({
          roster: st.roster,
          conversation: st.conv,
          speaker,
          nameOf,
          preamble: inviteePreamble(speaker, ids, nameOf, st.cwd, "turn"),
        });
        const work = await runOneTurn(st, speaker, prompt);
        if (work) st.conv.push({ who: speaker, text: work });
        if (st.pendingHuman.length) return; // 발화 직후 참견 — 중단
      }
    }

    // 한 동료 발화 — 진행자가 호출하는 단위(facil). 체크 확인·프롬프트·runOneTurn·conv push.
    async function facilTurn(st: StudioState, id: string, ids: string[]) {
      if (!st.roster.find((r) => r.id === id)?.checked) return;
      setStatus(st, `${nameOf(id)} 응답 중…`);
      const prompt = buildPrompt({
        roster: st.roster,
        conversation: st.conv,
        speaker: id,
        nameOf,
        preamble: inviteePreamble(id, ids, nameOf, st.cwd, "facil"),
      });
      const w = await runOneTurn(st, id, prompt);
      if (w) st.conv.push({ who: id, text: w });
    }

    // 진행(facil) 구동 — 진행자가 사람의 단일 창구. 매 LOOP: [진행자 턴] → 지시 파싱 → 동료를 동시/순차/선택으로
    // 호출 → await 완료(=stall) → 진행자 복귀. 지시 없음(none)=마무리 신호 → 종료. 하드 cap(settingFacilMax).
    async function driveFacilitated(st: StudioState, ids: string[]) {
      const checked = participants(st.roster);
      if (!checked.length) return;
      // 진행자 = 명시 facilitatorId 가 체크돼 있으면 그것, 아니면 첫 체크.
      const facilitator = checked.includes(st.facilitatorId)
        ? st.facilitatorId
        : (pickFacilitator(st.roster) ?? checked[0]);
      const cap = settingFacilMax();
      for (let round = 0; round < cap; round++) {
        if (st.pendingHuman.length) return; // 참견 — 상위가 주입·재구동
        // [진행자 턴]
        setStatus(st, `${nameOf(facilitator)} 진행 중…`);
        const lastRound = round >= cap - 1;
        const fprompt = buildPrompt({
          roster: st.roster,
          conversation: st.conv,
          speaker: facilitator,
          nameOf,
          preamble:
            facilitatorPreamble(facilitator, ids, nameOf, st.cwd) +
            (lastRound ? "\n(이번이 마지막 진행 차례입니다 — 정리하고 마무리하세요.)" : ""),
        });
        const fwork = await runOneTurn(st, facilitator, fprompt);
        if (fwork) st.conv.push({ who: facilitator, text: fwork });
        if (st.pendingHuman.length) return;
        if (!fwork) return; // 진행자 침묵/실패 → 종료
        // [지시 파싱]
        const dir = parseFacilitatorDirective(fwork, ids, facilitator, nameOf);
        if (dir.pattern === "none") return; // 지시 없음 = 마무리 → 휴면
        const targets = (dir.targets.length ? dir.targets : checked).filter(
          (id) => id !== facilitator && st.roster.find((r) => r.id === id)?.checked,
        );
        if (!targets.length) continue; // 부를 동료 없음 → 다음 진행자 턴
        // [동료 응답] 동시=병렬 / 순차·선택=순서대로
        if (dir.pattern === "simul") {
          await Promise.all(targets.map((id) => facilTurn(st, id, ids)));
        } else {
          for (const id of targets) {
            if (st.pendingHuman.length) return;
            await facilTurn(st, id, ids);
          }
        }
        // stall(동료 응답 완료) → 다음 LOOP(진행자 복귀·재판단)
      }
      setStatus(st, "진행 한도 도달 — 마무리"); // 하드 cap 도달 → 종료
    }

    // 라이브 구동 — 모드별 한 구동(turn=순차 1라운드 / simul=병렬 1라운드 / facil=진행자 LOOP). turn·simul 뒤엔
    // @멘션 해소(facil 은 진행자가 조율하므로 별도 @해소 안 함). 참견(pendingHuman)이 들어오면 부분응답 종결 직후
    // 사람 입력을 주입하고 재구동. 참견 없으면 종료(사람 입력 대기).
    // 사람 입력의 @지목 — 트레일링 사람 메시지에서 '@모델'을 모아 체크된 참여자만(중복 제거). 모드 무관 직행 대상.
    function humanTargets(st: StudioState): string[] {
      const ids = st.roster.map((r) => r.id);
      const checked = new Set(participants(st.roster));
      const targets: string[] = [];
      for (let i = st.conv.length - 1; i >= 0; i--) {
        if (st.conv[i].who !== "human") break; // 연속된 트레일링 사람 입력만
        for (const id of detectMentions(st.conv[i].text, ids, "human", nameOf)) {
          if (checked.has(id) && !targets.includes(id)) targets.push(id);
        }
      }
      return targets;
    }

    // 사람이 @지목 → 그 모델들만 병렬 1회(동시). 모드 무관(진행 모드의 진행자도 우회). 스냅샷 고정 = 서로 안 봄.
    async function driveTargeted(st: StudioState, ids: string[], targets: string[]) {
      const snapshot = st.conv.slice();
      await Promise.all(
        targets.map(async (id) => {
          setStatus(st, `${nameOf(id)} 응답 중…`);
          const prompt = buildPrompt({
            roster: st.roster,
            conversation: snapshot,
            speaker: id,
            nameOf,
            preamble: inviteePreamble(id, ids, nameOf, st.cwd, "simul"),
          });
          const w = await runOneTurn(st, id, prompt);
          if (w) st.conv.push({ who: id, text: w });
        }),
      );
    }

    async function runLoop(st: StudioState) {
      st.running = true;
      const ids = st.roster.map((x) => x.id);
      for (;;) {
        const scanFrom = st.conv.length;
        const targets = humanTargets(st); // 사람 @지목 — 있으면 모드 무관 직행(병렬)
        if (targets.length) {
          await driveTargeted(st, ids, targets);
        } else if (st.mode === "simul") {
          await driveSimul({
            roster: st.roster,
            conversation: st.conv,
            nameOf,
            preamble: (s) => inviteePreamble(s, ids, nameOf, st.cwd, "simul"),
            onTurnStart: () => setStatus(st, "동시 응답 중…"),
            turn: (speaker, prompt) => runOneTurn(st, speaker, prompt),
          });
        } else if (st.mode === "facil") {
          await driveFacilitated(st, ids);
        } else {
          await driveSequential(st, ids);
        }
        if (st.pendingHuman.length) {
          injectPending(st); // 참견 — 부분응답 종결 뒤 사람 입력 주입(순서: 발화 → 사람)
          continue; // 재구동
        }
        // @지목 직행·진행 모드는 @연쇄 안 함(직행 답 / 진행자 조율). 그 외(순차·동시)만 @멘션 해소.
        if (!targets.length && st.mode !== "facil") {
          await resolveMentions(st, scanFrom);
          if (st.pendingHuman.length) {
            injectPending(st);
            continue;
          }
        }
        break; // 참견 없음 — 종료
      }
      st.running = false;
      st.actives.clear();
      setStatus(st, "대기");
    }

    // 라이브 스트리밍 — 현재 화자의 agent_message_chunk 를 버블에 누적. 코어 dedup 일치(최종 완결 재전송, 누적
    // 전체 1회) skip. 최종 권위 텍스트(또는 참견 부분)는 완료 시 runOneTurn 이 확정.
    function onStream(cur: Current, evt: any) {
      const u = evt?.update;
      if (!u || u.sessionUpdate !== "agent_message_chunk") return;
      const t = u.content?.text ?? "";
      if (t !== "" && t === cur.liveRaw) return; // 최종 재전송 skip
      cur.liveRaw += t;
      if (t) {
        // 첫 청크에서 "응답 중…" 인디케이터 → 버블 생성(그 전까진 인디케이터 유지).
        if (!cur.bubble) cur.bubble = cur.row.toBubble();
        cur.bubble.textContent = (cur.bubble.textContent || "") + t;
      }
    }

    // ── 렌더 헬퍼 ──
    function renderUser(st: StudioState, text: string) {
      const row = el("div", "st-row user");
      const who = el("div", "st-who");
      who.append(elText("span", "나", "st-who-name"), elText("span", ` · ${hhmmss()}`, "st-who-time"));
      row.append(who, bubble(text));
      st.msgs.appendChild(row);
      scroll(st);
    }
    // 턴 행 — 이름 + 본문(처음엔 "응답 중…" 맥동 인디케이터). toBubble()=빈 버블로 교체(스트리밍),
    // fail(reason)=사유 노출(연결/세션/빈응답 실패를 조용히 숨기지 않음), remove()=행 폐기(참견 재시작).
    function renderTurnRow(st: StudioState, agentId: string) {
      const row = el("div", "st-row assistant");
      const who = el("div", "st-who");
      const nameEl = elText("span", nameOf(agentId), "st-who-name");
      nameEl.style.color = COLOR[agentId] ?? "var(--fg3,#888)";
      const timeEl = el("span", "st-who-time"); // 발화 시작→종료 시각(관찰·디버깅)
      const startStamp = hhmmss(); // 발화 시작(턴 시작) 시각 — 즉시 표시
      timeEl.textContent = ` · ${startStamp}`;
      who.append(nameEl, timeEl);
      const pending = el("div", "st-pending");
      pending.append(el("span", "st-dot"), document.createTextNode("응답 중…"));
      row.append(who, pending);
      st.msgs.appendChild(row);
      scroll(st);
      let body: HTMLElement = pending;
      let endTimeEl: HTMLElement | null = null; // 현재 본문 박스의 우하단 종료시각 슬롯
      const swap = (next: HTMLElement) => {
        body.replaceWith(next);
        body = next;
        scroll(st);
      };
      return {
        toBubble(): HTMLElement {
          const box = el("div", "st-bubble");
          const text = el("span", "st-bubble-text"); // 스트리밍·최종 텍스트는 여기(아래 time 슬롯 보존)
          const time = el("span", "st-box-time"); // 우하단 종료 시각
          box.append(text, time);
          endTimeEl = time;
          swap(box);
          return text;
        },
        fail(reason: string) {
          const box = el("div", "st-fail");
          box.title = reason; // 전문은 hover(여러 줄 stderr)
          const time = el("span", "st-box-time");
          box.append(elText("span", `⚠ ${reason}`, "st-fail-text"), time);
          endTimeEl = time;
          swap(box);
        },
        // 발화 종료 — 종료 시각을 버블/실패 박스 안 우하단에(시작 시각은 이름 옆에 이미 찍힘).
        setEnd() {
          if (endTimeEl) endTimeEl.textContent = hhmmss();
        },
        // 리소닝/띵킹(agent_thought_chunk) — 💭 배지(클릭하면 펼침). 작업 텍스트와 분리, 기본 접힘.
        setReasoning(text: string) {
          if (!text.trim()) return;
          const badge = elText("span", "💭 생각", "st-think");
          badge.title = "클릭하면 리소닝 펼치기/접기";
          const panel = elText("div", text, "st-think-body");
          panel.style.display = "none";
          badge.addEventListener("click", () => {
            const open = panel.style.display === "none";
            panel.style.display = open ? "block" : "none";
            badge.classList.toggle("open", open);
            if (open) scroll(st);
          });
          who.appendChild(badge);
          row.appendChild(panel); // 본문 아래에 접힌 패널
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
    // 현재 시각 HH:MM:SS(발화 타임스탬프 — 관찰·디버깅).
    function hhmmss(): string {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }
    function bubble(text: string): HTMLElement {
      const b = el("div", "st-bubble");
      b.textContent = text;
      return b;
    }
  },
  deactivate() {},
};
