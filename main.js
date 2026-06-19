// src/engine.ts
var CORE = "plugin.soksak-plugin-acp-core.";
function createEngine(app) {
  const core = (name, params) => app.commands.execute(CORE + name, params ?? {});
  async function connect(launch, cwd, permission) {
    const params = launch.agent ? { agent: launch.agent, cwd, permission } : { cmd: launch.cmd, args: launch.args, cwd, permission };
    const c = await core("connect", params);
    if (!c.ok) throw new Error(c.error || c.message || "connect \uC2E4\uD328");
    const s = await core("session-new", { connId: c.connId, cwd });
    if (!s.ok) throw new Error(s.error || s.message || "session \uC2E4\uD328");
    return { connId: c.connId, sessionId: s.sessionId };
  }
  async function newSession(connId, cwd) {
    const s = await core("session-new", { connId, cwd });
    if (!s.ok) throw new Error(s.error || s.message || "session \uC2E4\uD328");
    return s.sessionId;
  }
  async function ask(connId, sessionId, text) {
    const r = await core("prompt", { connId, sessionId, text });
    if (!r.ok) throw new Error(r.error || r.message || "prompt \uC2E4\uD328");
    return { text: r.text ?? "", updates: r.updates ?? [], stopReason: r.stopReason };
  }
  async function cancel(connId, sessionId) {
    await core("cancel", { connId, sessionId }).catch(() => {
    });
  }
  async function disconnect(connId) {
    await core("disconnect", { connId }).catch(() => {
    });
  }
  async function snapshot(cwd) {
    const m = /* @__PURE__ */ new Map();
    if (!cwd || !app.fs?.list) return m;
    try {
      const r = await app.fs.list(cwd, { meta: true });
      for (const ch of r?.children ?? []) if (!ch.dir) m.set(ch.name, ch.modified ?? 0);
    } catch {
    }
    return m;
  }
  function diffWritten(before, after) {
    const out = [];
    for (const [name, mt] of after) if (!before.has(name) || before.get(name) !== mt) out.push(name);
    return out.sort();
  }
  return { connect, newSession, ask, cancel, disconnect, snapshot, diffWritten };
}

// src/conversation.ts
function participants(roster) {
  return roster.filter((r) => r.checked).map((r) => r.id);
}
function nextSpeaker(parts, mode, agentTurnCount, maxRounds) {
  if (parts.length === 0) return null;
  if (mode === "turn") return agentTurnCount < parts.length ? parts[agentTurnCount] : null;
  const cap = Math.max(1, maxRounds) * parts.length;
  return agentTurnCount < cap ? parts[agentTurnCount % parts.length] : null;
}
function buildPrompt(opts) {
  const name = (id) => opts.nameOf ? opts.nameOf(id) : id;
  const others = opts.roster.filter((r) => r.checked && r.id !== opts.speaker).map((r) => name(r.id));
  const room = others.length ? `\uC774 \uC791\uC5C5\uACF5\uAC04\uC5D4 \uB3D9\uB8CC ${others.join(", ")}\uC640(\uACFC) \uB2F9\uC2E0(${name(opts.speaker)})\uC774 \uD568\uAED8 \uC788\uC2B5\uB2C8\uB2E4.` : `\uC9C0\uAE08\uC740 \uB2F9\uC2E0(${name(opts.speaker)}) \uD63C\uC790\uC785\uB2C8\uB2E4.`;
  const lines = opts.conversation.map(
    (m) => `${m.who === "human" ? "\uC0AC\uC6A9\uC790" : name(m.who)}: ${m.text}`
  );
  const convo = lines.length ? `

[\uC9C0\uAE08\uAE4C\uC9C0\uC758 \uB300\uD654]
${lines.join("\n\n")}` : "";
  const base = opts.preamble ?? `\uB2F9\uC2E0\uC740 ${name(opts.speaker)}\uC785\uB2C8\uB2E4. ${room} \uC704 \uB300\uD654\uC5D0 \uC774\uC5B4 \uB2F9\uC2E0\uC758 \uCC28\uB840\uB85C \uC751\uB2F5\uD558\uC138\uC694. \uD544\uC694\uD55C \uC791\uC5C5\uC774 \uC788\uC73C\uBA74 \uC124\uBA85\uB9CC \uD558\uC9C0 \uB9D0\uACE0 \uB2F9\uC2E0\uC758 \uB3C4\uAD6C\uB85C \uC2E4\uC81C \uD30C\uC77C\uC744 \uB9CC\uB4E4\uAC70\uB098 \uBA85\uB839\uC744 \uC2E4\uD589\uD574 \uCC98\uB9AC\uD558\uC138\uC694.`;
  return `${base}${convo}`;
}
async function driveExchange(opts) {
  const parts = participants(opts.roster);
  let agentTurns = 0;
  for (; ; ) {
    const speaker = nextSpeaker(parts, opts.mode, agentTurns, opts.maxRounds);
    if (!speaker) break;
    opts.onTurnStart?.(speaker);
    const prompt = buildPrompt({
      roster: opts.roster,
      conversation: opts.conversation,
      speaker,
      nameOf: opts.nameOf,
      preamble: opts.preamble?.(speaker)
    });
    let text = "";
    try {
      text = (await opts.turn(speaker, prompt)).trim();
    } catch {
      text = "";
    }
    if (opts.consumeInterject?.()) {
      opts.onDiscard?.(speaker);
      continue;
    }
    if (text) {
      const u = { who: speaker, text };
      opts.conversation.push(u);
      opts.onUtterance?.(u);
    }
    agentTurns++;
  }
}

