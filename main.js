// src/engine.ts
var CORE = "plugin.soksak-plugin-agents-acp.";
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

// src/i18n.ts
var strings = {
  placeholder: {
    en: "Message\u2026 (Enter to send, Shift+Enter for newline, @ to mention a model) \u2014 interject anytime",
    ko: "\uBA54\uC2DC\uC9C0\u2026 (Enter \uC804\uC1A1, Shift+Enter \uC904\uBC14\uAFC8, @\uB85C \uBAA8\uB378 \uC9C0\uBAA9) \u2014 \uC5B8\uC81C\uB098 \uCC38\uACAC \uAC00\uB2A5"
  },
  sendBtn: {
    en: "Send",
    ko: "\uC804\uC1A1"
  },
  statusIdle: {
    en: "Idle",
    ko: "\uB300\uAE30"
  },
  modeFacil: {
    en: "Facil",
    ko: "\uC9C4\uD589"
  },
  modeTurn: {
    en: "Turn",
    ko: "\uC21C\uCC28"
  },
  modeSimul: {
    en: "Simul",
    ko: "\uB3D9\uC2DC"
  },
  crownTitle: {
    en: "Set as facilitator",
    ko: "\uC9C4\uD589\uC790\uB85C \uC9C0\uC815"
  },
  statusInterject: {
    en: "Interjected \u2014 reflected after current utterance ends",
    ko: "\uCC38\uACAC \u2014 \uD604\uC7AC \uBC1C\uD654 \uC885\uACB0 \uD6C4 \uBC18\uC601"
  },
  statusQueued: {
    en: "Queued \u2014 reflected after current conversation ends",
    ko: "\uB300\uAE30 \uC911 \u2014 \uD604\uC7AC \uB300\uD654\uAC00 \uB05D\uB098\uBA74 \uBC18\uC601"
  },
  modalTitle: {
    en: "{who} is speaking",
    ko: "{who} \uB9D0\uD558\uB294 \uC911"
  },
  modalMsg: {
    en: "Cut in now, or add after they finish?",
    ko: "\uC9C0\uAE08 \uB07C\uC5B4\uB4E4\uAE4C\uC694, \uB05D\uB098\uBA74 \uB123\uC744\uAE4C\uC694?"
  },
  btnCut: {
    en: "Cut now",
    ko: "\uC9C0\uAE08 \uB04A\uAE30"
  },
  btnWait: {
    en: "Add after",
    ko: "\uB05D\uB098\uBA74 \uB123\uAE30"
  },
  btnCancel: {
    en: "Cancel",
    ko: "\uCDE8\uC18C"
  },
  pending: {
    en: "Responding\u2026",
    ko: "\uC751\uB2F5 \uC911\u2026"
  },
  thinkBadge: {
    en: "\u{1F4AD} Think",
    ko: "\u{1F4AD} \uC0DD\uAC01"
  },
  thinkBadgeTitle: {
    en: "Click to expand/collapse reasoning",
    ko: "\uD074\uB9AD\uD558\uBA74 \uB9AC\uC18C\uB2DD \uD3BC\uCE58\uAE30/\uC811\uAE30"
  },
  whoMe: {
    en: "Me",
    ko: "\uB098"
  },
  queuedTag: {
    en: " \xB7 queued",
    ko: " \xB7 \uB300\uAE30 \uC911"
  },
  statusSimul: {
    en: "Responding simultaneously\u2026",
    ko: "\uB3D9\uC2DC \uC751\uB2F5 \uC911\u2026"
  },
  statusFacilDone: {
    en: "Facilitation cap reached \u2014 wrapping up",
    ko: "\uC9C4\uD589 \uD55C\uB3C4 \uB3C4\uB2EC \u2014 \uB9C8\uBB34\uB9AC"
  },
  whoConversation: {
    en: "Conversation",
    ko: "\uB300\uD654"
  }
};
function t(key, lang) {
  const e = strings[key];
  return e[lang] ?? e.en;
}
function tp(key, lang, vars) {
  let s = t(key, lang);
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

// src/conversation.ts
function participants(roster) {
  return roster.filter((r) => r.checked).map((r) => r.id);
}
function nextSpeaker(parts, agentTurnCount) {
  return agentTurnCount < parts.length ? parts[agentTurnCount] : null;
}
function pickFacilitator(roster) {
  const p = participants(roster);
  return p.length ? p[0] : null;
}
function parseFacilitatorDirective(text, roster, facilitatorId, nameOf2) {
  const targets = detectMentions(text, roster, facilitatorId, nameOf2);
  const simul = /\[동시\]|다\s*같이|동시에|모두\s*(답|의견|말)/.test(text);
  const seq = /\[순차\]|차례(로|대로)|순서대로|돌아가/.test(text);
  let pattern;
  if (simul) pattern = "simul";
  else if (seq) pattern = "turn";
  else if (targets.length) pattern = "select";
  else pattern = "none";
  return { pattern, targets };
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
  const base = opts.preamble ?? `\uB2F9\uC2E0\uC740 ${name(opts.speaker)}\uC785\uB2C8\uB2E4. ${room} \uC704 \uB300\uD654\uC5D0 \uC774\uC5B4 \uB2F9\uC2E0\uC758 \uCC28\uB840\uB85C \uC751\uB2F5\uD558\uC138\uC694. \uAE30\uBCF8\uC740 \uC774 \uB300\uD654\uCC3D\uC5D0\uC11C \uB9D0\uB85C\uB9CC \uCC38\uC5EC\uD558\uB294 \uAC83\uC785\uB2C8\uB2E4. \uC0AC\uC6A9\uC790\uAC00 \uBA85\uC2DC\uC801\uC73C\uB85C \uC791\uC5C5\uC744 \uC2DC\uD0A4\uC9C0 \uC54A\uC558\uB2E4\uBA74 \uD30C\uC77C\uC744 \uB9CC\uB4E4\uAC70\uB098 \uACE0\uCE58\uC9C0 \uB9D0\uACE0, \uBA85\uB839\uB3C4 \uC2E4\uD589\uD558\uC9C0 \uB9C8\uC138\uC694. \uC0AC\uC6A9\uC790\uAC00 \uBD84\uBA85\uD788 \uC791\uC5C5\uC744 \uC9C0\uC2DC\uD55C \uACBD\uC6B0\uC5D0\uB9CC \uB2F9\uC2E0\uC758 \uB3C4\uAD6C\uB85C \uC2E4\uC81C \uD30C\uC77C\uC744 \uB9CC\uB4E4\uAC70\uB098 \uBA85\uB839\uC744 \uC2E4\uD589\uD558\uC138\uC694.`;
  return `${base}${convo}`;
}
async function driveExchange(opts) {
  const parts = participants(opts.roster);
  let agentTurns = 0;
  for (; ; ) {
    const speaker = nextSpeaker(parts, agentTurns);
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
function studioBase(speaker, others, place, nameOf2) {
  const room = others.length ? `\uB3D9\uB8CC ${others.join(", ")} \uC640(\uACFC) \uB2F9\uC2E0(${nameOf2(speaker)})\uC774 \uD568\uAED8 \uC788\uC2B5\uB2C8\uB2E4.` : `\uC9C0\uAE08\uC740 \uB2F9\uC2E0(${nameOf2(speaker)}) \uD63C\uC790\uC785\uB2C8\uB2E4.`;
  const at = `@${others[0] ?? "\uB3D9\uB8CC"}`;
  return `\uC5EC\uAE30\uB294 'Studio' \u2014 \uC5EC\uB7EC AI \uCF54\uB529 \uC5D0\uC774\uC804\uD2B8\uAC00 \uD55C \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4\uC5D0\uC11C \uC0AC\uC6A9\uC790\uC758 \uC77C\uC744 \uD568\uAED8 \uD558\uB294 \uD611\uC5C5 \uCC44\uD305\uBC29\uC785\uB2C8\uB2E4. ${room}${place}
\uB2F9\uC2E0\uC740 ${nameOf2(speaker)} \uBCF8\uC778\uC73C\uB85C\uC11C \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uCC38\uC5EC\uD558\uC138\uC694:
- \uBC29\uAE08 \uB098\uC628 \uB9D0\uC5D0 \uACE7\uBC14\uB85C \uBC18\uC751\uD558\uC138\uC694 \u2014 \uB3D9\uC758\xB7\uBCF4\uCDA9\xB7\uBC18\uB860\xB7\uC9C8\uBB38. \uAE38\uAC8C \uB3C5\uBC31\uD558\uC9C0 \uB9D0\uACE0 \uC9E7\uAC8C \uC8FC\uACE0\uBC1B\uC73C\uC138\uC694.
- \uC774\uBBF8 \uB098\uC628 \uB9D0\uC740 \uBC18\uBCF5\uD558\uC9C0 \uB9C8\uC138\uC694. \uAC19\uC740 \uACB0\uB860\uC774\uBA74 \uC9E7\uAC8C \uB3D9\uC758\uB9CC \uD558\uACE0, \uB2E4\uB974\uBA74 \uADF8 \uAD00\uC810\uC744 \uBCF4\uD0DC\uC138\uC694.
- \uD560 \uB9D0\uC774 \uC5C6\uC73C\uBA74 \uCE68\uBB35\uD574\uB3C4 \uB429\uB2C8\uB2E4(\uCE68\uBB35\uB3C4 \uCC38\uC5EC\uC785\uB2C8\uB2E4).
- \uD2B9\uC815 \uB3D9\uB8CC\uC758 \uB2F5\uC774 \uD544\uC694\uD558\uBA74 \uBCF8\uBB38\uC5D0 '${at}'\uCC98\uB7FC '@\uC774\uB984'\uC73C\uB85C \uC9C0\uBAA9\uD558\uC138\uC694.
- \uAE30\uBCF8\uC740 \uC774 \uB300\uD654\uCC3D\uC5D0\uC11C \uB9D0\uB85C\uB9CC \uCC38\uC5EC\uD558\uB294 \uAC83\uC785\uB2C8\uB2E4. \uC0AC\uC6A9\uC790\uAC00 \uBA85\uC2DC\uC801\uC73C\uB85C \uC791\uC5C5\uC744 \uC2DC\uD0A4\uC9C0 \uC54A\uC558\uB2E4\uBA74 \uD30C\uC77C\uC744 \uB9CC\uB4E4\uAC70\uB098 \uACE0\uCE58\uC9C0 \uB9D0\uACE0, \uBA85\uB839\uB3C4 \uC2E4\uD589\uD558\uC9C0 \uB9C8\uC138\uC694. \uC0AC\uC6A9\uC790\uAC00 \uBD84\uBA85\uD788 \uC791\uC5C5\uC744 \uC9C0\uC2DC\uD55C \uACBD\uC6B0\uC5D0\uB9CC \uB2F9\uC2E0\uC758 \uB3C4\uAD6C\uB85C \uC2E4\uC81C \uD30C\uC77C/\uBA85\uB839\uC744 \uCC98\uB9AC\uD558\uC138\uC694(\uC704 \uC791\uC5C5 \uB514\uB809\uD130\uB9AC \uAE30\uC900).
- \uB2F9\uC2E0\uC758 \uB0B4\uBD80 \uC808\uCC28(\uC5B4\uB5A4 \uC2A4\uD0AC\uC744 \uC4F0\uB294\uC9C0, \uC138\uC158 \uC124\uC815\xB7\uADDC\uCE59 \uD655\uC778 \uB4F1)\uB294 \uB300\uD654\uC5D0 \uC801\uC9C0 \uB9C8\uC138\uC694 \u2014 \uC778\uC0AC\xB7\uC758\uACAC\xB7\uACB0\uACFC\uB9CC \uC790\uC5F0\uC2A4\uB7FD\uAC8C.`;
}
function inviteePreamble(speaker, roster, nameOf2, cwd, mode) {
  const others = roster.filter((id) => id !== speaker).map(nameOf2);
  const place = cwd ? ` \uC791\uC5C5 \uB514\uB809\uD130\uB9AC\uB294 ${cwd} \uC785\uB2C8\uB2E4.` : "";
  const note = mode === "simul" ? `
[\uB3D9\uC2DC] \uC9C0\uAE08\uC740 \uBAA8\uB450\uAC00 \uAC19\uC740 \uC21C\uAC04\uC5D0 \uB2F5\uD569\uB2C8\uB2E4 \u2014 \uC774\uBC88 \uCC28\uB840\uC5D4 \uC11C\uB85C\uC758 \uB2F5\uC744 \uC544\uC9C1 \uBABB \uBD05\uB2C8\uB2E4. \uB418\uB3C4\uB85D \uC0C1\uB300\uC758 \uB9D0\uC744 \uB05D\uAE4C\uC9C0 \uB4E3\uACE0, \uB204\uAD70\uAC00 '@\uC774\uB984'\uC73C\uB85C \uC9C0\uBAA9\uD558\uBA74 \uADF8 \uB3D9\uB8CC\uC758 \uB2F5\uC744 \uAE30\uB2E4\uB824 \uC8FC\uC138\uC694. \uAC15\uC81C\uB294 \uC544\uB2D9\uB2C8\uB2E4 \u2014 \uC790\uC5F0\uC2A4\uB7EC\uC6B0\uBA74 \uADF8\uB300\uB85C \uB2F5\uD558\uC138\uC694.` : mode === "turn" ? `
[\uC21C\uCC28] \uC9C0\uAE08\uC740 \uCC28\uB840\uB300\uB85C \uD55C \uBA85\uC529 \uB9D0\uD569\uB2C8\uB2E4. \uB2F9\uC2E0 \uCC28\uB840\uC5D0 \uC9E7\uAC8C \uD55C\uB9C8\uB514, \uB0A8\uC758 \uCC28\uB840\uC5D4 \uACBD\uCCAD\uD558\uC138\uC694.` : mode === "facil" ? `
[\uC9C4\uD589] \uC774 \uBC29\uC740 \uC9C4\uD589\uC790\uAC00 \uD750\uB984\uC744 \uC870\uC728\uD569\uB2C8\uB2E4. \uC9C4\uD589\uC790\uAC00 \uB2F9\uC2E0\uC744 \uBD80\uB974\uBA74(\uB610\uB294 '@\uC774\uB984'\uC73C\uB85C \uC9C0\uBAA9\uD558\uBA74) \uB2F5\uD558\uACE0, \uC548 \uBD88\uB9AC\uBA74 \uB098\uC11C\uC9C0 \uB9D0\uACE0 \uAE30\uB2E4\uB9AC\uC138\uC694.` : "";
  return studioBase(speaker, others, place, nameOf2) + note;
}
function facilitatorPreamble(facilitator, roster, nameOf2, cwd) {
  const others = roster.filter((id) => id !== facilitator).map(nameOf2);
  const place = cwd ? ` \uC791\uC5C5 \uB514\uB809\uD130\uB9AC\uB294 ${cwd} \uC785\uB2C8\uB2E4.` : "";
  const ex = others[0] ?? "\uB3D9\uB8CC";
  return studioBase(facilitator, others, place, nameOf2) + `
[\uC9C4\uD589\uC790] \uB2F9\uC2E0\uC740 \uC774 \uB300\uD654\uC758 \uC9C4\uD589\uC790\uC785\uB2C8\uB2E4. \uC0AC\uB78C\uC740 \uB2F9\uC2E0\uC5D0\uAC8C \uB9D0\uD569\uB2C8\uB2E4.
- \uC9C1\uC811 \uB2F5\uD558\uAC70\uB098, \uB3D9\uB8CC\uB97C \uB04C\uC5B4\uB4E4\uC5EC \uC870\uC728\uD558\uC138\uC694. \uBD80\uB974\uB294 \uBC95:
   \xB7 \uB2E4 \uAC19\uC774(\uB3D9\uC2DC) \u2014 "\uB2E4 \uAC19\uC774 \uC758\uACAC \uC918\uC694" \uCC98\uB7FC.
   \xB7 \uCC28\uB840\uB85C(\uC21C\uCC28) \u2014 "\uCC28\uB840\uB85C \uC758\uACAC \uC918\uC694" \uCC98\uB7FC.
   \xB7 \uD2B9\uC815 \uB3D9\uB8CC\uB9CC \u2014 "@${ex} \uC774\uAC74 \uC5B4\uB54C?" \uCC98\uB7FC '@\uC774\uB984'\uC73C\uB85C.
- \uB3D9\uB8CC \uB2F5\uC774 \uC624\uBA74 \uC885\uD569\uD558\uACE0, \uB354 \uBCFC \uAC8C \uC5C6\uC73C\uBA74 \uB9C8\uBB34\uB9AC\uD558\uC138\uC694. **\uC544\uBB34\uB3C4 \uBD80\uB974\uC9C0 \uC54A\uACE0 \uB2F5\uD558\uBA74 \uB300\uD654\uAC00 \uC885\uB8CC**\uB429\uB2C8\uB2E4.
- \uC774\uC5B4\uAC08 \uB54C\uB294 \uB204\uAD6C\uB97C \uC5B4\uB5BB\uAC8C \uBD80\uB97C\uC9C0 \uC704 \uBC29\uC2DD\uC73C\uB85C \uBD84\uBA85\uD788 \uC9C0\uC2DC\uD558\uC138\uC694.`;
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
var FACIL_MAX_ROUNDS = 6;
var CSS = `
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
.st-cut{font-weight:400;opacity:.7;font-size:9px;font-style:italic} /* \uCC38\uACAC\uC73C\uB85C \uC911\uB2E8\uB41C \uBD80\uBD84\uC751\uB2F5 \uD45C\uC2DD */
.st-row.queued .st-bubble{opacity:.45;border:1px dashed rgba(255,255,255,.4)} /* \uB300\uAE30 \uC911 \uC0AC\uB78C \uC785\uB825(\uBBF8\uBC18\uC601) */
.st-queued-tag{font-weight:400;opacity:.7;font-size:10px;font-style:italic}
.st-modal{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:50}
.st-modal-box{background:var(--bg2,#262626);border:1px solid rgba(127,127,127,.4);border-radius:12px;padding:16px 18px;max-width:300px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.st-modal-title{font-weight:700;font-size:13px;margin-bottom:4px}
.st-modal-msg{font-size:12px;color:var(--fg3,#aaa);margin-bottom:14px;line-height:1.4}
.st-modal-btns{display:flex;gap:6px;flex-wrap:wrap}
.st-modal-btn{flex:1;min-width:74px;appearance:none;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.1);color:inherit;border-radius:7px;padding:7px 8px;font:inherit;font-size:12px;cursor:pointer}
.st-modal-btn:hover{background:rgba(127,127,127,.2)}
.st-modal-btn.primary{background:#2d6cdf;border-color:#2d6cdf;color:#fff;font-weight:600}
`;
var main_default = {
  activate(ctx) {
    const app = ctx.app;
    const core = (name, params) => app.commands.execute("plugin.soksak-plugin-agents-acp." + name, params ?? {});
    const engine = createEngine(app);
    let lang = app.locale?.() ?? "ko";
    ctx.subscriptions.push(
      app.events.on("locale.changed", (e) => {
        lang = e.language;
      })
    );
    const settingPolicy = () => app.settings?.get("permissionPolicy") || void 0;
    const settingMode = () => {
      const v = app.settings?.get("kibitzDefault");
      return v === "turn" || v === "simul" ? v : "facil";
    };
    const settingDepthCap = () => Math.max(1, Number(app.settings?.get("nameTriggerDepthCap")) || 4);
    const settingFacilMax = () => Math.max(1, Number(app.settings?.get("facilMaxRounds")) || FACIL_MAX_ROUNDS);
    const projectCwd = () => app.project?.current?.()?.root;
    let activeStudio = null;
    ctx.subscriptions.push(
      app.commands.register("send", {
        description: "Inject a human message into the active Studio view, equivalent to typing and submitting via the textarea. Use to drive or interject a multi-agent conversation programmatically (E2E, automation, AI control).",
        triggers: { ko: "\uC2A4\uD29C\uB514\uC624 \uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uB300\uD654 \uC8FC\uC785 \uCC38\uACAC" },
        params: {
          text: { type: "string", required: true, description: "Message text to send." },
          mode: { type: "string", description: "turn|facil|simul \u2014 set conversation mode before sending. Omit to keep current mode." },
          cut: { type: "boolean", description: "true = immediately interrupt the current agent turn without the ask/wait dialog (deterministic for E2E)." }
        },
        handler: async (p) => {
          const text = String(p?.text ?? "").trim();
          if (!text) return { ok: false, error: "text \uD544\uC218" };
          if (!activeStudio) return { ok: false, error: "\uD65C\uC131 Studio \uBDF0 \uC5C6\uC74C(\uBDF0\uB97C \uBA3C\uC800 \uC5EC\uC138\uC694)" };
          if (p?.mode === "turn" || p?.mode === "facil" || p?.mode === "simul") {
            setMode(activeStudio, p.mode);
          }
          onHuman(activeStudio, text, p?.cut === true);
          return { ok: true, sent: text, mode: activeStudio.mode, running: activeStudio.running };
        }
      })
    );
    ctx.subscriptions.push(
      app.commands.register("state", {
        description: "Return the live state of the active Studio view: conversation mode, running flag, utterance count, roster check states, and streaming length of in-progress agent turns. Use to observe the studio from E2E tests or AI automation.",
        triggers: { ko: "\uC2A4\uD29C\uB514\uC624 \uC0C1\uD0DC \uB300\uD654 \uC9C4\uD589 \uD655\uC778 \uBAA8\uB4DC \uB85C\uC2A4\uD130" },
        params: {},
        handler: async () => {
          const st = activeStudio;
          if (!st) return { ok: false, error: "\uD65C\uC131 Studio \uBDF0 \uC5C6\uC74C" };
          return {
            ok: true,
            mode: st.mode,
            facilitator: st.facilitatorId,
            // 진행 모드 진행자(👑)
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
        description: "Send a single prompt to one ACP agent (connect \u2192 new session \u2192 prompt) and return the response text and tool calls. Use for headless single-turn queries without opening the Studio UI.",
        triggers: { ko: "\uC5D0\uC774\uC804\uD2B8 \uB2E8\uC77C \uC9C8\uBB38 \uD504\uB86C\uD504\uD2B8 \uD5E4\uB4DC\uB9AC\uC2A4 \uB2E8\uBC1C" },
        params: {
          agent: { type: "string", description: "Agent preset id: claude | codex | gemini (default: claude)." },
          text: { type: "string", required: true, description: "Prompt text to send to the agent." }
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
        description: "Run a single round of multi-agent turn-taking: each agent in the given order responds once to the human message, optionally writing real files to cwd. Returns utterances and written files. Use to orchestrate a headless multi-agent exchange from E2E tests or AI automation.",
        triggers: { ko: "\uB2E4\uC911 \uC5D0\uC774\uC804\uD2B8 \uB300\uD654 \uD134\uD14C\uC774\uD0B9 \uD611\uC5C5 \uAD50\uD658 \uD5E4\uB4DC\uB9AC\uC2A4" },
        params: {
          message: { type: "string", required: true, description: "Human message (task or prompt) that starts the exchange." },
          agents: {
            type: "array",
            description: "Ordered list of participants \u2014 preset id strings (claude, codex, gemini) or {id, cmd, args} objects for headless custom agent launch. Defaults to all active presets."
          },
          cwd: { type: "string", description: "Working directory for real file operations; used to compute files written by agents." }
        },
        handler: async (p) => {
          const raw = Array.isArray(p.agents) && p.agents.length ? p.agents : ACTIVE_AGENTS.map((a) => a.id);
          const specs = raw.map(
            (a) => typeof a === "string" ? { id: a, agent: a, cmd: void 0, args: void 0 } : { id: String(a.id), agent: void 0, cmd: a.cmd, args: a.args }
          );
          const roster = specs.map((s) => ({ id: s.id, checked: true }));
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
              conversation,
              nameOf,
              preamble: (s) => inviteePreamble(s, rosterIds, nameOf, cwd, "turn"),
              turn: async (id, prompt) => (await askAgent(id, prompt)).trim(),
              // 미연결이면 throw → 이 발화 skip
              onUtterance: (u) => utterances.push(u)
            });
            const filesWritten = engine.diffWritten(before, await engine.snapshot(cwd));
            return { ok: true, order: rosterIds, utterances, filesWritten, skipped };
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
      const kibEl = el("div", "st-kib");
      const status = el("div", "st-status");
      const msgs = el("div", "st-msgs");
      const inrow = el("div", "st-in");
      const ta = document.createElement("textarea");
      ta.placeholder = t("placeholder", lang);
      ta.rows = 1;
      ta.dataset.node = "input";
      const send = document.createElement("button");
      send.textContent = t("sendBtn", lang);
      send.dataset.node = "send";
      const mentionPop = el("div", "st-mention");
      mentionPop.style.display = "none";
      inrow.append(mentionPop, ta, send);
      const st = {
        roster: ACTIVE_AGENTS.map((a) => ({ id: a.id, checked: true })),
        mode: settingMode(),
        conv: [],
        conns: /* @__PURE__ */ new Map(),
        running: false,
        facilitatorId: ACTIVE_AGENTS[0]?.id ?? "",
        // 기본 진행자 = 첫 활성 에이전트
        pendingHuman: [],
        actives: /* @__PURE__ */ new Set(),
        cwd: projectCwd(),
        msgs,
        tabsEl,
        kibEl,
        status
      };
      states.set(container, st);
      activeStudio = st;
      buildKibitz(st);
      renderTabs(st, tabsEl);
      bar.append(elText("b", "Studio"), tabsEl, kibEl, status);
      root.append(bar, msgs, inrow);
      const doSend = () => {
        const t2 = ta.value.trim();
        if (!t2) return;
        ta.value = "";
        hideMention();
        onHuman(st, t2, false, () => {
          ta.value = t2;
          ta.focus();
        });
      };
      let menTokens = [];
      let menActive = -1;
      let menStart = -1;
      const hideMention = () => {
        mentionPop.style.display = "none";
        menActive = -1;
        menStart = -1;
      };
      const renderMention = () => {
        mentionPop.replaceChildren();
        menTokens.forEach((t2, i) => {
          const row = el("div", "st-mention-item" + (i === menActive ? " on" : ""));
          row.style.color = COLOR[t2.id] ?? "var(--fg,#ddd)";
          row.append(elText("span", "@", "st-mention-at"), elText("span", t2.label, "st-mention-nm"));
          row.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            pickMention(i);
          });
          mentionPop.appendChild(row);
        });
      };
      const pickMention = (i) => {
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
        const m = /@([^\s@]*)$/.exec(pre);
        if (!m) return hideMention();
        const q = m[1].toLowerCase();
        const checked = new Set(participants(st.roster));
        menTokens = ACTIVE_AGENTS.filter((a) => checked.has(a.id)).map((a) => ({ label: a.label, id: a.id })).filter((t2) => !q || t2.label.toLowerCase().startsWith(q) || t2.id.startsWith(q));
        if (!menTokens.length) return hideMention();
        menStart = caret - m[0].length;
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
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          doSend();
        }
      });
      setStatus(st, t("statusIdle", lang));
    }
    function setMode(st, m) {
      st.mode = m;
      for (const c of Array.from(st.kibEl.children)) {
        c.classList.toggle("on", c.dataset.mode === m);
      }
      renderTabs(st, st.tabsEl);
    }
    function buildKibitz(st) {
      const mk = (m, label) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.dataset.mode = m;
        b.dataset.node = `mode/${m}`;
        b.classList.toggle("on", m === st.mode);
        b.addEventListener("click", () => setMode(st, m));
        return b;
      };
      st.kibEl.append(mk("facil", t("modeFacil", lang)), mk("turn", t("modeTurn", lang)), mk("simul", t("modeSimul", lang)));
    }
    function renderTabs(st, tabsEl) {
      tabsEl.replaceChildren();
      st.roster.forEach((entry) => {
        const a = AGENTS.find((x) => x.id === entry.id);
        const chip = el("div", "st-tab" + (entry.checked ? "" : " off"));
        chip.style.color = a?.color ?? "#888";
        chip.dataset.id = entry.id;
        chip.dataset.node = `tab/${entry.id}`;
        const chk = el("span", "chk");
        chk.textContent = entry.checked ? "\u2713" : "";
        const nm = elText("span", a?.label ?? entry.id, "nm");
        nm.style.color = "var(--fg,#ddd)";
        chip.append(chk, nm);
        if (st.mode === "facil" && entry.checked) {
          const crown = elText("span", "\u{1F451}", "st-crown" + (entry.id === st.facilitatorId ? " on" : ""));
          crown.title = t("crownTitle", lang);
          crown.dataset.node = `crown/${entry.id}`;
          crown.addEventListener("click", (e) => {
            e.stopPropagation();
            st.facilitatorId = entry.id;
            renderTabs(st, st.tabsEl);
          });
          chip.append(crown);
        }
        chip.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const startX = e.clientX;
          let moved = false;
          const onMove = (ev) => {
            if (!moved && Math.abs(ev.clientX - startX) > 5) {
              moved = true;
              chip.classList.add("drag");
            }
            if (!moved) return;
            let ref = null;
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
          const onUp = (ev) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            chip.classList.remove("drag");
            if (moved) {
              const order = Array.from(tabsEl.children).map((c) => c.dataset.id ?? "");
              st.roster.sort((a2, b) => order.indexOf(a2.id) - order.indexOf(b.id));
            } else {
              const under = document.elementFromPoint(ev.clientX, ev.clientY);
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
    function setStatus(st, t2) {
      st.status.textContent = t2;
    }
    function onHuman(st, text, forceCut, onCancel) {
      if (!st.running) {
        st.conv.push({ who: "human", text });
        renderUser(st, text);
        void runLoop(st);
        return;
      }
      const apply = (kind) => {
        st.pendingHuman.push(text);
        if (kind === "cut") {
          for (const c of st.actives) engine.cancel(c.connId, c.sessionId);
          setStatus(st, t("statusInterject", lang));
        } else {
          renderQueued(st);
          setStatus(st, t("statusQueued", lang));
        }
      };
      if (forceCut) return apply("cut");
      const who = [...st.actives].map((c) => nameOf(c.agentId)).join(", ") || t("whoConversation", lang);
      showInterjectAlert(st, who, (choice) => {
        if (choice === "cut") apply("cut");
        else if (choice === "wait") apply("wait");
        else onCancel?.();
      });
    }
    function injectPending(st) {
      clearQueued(st);
      clearModal(st);
      for (const t2 of st.pendingHuman) {
        st.conv.push({ who: "human", text: t2 });
        renderUser(st, t2);
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
    async function resolveMentions(st, scanFrom) {
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
            preamble: `${inviteePreamble(id, ids, nameOf, st.cwd, st.mode)}
(\uB2F9\uC2E0\uC774 @${nameOf(id)} \uC73C\uB85C \uC9C0\uBAA9\uB418\uC5C8\uC2B5\uB2C8\uB2E4 \u2014 \uC704 \uB300\uD654\uC5D0 \uC774\uC5B4 \uB2F5\uD558\uC138\uC694.)`
          });
          const work = await runOneTurn(st, id, prompt);
          if (work) st.conv.push({ who: id, text: work });
        }
      }
    }
    async function driveSequential(st, ids) {
      const parts = participants(st.roster);
      for (const speaker of parts) {
        if (st.pendingHuman.length) return;
        if (!st.roster.find((r) => r.id === speaker)?.checked) continue;
        setStatus(st, `${nameOf(speaker)} \uC751\uB2F5 \uC911\u2026`);
        const prompt = buildPrompt({
          roster: st.roster,
          conversation: st.conv,
          speaker,
          nameOf,
          preamble: inviteePreamble(speaker, ids, nameOf, st.cwd, "turn")
        });
        const work = await runOneTurn(st, speaker, prompt);
        if (work) st.conv.push({ who: speaker, text: work });
        if (st.pendingHuman.length) return;
      }
    }
    async function facilTurn(st, id, ids) {
      if (!st.roster.find((r) => r.id === id)?.checked) return;
      setStatus(st, `${nameOf(id)} \uC751\uB2F5 \uC911\u2026`);
      const prompt = buildPrompt({
        roster: st.roster,
        conversation: st.conv,
        speaker: id,
        nameOf,
        preamble: inviteePreamble(id, ids, nameOf, st.cwd, "facil")
      });
      const w = await runOneTurn(st, id, prompt);
      if (w) st.conv.push({ who: id, text: w });
    }
    async function driveFacilitated(st, ids) {
      const checked = participants(st.roster);
      if (!checked.length) return;
      const facilitator = checked.includes(st.facilitatorId) ? st.facilitatorId : pickFacilitator(st.roster) ?? checked[0];
      const cap = settingFacilMax();
      for (let round = 0; round < cap; round++) {
        if (st.pendingHuman.length) return;
        setStatus(st, `${nameOf(facilitator)} \uC9C4\uD589 \uC911\u2026`);
        const lastRound = round >= cap - 1;
        const fprompt = buildPrompt({
          roster: st.roster,
          conversation: st.conv,
          speaker: facilitator,
          nameOf,
          preamble: facilitatorPreamble(facilitator, ids, nameOf, st.cwd) + (lastRound ? "\n(\uC774\uBC88\uC774 \uB9C8\uC9C0\uB9C9 \uC9C4\uD589 \uCC28\uB840\uC785\uB2C8\uB2E4 \u2014 \uC815\uB9AC\uD558\uACE0 \uB9C8\uBB34\uB9AC\uD558\uC138\uC694.)" : "")
        });
        const fwork = await runOneTurn(st, facilitator, fprompt);
        if (fwork) st.conv.push({ who: facilitator, text: fwork });
        if (st.pendingHuman.length) return;
        if (!fwork) return;
        const dir = parseFacilitatorDirective(fwork, ids, facilitator, nameOf);
        if (dir.pattern === "none") return;
        const targets = (dir.targets.length ? dir.targets : checked).filter(
          (id) => id !== facilitator && st.roster.find((r) => r.id === id)?.checked
        );
        if (!targets.length) continue;
        if (dir.pattern === "simul") {
          await Promise.all(targets.map((id) => facilTurn(st, id, ids)));
        } else {
          for (const id of targets) {
            if (st.pendingHuman.length) return;
            await facilTurn(st, id, ids);
          }
        }
      }
      setStatus(st, t("statusFacilDone", lang));
    }
    function humanTargets(st) {
      const ids = st.roster.map((r) => r.id);
      const checked = new Set(participants(st.roster));
      const targets = [];
      for (let i = st.conv.length - 1; i >= 0; i--) {
        if (st.conv[i].who !== "human") break;
        for (const id of detectMentions(st.conv[i].text, ids, "human", nameOf)) {
          if (checked.has(id) && !targets.includes(id)) targets.push(id);
        }
      }
      return targets;
    }
    async function driveTargeted(st, ids, targets) {
      const snapshot = st.conv.slice();
      await Promise.all(
        targets.map(async (id) => {
          setStatus(st, `${nameOf(id)} \uC751\uB2F5 \uC911\u2026`);
          const prompt = buildPrompt({
            roster: st.roster,
            conversation: snapshot,
            speaker: id,
            nameOf,
            preamble: inviteePreamble(id, ids, nameOf, st.cwd, "simul")
          });
          const w = await runOneTurn(st, id, prompt);
          if (w) st.conv.push({ who: id, text: w });
        })
      );
    }
    async function runLoop(st) {
      st.running = true;
      const ids = st.roster.map((x) => x.id);
      for (; ; ) {
        const scanFrom = st.conv.length;
        const targets = humanTargets(st);
        if (targets.length) {
          await driveTargeted(st, ids, targets);
        } else if (st.mode === "simul") {
          await driveSimul({
            roster: st.roster,
            conversation: st.conv,
            nameOf,
            preamble: (s) => inviteePreamble(s, ids, nameOf, st.cwd, "simul"),
            onTurnStart: () => setStatus(st, t("statusSimul", lang)),
            turn: (speaker, prompt) => runOneTurn(st, speaker, prompt)
          });
        } else if (st.mode === "facil") {
          await driveFacilitated(st, ids);
        } else {
          await driveSequential(st, ids);
        }
        if (st.pendingHuman.length) {
          injectPending(st);
          continue;
        }
        if (!targets.length && st.mode !== "facil") {
          await resolveMentions(st, scanFrom);
        }
        if (st.pendingHuman.length) {
          injectPending(st);
          continue;
        }
        break;
      }
      st.actives.clear();
      if (st.pendingHuman.length) {
        injectPending(st);
        return runLoop(st);
      }
      st.running = false;
      setStatus(st, t("statusIdle", lang));
    }
    function onStream(cur, evt) {
      const u = evt?.update;
      if (!u || u.sessionUpdate !== "agent_message_chunk") return;
      const t2 = u.content?.text ?? "";
      if (t2 !== "" && t2 === cur.liveRaw) return;
      cur.liveRaw += t2;
      if (t2) {
        if (!cur.bubble) cur.bubble = cur.row.toBubble();
        cur.bubble.textContent = (cur.bubble.textContent || "") + t2;
      }
    }
    function renderUser(st, text) {
      const row = el("div", "st-row user");
      const who = el("div", "st-who");
      who.append(elText("span", t("whoMe", lang), "st-who-name"), elText("span", ` \xB7 ${hhmmss()}`, "st-who-time"));
      row.append(who, bubble(text));
      st.msgs.appendChild(row);
      scroll(st);
    }
    function renderQueued(st) {
      clearQueued(st);
      const last = st.pendingHuman[st.pendingHuman.length - 1] ?? "";
      const row = el("div", "st-row user queued");
      row.dataset.queued = "1";
      const who = el("div", "st-who");
      who.append(elText("span", t("whoMe", lang), "st-who-name"), elText("span", t("queuedTag", lang), "st-queued-tag"));
      row.append(who, bubble(last));
      st.msgs.appendChild(row);
      scroll(st);
    }
    function clearQueued(st) {
      st.msgs.querySelectorAll('.st-row.queued[data-queued="1"]').forEach((n) => n.remove());
    }
    function clearModal(st) {
      st.msgs.parentElement?.querySelectorAll(".st-modal").forEach((n) => n.remove());
    }
    function showInterjectAlert(st, who, cb) {
      const root = st.msgs.parentElement ?? st.msgs;
      st.msgs.parentElement?.querySelectorAll(".st-modal").forEach((n) => n.remove());
      const back = el("div", "st-modal");
      const box = el("div", "st-modal-box");
      box.append(elText("div", tp("modalTitle", lang, { who }), "st-modal-title"));
      box.append(elText("div", t("modalMsg", lang), "st-modal-msg"));
      const btns = el("div", "st-modal-btns");
      const close = (c) => {
        back.remove();
        cb(c);
      };
      const mk = (label, c, primary) => {
        const b = elText("button", label, "st-modal-btn" + (primary ? " primary" : ""));
        b.dataset.node = `modal/${c}`;
        b.addEventListener("click", () => close(c));
        return b;
      };
      btns.append(mk(t("btnCut", lang), "cut", true), mk(t("btnWait", lang), "wait"), mk(t("btnCancel", lang), "cancel"));
      box.append(btns);
      back.append(box);
      back.addEventListener("click", (e) => {
        if (e.target === back) close("cancel");
      });
      root.appendChild(back);
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
      pending.append(el("span", "st-dot"), document.createTextNode(t("pending", lang)));
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
          const badge = elText("span", t("thinkBadge", lang), "st-think");
          badge.title = t("thinkBadgeTitle", lang);
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
