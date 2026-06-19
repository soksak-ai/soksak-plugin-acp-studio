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
async function driveSimul(opts) {
  const parts = participants(opts.roster);
  const snapshot = opts.conversation.slice();
  await Promise.all(
    parts.map(async (speaker) => {
      opts.onTurnStart?.(speaker);
      const prompt = buildPrompt({
        roster: opts.roster,
        conversation: snapshot,
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
      if (text) {
        const u = { who: speaker, text };
        opts.conversation.push(u);
        opts.onUtterance?.(u);
      }
    })
  );
}
function inviteePreamble(speaker, roster, nameOf2, cwd, simul) {
  const others = roster.filter((id) => id !== speaker).map(nameOf2);
  const room = others.length ? `\uB3D9\uB8CC ${others.join(", ")} \uC640(\uACFC) \uB2F9\uC2E0(${nameOf2(speaker)})\uC774 \uD568\uAED8 \uC788\uC2B5\uB2C8\uB2E4.` : `\uC9C0\uAE08\uC740 \uB2F9\uC2E0(${nameOf2(speaker)}) \uD63C\uC790\uC785\uB2C8\uB2E4.`;
  const place = cwd ? ` \uC791\uC5C5 \uB514\uB809\uD130\uB9AC\uB294 ${cwd} \uC785\uB2C8\uB2E4.` : "";
  const at = `@${others[0] ?? "\uB3D9\uB8CC"}`;
  const simulNote = simul ? `
[\uB3D9\uC2DC \uBC1C\uD654] \uC9C0\uAE08\uC740 \uBAA8\uB450\uAC00 \uAC19\uC740 \uC21C\uAC04\uC5D0 \uB2F5\uD569\uB2C8\uB2E4 \u2014 \uC774\uBC88 \uCC28\uB840\uC5D4 \uC11C\uB85C\uC758 \uB2F5\uC744 \uC544\uC9C1 \uBABB \uBD05\uB2C8\uB2E4. \uB418\uB3C4\uB85D \uC0C1\uB300\uC758 \uB9D0\uC744 \uB05D\uAE4C\uC9C0 \uB4E3\uACE0, \uB204\uAD70\uAC00 '@\uC774\uB984'\uC73C\uB85C \uC9C0\uBAA9\uD558\uBA74 \uADF8 \uB3D9\uB8CC\uC758 \uB2F5\uC744 \uAE30\uB2E4\uB824 \uC8FC\uC138\uC694. \uAC15\uC81C\uB294 \uC544\uB2D9\uB2C8\uB2E4 \u2014 \uC790\uC5F0\uC2A4\uB7EC\uC6B0\uBA74 \uADF8\uB300\uB85C \uB2F5\uD558\uC138\uC694.` : "";
  return `\uC5EC\uAE30\uB294 'Studio' \u2014 \uC5EC\uB7EC AI \uCF54\uB529 \uC5D0\uC774\uC804\uD2B8\uAC00 \uD55C \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4\uC5D0\uC11C \uC0AC\uC6A9\uC790\uC758 \uC77C\uC744 \uD568\uAED8 \uD558\uB294 \uD611\uC5C5 \uCC44\uD305\uBC29\uC785\uB2C8\uB2E4. ${room}${place}
\uB2F9\uC2E0\uC740 ${nameOf2(speaker)} \uBCF8\uC778\uC73C\uB85C\uC11C, \uC5EC\uB7EC \uC0AC\uB78C\uC774 \uD55C\uC790\uB9AC\uC5D0 \uBAA8\uC5EC \uC774\uC57C\uAE30\uD558\uB4EF \uCC38\uC5EC\uD558\uC138\uC694. \uC0AC\uB78C\uB4E4\uC758 \uB300\uD654\uB294 \uC774\uB807\uAC8C \uD750\uB985\uB2C8\uB2E4:
- \uC21C\uC11C\uB294 \uAE30\uACC4\uC801\uC774\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uCC28\uB840\uB97C \uCC44\uC6B0\uB824 \uB9D0\uD558\uC9C0 \uB9D0\uACE0, \uBCF4\uD0E4 \uAC8C \uC788\uC744 \uB54C \uB9D0\uD558\uC138\uC694. \uD560 \uB9D0\uC774 \uC5C6\uC73C\uBA74 \uB4E3\uACE0 \uB118\uACA8\uB3C4 \uB429\uB2C8\uB2E4(\uCE68\uBB35\uB3C4 \uCC38\uC5EC\uC785\uB2C8\uB2E4).
- \uBC29\uAE08 \uB098\uC628 \uB9D0\uC5D0 \uACE7\uBC14\uB85C \uBC18\uC751\uD558\uC138\uC694 \u2014 \uB3D9\uC758\xB7\uBCF4\uCDA9\xB7\uBC18\uB860\xB7\uC9C8\uBB38. \uAE38\uAC8C \uB3C5\uBC31\uD558\uC9C0 \uB9D0\uACE0 \uC9E7\uAC8C \uC8FC\uACE0\uBC1B\uC73C\uC138\uC694.
- \uC774\uBBF8 \uB098\uC628 \uB9D0\uC740 \uBC18\uBCF5\uD558\uC9C0 \uB9C8\uC138\uC694. \uAC19\uC740 \uACB0\uB860\uC774\uBA74 \uC9E7\uAC8C \uB3D9\uC758\uB9CC \uD558\uACE0, \uB2E4\uB974\uBA74 \uADF8 \uAD00\uC810\uC744 \uBCF4\uD0DC\uC138\uC694.
- \uAC00\uB054\uC740 \uB450 \uC0AC\uB78C\uC774 \uD55C \uC8FC\uC81C\uB97C \uAE4A\uC774 \uC8FC\uACE0\uBC1B\uC2B5\uB2C8\uB2E4 \u2014 \uC5B5\uC9C0\uB85C \uB07C\uC5B4\uB4E4\uC9C0 \uB9D0\uACE0 \uC9C0\uCF1C\uBCF4\uB2E4, \uC815\uB9D0 \uBCF4\uD0E4 \uAC8C \uC0DD\uAE30\uBA74 \uB4E4\uC5B4\uC624\uC138\uC694. \uB204\uAD6C\uB3C4 \uC5B5\uC9C0\uB85C \uB04C\uC5B4\uB4E4\uC774\uC9C0\uB294 \uB9C8\uC138\uC694. \uB2E4\uB9CC \uC544\uBB34\uB3C4 \uC78A\uC9C0\uB3C4 \uB9C8\uC138\uC694 \u2014 \uC5B4\uB5A4 \uC8FC\uC81C\uAC00 \uD2B9\uC815 \uB3D9\uB8CC\uC758 \uBAAB\uC774\uBA74 \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uBD80\uB974\uBA74 \uB429\uB2C8\uB2E4.
- \uD2B9\uC815 \uB3D9\uB8CC\uC758 \uB2F5\uC774 \uD544\uC694\uD558\uBA74 \uBCF8\uBB38\uC5D0 '${at}'\uCC98\uB7FC '@\uC774\uB984'\uC73C\uB85C \uC9C0\uBAA9\uD558\uC138\uC694 \u2014 \uC9C0\uBAA9\uB41C \uB3D9\uB8CC\uAC00 \uC774\uC5B4\uC11C \uB2F5\uD569\uB2C8\uB2E4.
- \uC791\uC5C5\uC774 \uD544\uC694\uD558\uBA74 \uC124\uBA85\uB9CC \uD558\uC9C0 \uB9D0\uACE0 \uB2F9\uC2E0\uC758 \uB3C4\uAD6C\uB85C \uC2E4\uC81C \uD30C\uC77C/\uBA85\uB839\uC73C\uB85C \uCC98\uB9AC\uD558\uC138\uC694(\uC704 \uC791\uC5C5 \uB514\uB809\uD130\uB9AC \uAE30\uC900).
- \uB2F9\uC2E0\uC758 \uB0B4\uBD80 \uC808\uCC28(\uC5B4\uB5A4 \uC2A4\uD0AC\uC744 \uC4F0\uB294\uC9C0, \uC138\uC158 \uC124\uC815\xB7\uADDC\uCE59 \uD655\uC778 \uB4F1)\uB294 \uB300\uD654\uC5D0 \uC801\uC9C0 \uB9C8\uC138\uC694 \u2014 \uC778\uC0AC\xB7\uC758\uACAC\xB7\uACB0\uACFC\uB9CC \uC790\uC5F0\uC2A4\uB7FD\uAC8C.` + simulNote;
}
function detectMentions(text, roster, speaker, nameOf2) {
  const hay = text.toLowerCase();
  const out = [];
  for (const id of roster) {
    if (id === speaker) continue;
    let best = -1;
    for (const cand of [nameOf2(id), id]) {
      const i = hay.indexOf(("@" + cand).toLowerCase());
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    if (best >= 0) out.push({ id, idx: best });
  }
  out.sort((a, b) => a.idx - b.idx);
  return out.map((x) => x.id);
}

// src/main.ts
var AGENTS = [
  { id: "claude", label: "Claude", color: "#d97757" },
  { id: "codex", label: "Codex", color: "#10a37f" },
  // gemini: gemini-cli 가 2026-06-18 부터 Pro/Ultra·무료 티어 서비스 종료, antigravity-cli(agy)는 ACP 미구현
  //   (Issue #31) → Google 계열 ACP 경로 없음. 임시 hidden(부활: hidden 해제 + acp-core 에 agy --acp preset).
  { id: "gemini", label: "Gemini", color: "#4285f4", hidden: true }
];
var ACTIVE_AGENTS = AGENTS.filter((a) => !a.hidden);
var NAME = { claude: "Claude", codex: "Codex", gemini: "Gemini" };
var COLOR = Object.fromEntries(AGENTS.map((a) => [a.id, a.color]));
var nameOf = (id) => NAME[id] ?? id;
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
.st-in{display:flex;gap:8px;padding:8px 10px;border-top:1px solid rgba(127,127,127,.2);flex:0 0 auto}
.st-in textarea{flex:1;resize:none;background:rgba(127,127,127,.1);color:inherit;border:1px solid rgba(127,127,127,.25);border-radius:7px;padding:7px 9px;font:inherit;min-height:20px;max-height:120px}
.st-in button{background:#2d6cdf;color:#fff;border:0;border-radius:7px;padding:0 14px;cursor:pointer;font:inherit;font-weight:600}
.st-cut{font-weight:400;opacity:.7;font-size:9px;font-style:italic} /* \uCC38\uACAC\uC73C\uB85C \uC911\uB2E8\uB41C \uBD80\uBD84\uC751\uB2F5 \uD45C\uC2DD */
`;
var main_default = {
  activate(ctx) {
    const app = ctx.app;
    const core = (name, params) => app.commands.execute("plugin.soksak-plugin-acp-core." + name, params ?? {});
    const engine = createEngine(app);
    const settingPolicy = () => app.settings?.get("permissionPolicy") || void 0;
    const settingMode = () => {
      const v = app.settings?.get("kibitzDefault");
      return v === "free" || v === "simul" ? v : "turn";
    };
    const settingDepthCap = () => Math.max(1, Number(app.settings?.get("nameTriggerDepthCap")) || 4);
    const projectCwd = () => app.project?.current?.()?.root;
    let activeStudio = null;
    ctx.subscriptions.push(
      app.commands.register("send", {
        description: "\uD65C\uC131 Studio \uBDF0\uC5D0 \uC0AC\uB78C \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B8\uB2E4(textarea \uC804\uC1A1\uACFC \uB3D9\uC77C \u2014 \uB300\uD654 \uAD6C\uB3D9/\uCC38\uACAC). \uB178\uCD9C command \uC790\uB3D9\uD654\xB7E2E \uC6A9",
        params: {
          text: { type: "string", required: true, description: "\uBCF4\uB0BC \uBA54\uC2DC\uC9C0" },
          mode: { type: "string", description: "turn|free|simul \u2014 \uC804\uC1A1 \uC804 \uBAA8\uB4DC \uC124\uC815(E2E\xB7\uC790\uB3D9\uD654). \uC0DD\uB7B5 \uC2DC \uC720\uC9C0" }
        },
        handler: async (p) => {
          const text = String(p?.text ?? "").trim();
          if (!text) return { ok: false, error: "text \uD544\uC218" };
          if (!activeStudio) return { ok: false, error: "\uD65C\uC131 Studio \uBDF0 \uC5C6\uC74C(\uBDF0\uB97C \uBA3C\uC800 \uC5EC\uC138\uC694)" };
          if (p?.mode === "turn" || p?.mode === "free" || p?.mode === "simul") {
            activeStudio.mode = p.mode;
          }
          onHuman(activeStudio, text);
          return { ok: true, sent: text, mode: activeStudio.mode, running: activeStudio.running };
        }
      })
    );
    ctx.subscriptions.push(
      app.commands.register("state", {
        description: "\uD65C\uC131 Studio \uC758 \uB77C\uC774\uBE0C \uC0C1\uD0DC(\uBAA8\uB4DC\xB7\uC9C4\uD589 \uC5EC\uBD80\xB7\uB300\uD654 \uC218\xB7\uB85C\uC2A4\uD130 \uCCB4\uD06C\xB7\uC9C4\uD589 \uC911 \uBC1C\uD654\uC758 message \uC2A4\uD2B8\uB9AC\uBC0D \uAE38\uC774)",
        params: {},
        handler: async () => {
          const st = activeStudio;
          if (!st) return { ok: false, error: "\uD65C\uC131 Studio \uBDF0 \uC5C6\uC74C" };
          return {
            ok: true,
            mode: st.mode,
            running: st.running,
            conv: st.conv.length,
            pending: st.pendingHuman.length,
            roster: st.roster.map((r) => ({ id: r.id, checked: r.checked })),
            // streamed = 지금까지 받은 message 청크 누적 길이(thought 제외) — >0 이면 '출력 시작'.
            actives: [...st.actives].map((c) => ({ id: c.agentId, streamed: c.liveRaw.length }))
          };
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
          const raw = Array.isArray(p.agents) && p.agents.length ? p.agents : ACTIVE_AGENTS.map((a) => a.id);
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
              turn: async (id, prompt) => (await askAgent(id, prompt)).trim(),
              // 미연결이면 throw → 이 발화 skip
              onUtterance: (u) => utterances.push(u)
            });
            const filesWritten = engine.diffWritten(before, await engine.snapshot(cwd));
            return { ok: true, order: rosterIds, mode, utterances, filesWritten, skipped };
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
    function teardown(container) {
      const st = states.get(container);
      if (st) {
        if (st === activeStudio) activeStudio = null;
        for (const c of st.actives) engine.cancel(c.connId, c.sessionId);
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
        roster: ACTIVE_AGENTS.map((a) => ({ id: a.id, checked: true })),
        mode: settingMode(),
        conv: [],
        conns: /* @__PURE__ */ new Map(),
        running: false,
        pendingHuman: [],
        actives: /* @__PURE__ */ new Set(),
        cwd: projectCwd(),
        msgs,
        tabsEl,
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
      wrap.append(mk("turn", "\uD134\uC81C"), mk("free", "\uC790\uC720"), mk("simul", "\uB3D9\uC2DC"));
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
      if (!st.running) {
        st.conv.push({ who: "human", text });
        renderUser(st, text);
        void runLoop(st);
        return;
      }
      st.pendingHuman.push(text);
      for (const c of st.actives) engine.cancel(c.connId, c.sessionId);
      setStatus(st, "\uCC38\uACAC \u2014 \uD604\uC7AC \uBC1C\uD654 \uC885\uACB0 \uD6C4 \uBC18\uC601");
    }
    function injectPending(st) {
      for (const t of st.pendingHuman) {
        st.conv.push({ who: "human", text: t });
        renderUser(st, t);
      }
      st.pendingHuman = [];
    }
    function dropAgent(st, agentId) {
      const entry = st.roster.find((r) => r.id === agentId);
      if (entry?.checked) {
        entry.checked = false;
        renderTabs(st, st.tabsEl);
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
    async function runOneTurn(st, speaker, prompt) {
      const row = renderTurnRow(st, speaker);
      const fail = (reason) => {
        row.fail(reason);
        row.setEnd();
        st.conv.push({ who: "system", text: `${nameOf(speaker)} ${reason}` });
        dropAgent(st, speaker);
      };
      const conn = await ensureConn(st, speaker);
      if ("error" in conn) {
        fail(`\uC5F0\uACB0 \uC2E4\uD328: ${conn.error}`);
        return "";
      }
      const connId = conn.connId;
      let sessionId;
      try {
        sessionId = await engine.newSession(connId, st.cwd);
      } catch (e) {
        fail(`\uC138\uC158 \uC2E4\uD328: ${String(e)}`);
        return "";
      }
      const cur = { agentId: speaker, connId, sessionId, row, bubble: null, liveRaw: "" };
      st.actives.add(cur);
      const off = app.bus.on(`acp.update.${connId}`, (evt) => onStream(cur, evt));
      let r;
      try {
        r = await core("prompt", { connId, sessionId, text: prompt });
      } catch (e) {
        r = { ok: false, error: String(e) };
      }
      off.dispose();
      st.actives.delete(cur);
      const streamed = cur.liveRaw.trim();
      const work = r.ok && (r.text ?? "").trim() || streamed;
      if (work) {
        (cur.bubble ?? (cur.bubble = row.toBubble())).textContent = work;
        row.setEnd();
        if (typeof r.reasoning === "string" && r.reasoning) row.setReasoning(r.reasoning);
        return work;
      }
      if (!r.ok) {
        fail(`\uD504\uB86C\uD504\uD2B8 \uC2E4\uD328: ${String(r.error ?? "")}`);
        return "";
      }
      row.remove();
      return "";
    }
    async function resolveMentions(st, scanFrom, simul) {
      const ids = st.roster.map((x) => x.id);
      let from = scanFrom;
      for (let depth = 0; depth < settingDepthCap(); depth++) {
        const targets = [];
        for (const u of st.conv.slice(from)) {
          if (u.who === "human" || u.who === "system") continue;
          for (const id of detectMentions(u.text, ids, u.who, nameOf)) {
            if (!targets.includes(id)) targets.push(id);
          }
        }
        from = st.conv.length;
        if (!targets.length) return;
        for (const id of targets) {
          if (st.pendingHuman.length) return;
          setStatus(st, `${nameOf(id)} \uC9C0\uBAA9 \uC751\uB2F5 \uC911\u2026`);
          const prompt = buildPrompt({
            roster: st.roster,
            conversation: st.conv,
            speaker: id,
            nameOf,
            preamble: `${inviteePreamble(id, ids, nameOf, st.cwd, simul)}
(\uB2F9\uC2E0\uC774 @${nameOf(id)} \uC73C\uB85C \uC9C0\uBAA9\uB418\uC5C8\uC2B5\uB2C8\uB2E4 \u2014 \uC704 \uB300\uD654\uC5D0 \uC774\uC5B4 \uB2F5\uD558\uC138\uC694.)`
          });
          const work = await runOneTurn(st, id, prompt);
          if (work) st.conv.push({ who: id, text: work });
        }
      }
    }
    async function driveSequential(st, ids) {
      const parts = participants(st.roster);
      if (!parts.length) return;
      const cap = st.mode === "free" ? Math.max(1, FREE_ROUNDS) * parts.length : parts.length;
      for (let i = 0; i < cap; i++) {
        if (st.pendingHuman.length) return;
        const speaker = parts[i % parts.length];
        if (!st.roster.find((r) => r.id === speaker)?.checked) continue;
        setStatus(st, `${nameOf(speaker)} \uC751\uB2F5 \uC911\u2026`);
        const prompt = buildPrompt({
          roster: st.roster,
          conversation: st.conv,
          speaker,
          nameOf,
          preamble: inviteePreamble(speaker, ids, nameOf, st.cwd, false)
        });
        const work = await runOneTurn(st, speaker, prompt);
        if (work) st.conv.push({ who: speaker, text: work });
        if (st.pendingHuman.length) return;
      }
    }
    async function runLoop(st) {
      st.running = true;
      const ids = st.roster.map((x) => x.id);
      for (; ; ) {
        const scanFrom = st.conv.length;
        const simul = st.mode === "simul";
        if (simul) {
          await driveSimul({
            roster: st.roster,
            conversation: st.conv,
            nameOf,
            preamble: (s) => inviteePreamble(s, ids, nameOf, st.cwd, true),
            onTurnStart: () => setStatus(st, "\uB3D9\uC2DC \uC751\uB2F5 \uC911\u2026"),
            turn: (speaker, prompt) => runOneTurn(st, speaker, prompt)
          });
        } else {
          await driveSequential(st, ids);
        }
        if (st.pendingHuman.length) {
          injectPending(st);
          continue;
        }
        await resolveMentions(st, scanFrom, simul);
        if (st.pendingHuman.length) {
          injectPending(st);
          continue;
        }
        break;
      }
      st.running = false;
      st.actives.clear();
      setStatus(st, "\uB300\uAE30");
    }
    function onStream(cur, evt) {
      const u = evt?.update;
      if (!u || u.sessionUpdate !== "agent_message_chunk") return;
      const t = u.content?.text ?? "";
      if (t !== "" && t === cur.liveRaw) return;
      cur.liveRaw += t;
      if (t) {
        if (!cur.bubble) cur.bubble = cur.row.toBubble();
        cur.bubble.textContent = (cur.bubble.textContent || "") + t;
      }
    }
    function renderUser(st, text) {
      const row = el("div", "st-row user");
      const who = el("div", "st-who");
      who.append(elText("span", "\uB098", "st-who-name"), elText("span", ` \xB7 ${hhmmss()}`, "st-who-time"));
      row.append(who, bubble(text));
      st.msgs.appendChild(row);
      scroll(st);
    }
    function renderTurnRow(st, agentId) {
      const row = el("div", "st-row assistant");
      const who = el("div", "st-who");
      const nameEl = elText("span", nameOf(agentId), "st-who-name");
      nameEl.style.color = COLOR[agentId] ?? "var(--fg3,#888)";
      const timeEl = el("span", "st-who-time");
      const startStamp = hhmmss();
      timeEl.textContent = ` \xB7 ${startStamp}`;
      who.append(nameEl, timeEl);
      const pending = el("div", "st-pending");
      pending.append(el("span", "st-dot"), document.createTextNode("\uC751\uB2F5 \uC911\u2026"));
      row.append(who, pending);
      st.msgs.appendChild(row);
      scroll(st);
      let body = pending;
      let endTimeEl = null;
      const swap = (next) => {
        body.replaceWith(next);
        body = next;
        scroll(st);
      };
      return {
        toBubble() {
          const box = el("div", "st-bubble");
          const text = el("span", "st-bubble-text");
          const time = el("span", "st-box-time");
          box.append(text, time);
          endTimeEl = time;
          swap(box);
          return text;
        },
        fail(reason) {
          const box = el("div", "st-fail");
          box.title = reason;
          const time = el("span", "st-box-time");
          box.append(elText("span", `\u26A0 ${reason}`, "st-fail-text"), time);
          endTimeEl = time;
          swap(box);
        },
        // 발화 종료 — 종료 시각을 버블/실패 박스 안 우하단에(시작 시각은 이름 옆에 이미 찍힘).
        setEnd() {
          if (endTimeEl) endTimeEl.textContent = hhmmss();
        },
        // 리소닝/띵킹(agent_thought_chunk) — 💭 배지(클릭하면 펼침). 작업 텍스트와 분리, 기본 접힘.
        setReasoning(text) {
          if (!text.trim()) return;
          const badge = elText("span", "\u{1F4AD} \uC0DD\uAC01", "st-think");
          badge.title = "\uD074\uB9AD\uD558\uBA74 \uB9AC\uC18C\uB2DD \uD3BC\uCE58\uAE30/\uC811\uAE30";
          const panel = elText("div", text, "st-think-body");
          panel.style.display = "none";
          badge.addEventListener("click", () => {
            const open = panel.style.display === "none";
            panel.style.display = open ? "block" : "none";
            badge.classList.toggle("open", open);
            if (open) scroll(st);
          });
          who.appendChild(badge);
          row.appendChild(panel);
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
    function hhmmss() {
      const d = /* @__PURE__ */ new Date();
      const p = (n) => String(n).padStart(2, "0");
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