// src/clubhouse.ts
var CHANNELS = ["\uD68C\uACE0", "\uC7A1\uB2F4"];
var OPEN = { \uD68C\uACE0: "<\uD68C\uACE0>", \uC7A1\uB2F4: "<\uC7A1\uB2F4>" };
var CLOSE = { \uD68C\uACE0: "</\uD68C\uACE0>", \uC7A1\uB2F4: "</\uC7A1\uB2F4>" };
function partialTail(s, markers) {
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
function createTagDemux() {
  let buf = "";
  let mode = "out";
  let work = "";
  let clubCur = "";
  const club = [];
  const OPENS = CHANNELS.map((k) => OPEN[k]);
  function step(final) {
    for (; ; ) {
      if (mode === "out") {
        let idx = -1;
        let ch = null;
        for (const k of CHANNELS) {
          const i2 = buf.indexOf(OPEN[k]);
          if (i2 >= 0 && (idx < 0 || i2 < idx)) {
            idx = i2;
            ch = k;
          }
        }
        if (idx >= 0 && ch) {
          work += buf.slice(0, idx);
          buf = buf.slice(idx + OPEN[ch].length);
          mode = ch;
          continue;
        }
        const hold2 = final ? 0 : partialTail(buf, OPENS);
        work += buf.slice(0, buf.length - hold2);
        buf = buf.slice(buf.length - hold2);
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
    push(chunk) {
      const before = work.length;
      buf += chunk;
      step(false);
      return work.slice(before);
    },
    end() {
      step(true);
      if (mode !== "out" && clubCur.trim()) {
        club.push({ kind: mode, text: clubCur.trim() });
      }
      clubCur = "";
      mode = "out";
      return { work: work.trim(), club };
    }
  };
}
function demux(text) {
  const d = createTagDemux();
  d.push(text);
  return d.end();
}
var ADDRESS_CUE = /[?？]|어때|어떻게|생각|봐줄|봐 줄|어찌|동의|반박|해줄|해 줄|덧붙|이어/;
function detectSummon(text, roster, speaker, nameOf2) {
  if (!ADDRESS_CUE.test(text)) return null;
  let best = null;
  for (const id of roster) {
    if (id === speaker) continue;
    for (const cand of [nameOf2(id), id]) {
      const i = text.indexOf(cand);
      if (i >= 0 && (!best || i < best.idx)) best = { id, idx: i };
    }
  }
  return best ? best.id : null;
}
function inviteePreamble(speaker, roster, nameOf2, cwd) {
  const others = roster.filter((id) => id !== speaker).map(nameOf2);
  const room = others.length ? `\uB3D9\uB8CC ${others.join(", ")} \uC640(\uACFC) \uB2F9\uC2E0(${nameOf2(speaker)})\uC774 \uD568\uAED8 \uC788\uC2B5\uB2C8\uB2E4.` : `\uC9C0\uAE08\uC740 \uB2F9\uC2E0(${nameOf2(speaker)}) \uD63C\uC790\uC785\uB2C8\uB2E4.`;
  const place = cwd ? ` \uC791\uC5C5 \uB514\uB809\uD130\uB9AC\uB294 ${cwd} \uC785\uB2C8\uB2E4.` : "";
  return (
    // 방 정체성 — 무엇 하는 곳인지(협업 채팅방). 이게 없으면 에이전트가 솔로 세션처럼 자기 셋업을 늘어놓는다.
    `\uC5EC\uAE30\uB294 'Studio' \u2014 \uC5EC\uB7EC AI \uCF54\uB529 \uC5D0\uC774\uC804\uD2B8\uAC00 \uD55C \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4\uC5D0\uC11C \uC0AC\uC6A9\uC790\uC758 \uC77C\uC744 \uD568\uAED8 \uD558\uB294 \uD611\uC5C5 \uCC44\uD305\uBC29\uC785\uB2C8\uB2E4. ${room}${place}
\uB2F9\uC2E0\uC740 ${nameOf2(speaker)} \uBCF8\uC778\uC73C\uB85C\uC11C \uC774 \uB300\uD654\uC5D0 \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uCC38\uC5EC\uD558\uC138\uC694:
- \uC0AC\uC6A9\uC790\uC640 \uB3D9\uB8CC\uC758 \uB9D0\uC5D0 \uC9C1\uC811 \uBC18\uC751\uD558\uC138\uC694. \uB3D9\uB8CC\uAC00 \uC774\uBBF8 \uD55C \uB9D0\uC744 \uBC18\uBCF5\uD558\uC9C0 \uB9D0\uACE0, \uBCF4\uD0DC\uAC70\uB098(\uB2E4\uB978 \uAD00\uC810\xB7\uAC80\uC99D\xB7\uBC18\uB860) \uC5ED\uD560\uC744 \uB098\uB220 \uB9E1\uC73C\uC138\uC694.
- \uC791\uC5C5\uC774 \uD544\uC694\uD558\uBA74 \uC124\uBA85\uB9CC \uD558\uC9C0 \uB9D0\uACE0 \uB2F9\uC2E0\uC758 \uB3C4\uAD6C\uB85C \uC2E4\uC81C \uD30C\uC77C/\uBA85\uB839\uC73C\uB85C \uCC98\uB9AC\uD558\uC138\uC694(\uC704 \uC791\uC5C5 \uB514\uB809\uD130\uB9AC \uAE30\uC900).
- \uB2F9\uC2E0\uC758 \uB0B4\uBD80 \uC808\uCC28(\uC5B4\uB5A4 \uC2A4\uD0AC\uC744 \uC4F0\uB294\uC9C0, \uC138\uC158 \uC124\uC815\xB7\uADDC\uCE59 \uD655\uC778 \uB4F1)\uB294 \uB300\uD654\uC5D0 \uC801\uC9C0 \uB9C8\uC138\uC694 \u2014 \uC778\uC0AC\xB7\uC758\uACAC\xB7\uACB0\uACFC\uB9CC \uC790\uC5F0\uC2A4\uB7FD\uAC8C.
[\uC0AC\uAD50 \u2014 \uC120\uD0DD] \uC791\uC5C5\uACFC \uBCC4\uAC1C\uB85C \uD68C\uACE0\uB098 \uC7A1\uB2F4\uC774 \uB5A0\uC624\uB974\uBA74 <\uD68C\uACE0>\u2026</\uD68C\uACE0> \uB610\uB294 <\uC7A1\uB2F4>\u2026</\uC7A1\uB2F4> \uD0DC\uADF8\uB85C \uB367\uBD99\uC5EC\uB3C4 \uB429\uB2C8\uB2E4(\uC5C6\uC73C\uBA74 \uC548 \uC368\uB3C4 \uB429\uB2C8\uB2E4). \uB3D9\uB8CC \uC758\uACAC\uC774 \uAD81\uAE08\uD558\uBA74 \uADF8 \uD0DC\uADF8 \uC548\uC5D0\uC11C \uC774\uB984\uC744 \uBD80\uB974\uC138\uC694(\uC608: "${others[0] ?? "\uB3D9\uB8CC"}, \uB108\uB294 \uC5B4\uB5BB\uAC8C \uC0DD\uAC01\uD574?"). \uD0DC\uADF8 \uBC16\uC740 \uC791\uC5C5\uCC3D, \uD0DC\uADF8 \uC548\uC740 Clubhouse \uC5D0\uB9CC \uBCF4\uC785\uB2C8\uB2E4.`
  );
}
function buildSummonPrompt(opts) {
  const name = opts.nameOf;
  const work = opts.studioConversation.map((m) => `${m.who === "human" ? "\uC0AC\uC6A9\uC790" : name(m.who)}: ${m.text}`).join("\n");
  const feed = opts.posts.map((p) => `${name(p.who)} <${p.channel}>: ${p.text}`).join("\n");
  return `\uB2F9\uC2E0\uC740 ${name(opts.summoned)}\uC785\uB2C8\uB2E4. \uC0AC\uAD50 \uACF5\uAC04(Clubhouse)\uC5D0\uC11C ${name(opts.by)}\uC774(\uAC00) \uB2F9\uC2E0\uC744 \uBD88\uB800\uC5B4\uC694. \uD3B8\uD558\uAC8C \uD55C\uB9C8\uB514 \uD558\uAC70\uB098(\uC6D0\uCE58 \uC54A\uC73C\uBA74 \uCE68\uBB35\uD574\uB3C4 \uB429\uB2C8\uB2E4 \u2014 \uAC15\uC81C \uC544\uB2D8), \uB2E4\uB978 \uB3D9\uB8CC\uC5D0\uAC8C \uB2E4\uC2DC \uBB3C\uC5B4\uB3C4 \uB429\uB2C8\uB2E4. \uD558\uACE0 \uC2F6\uC740 \uB9D0\uC740 <\uC7A1\uB2F4>\u2026</\uC7A1\uB2F4> \uB610\uB294 <\uD68C\uACE0>\u2026</\uD68C\uACE0> \uD0DC\uADF8 \uC548\uC5D0 \uC801\uC73C\uC138\uC694(\uB3D9\uB8CC \uD638\uBA85\uB3C4 \uD0DC\uADF8 \uC548\uC5D0\uC11C).

[\uBC29\uAE08\uAE4C\uC9C0\uC758 \uC791\uC5C5]
${work || "(\uC5C6\uC74C)"}

[\uC9C0\uAE08\uAE4C\uC9C0\uC758 \uD074\uB7FD\uD558\uC6B0\uC2A4 \uB300\uD654]
${feed || "(\uC5C6\uC74C)"}`;
}
async function relaySummons(opts) {
  const posts = [];
  const emit = (who, segs) => {
    for (const s of segs) {
      const p = { who, channel: s.kind, text: s.text };
      posts.push(p);
      opts.onPost?.(p);
    }
  };
  emit(opts.speaker, opts.club);
  let lastSpeaker = opts.speaker;
  let lastClub = opts.club;
  for (let depth = 0; depth < opts.depthCap; depth++) {
    let summoned = null;
    for (const s of lastClub) {
      summoned = detectSummon(s.text, opts.roster, lastSpeaker, opts.nameOf);
      if (summoned) break;
    }
    if (!summoned) break;
    let reaction = [];
    try {
      reaction = await opts.wake(summoned, posts.slice());
    } catch {
      reaction = [];
    }
    if (!reaction.length) break;
    emit(summoned, reaction);
    lastSpeaker = summoned;
    lastClub = reaction;
  }
  return posts;
}

// src/main.ts
var AGENTS = [
  { id: "claude", label: "Claude", color: "#d97757" },
  { id: "codex", label: "Codex", color: "#10a37f" },
  { id: "gemini", label: "Gemini", color: "#4285f4" }
];
var NAME = { claude: "Claude", codex: "Codex", gemini: "Gemini" };
var COLOR = Object.fromEntries(AGENTS.map((a) => [a.id, a.color]));
var nameOf = (id) => NAME[id] ?? id;
var CHANNEL_EMOJI = { \uD68C\uACE0: "\u{1FA9E}", \uC7A1\uB2F4: "\u{1F4AC}" };
var FREE_ROUNDS = 2;
var CSS = `
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
.club2-ch.\uD68C\uACE0{color:#a9b665}.club2-ch.\uC7A1\uB2F4{color:#7daea3}
.club2-summon{font-size:10px;color:#d8a657;font-weight:600}
.club2-body{white-space:pre-wrap;word-break:break-word;line-height:1.45}
`;
var main_default = {
  activate(ctx) {
    const app = ctx.app;
    const core = (name, params) => app.commands.execute("plugin.soksak-plugin-acp-core." + name, params ?? {});
    const engine = createEngine(app);
    const settingPolicy = () => app.settings?.get("permissionPolicy") || void 0;
    const settingMode = () => app.settings?.get("kibitzDefault") === "free" ? "free" : "turn";
    const settingDepthCap = () => Math.max(1, Number(app.settings?.get("nameTriggerDepthCap")) || 4);
    const projectCwd = () => app.project?.current?.()?.root;
    const FEED_CAP = 300;
    const feedKey = (cwd) => {
      const s = cwd || "global";
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) >>> 0;
      return `feed${h.toString(36)}`;
    };
    async function loadFeed(cwd) {
      try {
        const v = await app.storage?.read(feedKey(cwd));
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    }
    async function appendFeed(cwd, posts) {
      if (!posts.length || !app.storage) return;
      try {
        const cur = await loadFeed(cwd);
        await app.storage.write(feedKey(cwd), [...cur, ...posts].slice(-FEED_CAP));
      } catch {
      }
    }
    async function signalEmergence(cwd, chainPosts) {
      if (app.settings?.get("mailboxSignal") === "off") return false;
      const whos = [...new Set(chainPosts.map((p) => p.who))];
      if (whos.length < 2) return false;
      const names = whos.map(nameOf).join(", ");
      const topic = (chainPosts[chainPosts.length - 1]?.text ?? "").slice(0, 40);
      try {
        await app.commands.execute("turn.signal", {
          source: "acp",
          root: cwd,
          command: `${names} \uAC00 Clubhouse \uC5D0\uC11C \uC774\uC57C\uAE30 \uC911 \u2014 "${topic}"`
        });
        return true;
      } catch {
        return false;
      }
    }
    async function runRelay(speaker, club, ctx2) {
      const wake = async (id, postsSoFar) => {
        const by = postsSoFar.length ? postsSoFar[postsSoFar.length - 1].who : speaker;
        const prompt = buildSummonPrompt({
          summoned: id,
          by,
          roster: ctx2.rosterIds,
          nameOf,
          studioConversation: ctx2.conversation,
          posts: postsSoFar
        });
        let resp = "";
        try {
          resp = await ctx2.askAgent(id, prompt);
        } catch {
          return [];
        }
        const d = demux(resp);
        if (d.club.length) return d.club;
        const w = d.work.trim();
        return w ? [{ kind: "\uC7A1\uB2F4", text: w }] : [];
      };
      return relaySummons({
        speaker,
        club,
        roster: ctx2.rosterIds,
        depthCap: settingDepthCap(),
        nameOf,
        wake,
        onPost: ctx2.onPost
      });
    }
    let activeStudio = null;
    ctx.subscriptions.push(
      app.commands.register("send", {
        description: "\uD65C\uC131 Studio \uBDF0\uC5D0 \uC0AC\uB78C \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B8\uB2E4(textarea \uC804\uC1A1\uACFC \uB3D9\uC77C \u2014 \uD134 \uB8E8\uD504 \uC2DC\uC791/\uCC38\uACAC). \uB178\uCD9C command \uC790\uB3D9\uD654\xB7E2E \uC6A9",
        params: { text: { type: "string", required: true, description: "\uBCF4\uB0BC \uBA54\uC2DC\uC9C0" } },
        handler: async (p) => {
          const text = String(p?.text ?? "").trim();
          if (!text) return { ok: false, error: "text \uD544\uC218" };
          if (!activeStudio) return { ok: false, error: "\uD65C\uC131 Studio \uBDF0 \uC5C6\uC74C(\uBDF0\uB97C \uBA3C\uC800 \uC5EC\uC138\uC694)" };
          onHuman(activeStudio, text);
          return { ok: true, sent: text, running: activeStudio.running };
        }
      })
    );
    ctx.subscriptions.push(
      app.commands.register("ask", {
        description: "\uD504\uB86C\uD504\uD2B8 1\uD68C \u2014 \uB2E8\uC77C \uC5D0\uC774\uC804\uD2B8 connect+session+prompt \uD6C4 \uD14D\uC2A4\uD2B8\xB7\uD234\uCF5C \uBC18\uD658(\uD5E4\uB4DC\uB9AC\uC2A4)",
        params: {
          agent: { type: "string", description: "preset(claude|codex|gemini, \uAE30\uBCF8 claude)" },
          text: { type: "string", required: true, description: "\uD504\uB86C\uD504\uD2B8" }
        },
        handler: async (p) => {
          const agent = p.agent || "claude";
          let conn;
          try {
            conn = await engine.connect({ agent }, void 0, settingPolicy());
          } catch (e) {
            return { ok: false, error: String(e) };
          }
          try {
            const r = await engine.ask(conn.connId, conn.sessionId, p.text);
            const toolCalls = r.updates.filter((u) => u.sessionUpdate === "tool_call").map((u) => ({ id: u.toolCallId, title: u.title, status: u.status }));
            return { ok: true, stopReason: r.stopReason, text: r.text, toolCalls };
          } catch (e) {
            return { ok: false, error: String(e) };
          } finally {
            await engine.disconnect(conn.connId);
          }
        }
      })
    );
    ctx.subscriptions.push(
      app.commands.register("converse", {
        description: "\uB2E4\uC911 \uC5D0\uC774\uC804\uD2B8 1\uAD50\uD658 \u2014 agents(\uD0ED \uC21C\uC11C)\uAC00 mode(turn/free)\uB85C \uD134\uD14C\uC774\uD0B9, cwd \uC5D0 \uC2E4\uD30C\uC77C. \uBC1C\uD654\xB7\uC4F4 \uD30C\uC77C \uBC18\uD658(\uD5E4\uB4DC\uB9AC\uC2A4 E2E)",
        params: {
          message: { type: "string", required: true, description: "\uC0AC\uB78C \uBA54\uC2DC\uC9C0(\uACFC\uC81C/\uD504\uB86C\uD504\uD2B8)" },
          agents: {
            type: "array",
            description: "\uCC38\uC5EC \uC21C\uC11C \u2014 preset id \uBB38\uC790\uC5F4(claude,codex,gemini) \uB610\uB294 {id,cmd,args}(\uD5E4\uB4DC\uB9AC\uC2A4 E2E \uB7F0\uCE58). \uAE30\uBCF8 3 preset"
          },
          mode: { type: "string", description: "turn(\uD134\uC81C) | free(\uC790\uC720). \uAE30\uBCF8 \uC124\uC815\uAC12" },
          cwd: { type: "string", description: "\uC791\uC5C5 \uB514\uB809\uD130\uB9AC(\uC2E4\uD30C\uC77C \uAC80\uC99D \uB300\uC0C1)" },
          maxRounds: { type: "number", description: "free \uBAA8\uB4DC \uB77C\uC6B4\uB4DC \uC0C1\uD55C(\uAE30\uBCF8 2)" }
        },
        handler: async (p) => {
          const raw = Array.isArray(p.agents) && p.agents.length ? p.agents : AGENTS.map((a) => a.id);
          const specs = raw.map(
            (a) => typeof a === "string" ? { id: a, agent: a, cmd: void 0, args: void 0 } : { id: String(a.id), agent: void 0, cmd: a.cmd, args: a.args }
          );
          const roster = specs.map((s) => ({ id: s.id, checked: true }));
          const mode = p.mode === "free" ? "free" : p.mode === "turn" ? "turn" : settingMode();
          const cwd = typeof p.cwd === "string" ? p.cwd : projectCwd();
          const conns = /* @__PURE__ */ new Map();
          const skipped = [];
          try {
            for (const s of specs) {
              try {
                const c = await engine.connect(
                  s.cmd ? { cmd: s.cmd, args: s.args } : { agent: s.agent },
                  cwd,
                  settingPolicy()
                );
                conns.set(s.id, c.connId);
              } catch (e) {
                skipped.push({ id: s.id, error: String(e) });
              }
            }
            const before = await engine.snapshot(cwd);
            const rosterIds = roster.map((r) => r.id);
            const conversation = [{ who: "human", text: p.message }];
            const utterances = [];
            const club = [];
            let signaled = false;
            const askAgent = async (id, prompt) => {
              const connId = conns.get(id);
              if (connId == null) throw new Error(`\uC5F0\uACB0 \uC5C6\uC74C: ${id}`);
              const sid = await engine.newSession(connId, cwd);
              return (await engine.ask(connId, sid, prompt)).text;
            };
            await driveExchange({
              roster,
              mode,
              conversation,
              maxRounds: typeof p.maxRounds === "number" ? p.maxRounds : FREE_ROUNDS,
              nameOf,
              preamble: (s) => inviteePreamble(s, rosterIds, nameOf, cwd),
              turn: async (id, prompt) => {
                const raw2 = await askAgent(id, prompt);
                const { work, club: segs } = demux(raw2);
                const posts = await runRelay(id, segs, {
                  rosterIds,
                  conversation,
                  askAgent,
                  onPost: (pp) => club.push(pp)
                });
                if (await signalEmergence(cwd, posts)) signaled = true;
                return work;
              },
              onUtterance: (u) => utterances.push(u)
            });
            const filesWritten = engine.diffWritten(before, await engine.snapshot(cwd));
            await appendFeed(cwd, club);
            return { ok: true, order: rosterIds, mode, utterances, club, filesWritten, skipped, signaled };
          } catch (e) {
            return { ok: false, error: String(e) };
          } finally {
            for (const connId of conns.values()) await engine.disconnect(connId);
          }
        }
      })
    );
    const states = /* @__PURE__ */ new WeakMap();
    ctx.subscriptions.push(
      app.ui.registerView("studio", {
        mount(container) {
          teardown(container);
          container.style.position = "relative";
          const style = document.createElement("style");
          style.textContent = CSS;
          const root = document.createElement("div");
          root.className = "st";
          buildStudio(container, root);
          container.replaceChildren(style, root);
        },
        unmount(container) {
          teardown(container);
        }
      })
    );
    ctx.subscriptions.push(
      app.ui.registerView("clubhouse", {
        async mount(container) {
          const style = document.createElement("style");
          style.textContent = CSS;
          const root = el("div", "club2");
          const head = el("div", "club2-head");
          head.append(elText("span", "\u{1F6CB}\uFE0F", "club2-av"), elText("b", "Clubhouse"));
          const feedEl = el("div", "club2-feed");
          const empty = elText(
            "div",
            "\uC544\uC9C1 \uC7A1\uB2F4\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. Studio \uC5D0\uC11C \uC5D0\uC774\uC804\uD2B8\uB4E4\uC774 \uC77C\uD558\uBA74, \uADF8\uB4E4\uC774 \uB0A8\uAE34 \uD68C\uACE0\xB7\uC7A1\uB2F4\xB7\uD638\uBA85\uC774 \uC5EC\uAE30 \uC313\uC785\uB2C8\uB2E4.",
            "club2-empty"
          );
          feedEl.appendChild(empty);
          root.append(head, feedEl);
          container.replaceChildren(style, root);
          const renderPost = (p) => {
            empty.remove();
            const row = el("div", "club2-post");
            const h = el("div", "club2-h");
            const who = elText("span", nameOf(p.who), "club2-who");
            who.style.color = COLOR[p.who] ?? "var(--fg,#ddd)";
            h.append(
              elText("span", CHANNEL_EMOJI[p.channel] ?? "\u{1F4AC}", "club2-av"),
              who,
              elText("span", p.channel, `club2-ch ${p.channel}`)
            );
            const summoned = detectSummon(
              p.text,
              AGENTS.map((a) => a.id),
              p.who,
              nameOf
            );
            if (summoned) h.append(elText("span", `\u2192 ${nameOf(summoned)}`, "club2-summon"));
            row.append(h, elText("div", p.text, "club2-body"));
            feedEl.appendChild(row);
            feedEl.scrollTop = feedEl.scrollHeight;
          };
          for (const p of await loadFeed(projectCwd())) renderPost(p);
          const off = app.bus?.on("clubhouse.post", (p) => renderPost(p));
          container.__off = off;
        },
        unmount(container) {
          const off = container.__off;
          if (off) {
            try {
              off.dispose();
            } catch {
            }
          }
          container.replaceChildren();
        }
      })
    );
    ctx.subscriptions.push(
      app.commands.register("clubhouse.feed", {
        description: "Clubhouse \uD53C\uB4DC \uC77D\uAE30 \u2014 \uC601\uC18D\uB41C \uD68C\uACE0\xB7\uC7A1\uB2F4\xB7\uD638\uBA85 posts(\uD504\uB85C\uC81D\uD2B8 root \uBCC4)",
        params: { cwd: { type: "string", description: "\uD504\uB85C\uC81D\uD2B8 root(\uC0DD\uB7B5 \uC2DC \uD65C\uC131)" } },
        handler: async (p) => {
          const cwd = typeof p.cwd === "string" ? p.cwd : projectCwd();
          let keys = [];
          try {
            keys = app.storage ? await app.storage.list() : [];
          } catch {
          }
          return { ok: true, posts: await loadFeed(cwd), hasStorage: !!app.storage, keys };
        }
      })
    );
    ctx.subscriptions.push(
      app.commands.register("clubhouse.clear", {
        description: "Clubhouse \uD53C\uB4DC \uBE44\uC6B0\uAE30(\uD504\uB85C\uC81D\uD2B8 root \uBCC4, E2E \uB9AC\uC14B)",
        params: { cwd: { type: "string", description: "\uD504\uB85C\uC81D\uD2B8 root(\uC0DD\uB7B5 \uC2DC \uD65C\uC131)" } },
        handler: async (p) => {
          const cwd = typeof p.cwd === "string" ? p.cwd : projectCwd();
          try {
            await app.storage?.write(feedKey(cwd), []);
          } catch {
          }
          return { ok: true };
        }
      })
    );
    function teardown(container) {
      const st = states.get(container);
      if (st) {
        if (st === activeStudio) activeStudio = null;
        if (st.current) engine.cancel(st.current.connId, st.current.sessionId);
        for (const connId of st.conns.values()) core("disconnect", { connId }).catch(() => {
        });
        st.conns.clear();
      }
      states.delete(container);
      container.replaceChildren();
    }
    function buildStudio(container, root) {
      const bar = el("div", "st-bar");
      const tabsEl = el("div", "st-tabs");
      const status = el("div", "st-status");
      const msgs = el("div", "st-msgs");
      const inrow = el("div", "st-in");
      const ta = document.createElement("textarea");
      ta.placeholder = "\uBA54\uC2DC\uC9C0\u2026 (Enter \uC804\uC1A1, Shift+Enter \uC904\uBC14\uAFC8) \u2014 \uC5B8\uC81C\uB098 \uCC38\uACAC \uAC00\uB2A5";
      ta.rows = 1;
      const send = document.createElement("button");
      send.textContent = "\uC804\uC1A1";
      inrow.append(ta, send);
      const st = {
        roster: AGENTS.map((a) => ({ id: a.id, checked: true })),
        mode: settingMode(),
        conv: [],
        conns: /* @__PURE__ */ new Map(),
        running: false,
        interjected: false,
        current: null,
        cwd: projectCwd(),
        msgs,
        status
      };
      states.set(container, st);
      activeStudio = st;
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
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          doSend();
        }
      });
      setStatus(st, "\uB300\uAE30");
    }
    function kibitzToggle(initial, onChange) {
      const wrap = el("div", "st-kib");
      const mk = (m, label) => {
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
      wrap.append(mk("turn", "\uD134\uC81C"), mk("free", "\uC790\uC720"));
      return wrap;
    }
    function renderTabs(st, tabsEl) {
      tabsEl.replaceChildren();
      st.roster.forEach((entry, idx) => {
        const a = AGENTS.find((x) => x.id === entry.id);
        const chip = el("div", "st-tab" + (entry.checked ? "" : " off"));
        chip.style.color = a?.color ?? "#888";
        chip.draggable = true;
        const chk = el("span", "chk");
        chk.textContent = entry.checked ? "\u2713" : "";
        const nm = elText("span", a?.label ?? entry.id, "nm");
        nm.style.color = "var(--fg,#ddd)";
        chip.append(chk, nm);
        chip.addEventListener("click", () => {
          entry.checked = !entry.checked;
          renderTabs(st, tabsEl);
        });
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
    function setStatus(st, t) {
      st.status.textContent = t;
    }
    function onHuman(st, text) {
      st.conv.push({ who: "human", text });
      renderUser(st, text);
      if (st.running && st.current) {
        st.interjected = true;
        engine.cancel(st.current.connId, st.current.sessionId);
        setStatus(st, `${nameOf(st.current.agentId)} \uD134 \uCDE8\uC18C \u2014 \uCC38\uACAC \uBC18\uC601 \uD6C4 \uC7AC\uC2DC\uC791`);
      } else if (!st.running) {
        void runLoop(st);
      }
    }
    async function ensureConn(st, agentId) {
      const existing = st.conns.get(agentId);
      if (existing != null) return { connId: existing };
      const c = await core("connect", { agent: agentId, cwd: st.cwd, permission: settingPolicy() });
      if (!c.ok) return { error: String(c.error || c.message || "\uC5F0\uACB0 \uC2E4\uD328") };
      st.conns.set(agentId, c.connId);
      return { connId: c.connId };
    }
    async function runLoop(st) {
      st.running = true;
      await driveExchange({
        roster: st.roster,
        mode: st.mode,
        conversation: st.conv,
        // 공유 — 에이전트 발화는 driveExchange 가 push
        maxRounds: FREE_ROUNDS,
        nameOf,
        preamble: (s) => inviteePreamble(s, st.roster.map((x) => x.id), nameOf, st.cwd),
        consumeInterject: () => {
          const v = st.interjected;
          st.interjected = false;
          return v;
        },
        onTurnStart: (speaker) => setStatus(st, `${nameOf(speaker)} \uC751\uB2F5 \uC911\u2026`),
        turn: async (speaker, prompt) => {
          const row = renderTurnRow(st, speaker);
          const failTurn = (reason) => {
            row.fail(reason);
            st.conv.push({ who: "system", text: `${nameOf(speaker)} ${reason}` });
          };
          const conn = await ensureConn(st, speaker);
          if ("error" in conn) {
            failTurn(`\uC5F0\uACB0 \uC2E4\uD328: ${conn.error}`);
            return "";
          }
          const connId = conn.connId;
          let sessionId;
          try {
            sessionId = await engine.newSession(connId, st.cwd);
          } catch (e) {
            failTurn(`\uC138\uC158 \uC2E4\uD328: ${String(e)}`);
            return "";
          }
          const cur = {
            agentId: speaker,
            connId,
            sessionId,
            row,
            bubble: null,
            liveRaw: "",
            demux: createTagDemux()
          };
          st.current = cur;
          st.interjected = false;
          const off = app.bus.on(`acp.update.${connId}`, (evt) => onStream(cur, evt));
          let r;
          try {
            r = await core("prompt", { connId, sessionId, text: prompt });
          } catch (e) {
            r = { ok: false, error: String(e) };
          }
          off.dispose();
          st.current = null;
          if (st.interjected) {
            row.remove();
            return "";
          }
          const { work, club } = demux(r.ok ? r.text ?? "" : "");
          if (work) {
            (cur.bubble ?? (cur.bubble = row.toBubble())).textContent = work;
          } else {
            failTurn(r.ok ? "\uC751\uB2F5 \uC5C6\uC74C(\uBE48 \uBC1C\uD654)" : `\uD504\uB86C\uD504\uD2B8 \uC2E4\uD328: ${String(r.error ?? "")}`);
          }
          if (club.length) {
            const rosterIds = st.roster.map((x) => x.id);
            const liveAsk = async (id, pr) => {
              const conn2 = await ensureConn(st, id);
              if ("error" in conn2) throw new Error(conn2.error);
              const sid = await engine.newSession(conn2.connId, st.cwd);
              return (await engine.ask(conn2.connId, sid, pr)).text;
            };
            const posts = await runRelay(speaker, club, {
              rosterIds,
              conversation: st.conv,
              askAgent: liveAsk,
              onPost: (pp) => app.bus?.emit("clubhouse.post", pp)
            });
            await appendFeed(st.cwd, posts);
            await signalEmergence(st.cwd, posts);
          }
          return work;
        }
      });
      st.running = false;
      st.current = null;
      setStatus(st, "\uB300\uAE30");
    }
    function onStream(cur, evt) {
      const u = evt?.update;
      if (!u || u.sessionUpdate !== "agent_message_chunk") return;
      const t = u.content?.text ?? "";
      if (t !== "" && t === cur.liveRaw) return;
      cur.liveRaw += t;
      const workChunk = cur.demux.push(t);
      if (workChunk) {
        if (!cur.bubble) cur.bubble = cur.row.toBubble();
        cur.bubble.textContent = (cur.bubble.textContent || "") + workChunk;
      }
    }
    function renderUser(st, text) {
      const row = el("div", "st-row user");
      row.append(elText("div", "\uB098", "st-who"), bubble(text));
      st.msgs.appendChild(row);
      scroll(st);
    }
    function renderTurnRow(st, agentId) {
      const row = el("div", "st-row assistant");
      const who = elText("div", nameOf(agentId), "st-who");
      who.style.color = COLOR[agentId] ?? "var(--fg3,#888)";
      const pending = el("div", "st-pending");
      pending.append(el("span", "st-dot"), document.createTextNode("\uC751\uB2F5 \uC911\u2026"));
      row.append(who, pending);
      st.msgs.appendChild(row);
      scroll(st);
      let body = pending;
      const swap = (next) => {
        body.replaceWith(next);
        body = next;
        scroll(st);
      };
      return {
        toBubble() {
          const b = bubble("");
          swap(b);
          return b;
        },
        fail(reason) {
          const f = el("div", "st-fail");
          f.textContent = `\u26A0 ${reason}`;
          f.title = reason;
          swap(f);
        },
        remove() {
          row.remove();
        }
      };
    }
    function scroll(st) {
      st.msgs.scrollTop = st.msgs.scrollHeight;
    }
    function el(tag, cls) {
      const e = document.createElement(tag);
      e.className = cls;
      return e;
    }
    function elText(tag, text, cls = "") {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      e.textContent = text;
      return e;
    }
    function bubble(text) {
      const b = el("div", "st-bubble");
      b.textContent = text;
      return b;
    }
  },
  deactivate() {
  }
};
export {
  main_default as default
};
