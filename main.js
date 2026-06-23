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
  async function requestPlan(launch, systemPrompt, cwd) {
    let conn = null;
    try {
      conn = await connect(launch, cwd, "deny");
      const r = await ask(conn.connId, conn.sessionId, systemPrompt);
      return r.text ?? "";
    } finally {
      if (conn) await disconnect(conn.connId);
    }
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
  return { connect, newSession, ask, requestPlan, cancel, disconnect, snapshot, diffWritten };
}

// src/i18n.ts
var strings = {
  placeholder: {
    en: "Message\u2026 (Enter to send, Shift+Enter for newline, @ to mention a model)",
    ko: "\uBA54\uC2DC\uC9C0\u2026 (Enter \uC804\uC1A1, Shift+Enter \uC904\uBC14\uAFC8, @\uB85C \uBAA8\uB378 \uC9C0\uBAA9)"
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
  },
  towerTitle: {
    en: "AI Command",
    ko: "AI \uBA85\uB839"
  },
  towerSubtitle: {
    en: "Window control \xB7 Command translation \xB7 Search",
    ko: "\uCC3D \uC81C\uC5B4 \xB7 \uBA85\uB839 \uBCC0\uD658 \xB7 \uAC80\uC0C9"
  },
  towerInputPlaceholder: {
    en: 'Type in natural language \u2014 "close the left panel and show the terminal big"',
    ko: '\uC790\uC5F0\uC5B4\uB85C \uC785\uB825 \u2014 "\uC67C\uCABD \uCC3D \uB2EB\uACE0 \uD130\uBBF8\uB110 \uD06C\uAC8C \uBCF4\uC5EC\uC918"'
  },
  towerExamplesTitle: {
    en: "Window control \u2014 click to let AI run it",
    ko: "\uCC3D \uC81C\uC5B4 \u2014 \uD074\uB9AD\uD558\uBA74 AI\uAC00 \uC2E4\uD589"
  },
  towerPaletteTitle: {
    en: "Commands",
    ko: "\uBA85\uB839"
  },
  towerPaletteEmpty: {
    en: "No commands match",
    ko: "\uC77C\uCE58\uD558\uB294 \uBA85\uB839 \uC5C6\uC74C"
  },
  towerLiveTitle: {
    en: "Live",
    ko: "\uB77C\uC774\uBE0C"
  },
  towerLiveEmpty: {
    en: "Agent stream appears here once orchestration starts.",
    ko: "\uC624\uCF00\uC2A4\uD2B8\uB808\uC774\uC158\uC774 \uC2DC\uC791\uB418\uBA74 \uC5D0\uC774\uC804\uD2B8 \uC2A4\uD2B8\uB9BC\uC774 \uC5EC\uAE30 \uD750\uB985\uB2C8\uB2E4."
  },
  towerConfirmTitle: {
    en: "Confirm dangerous command",
    ko: "\uC704\uD5D8 \uBA85\uB839 \uD655\uC778"
  },
  towerConfirmDestructive: {
    en: "This will close or remove something. Run it?",
    ko: "\uC774 \uBA85\uB839\uC740 \uB2EB\uAC70\uB098 \uC81C\uAC70\uD569\uB2C8\uB2E4. \uC2E4\uD589\uD560\uAE4C\uC694?"
  },
  towerConfirmInject: {
    en: "This will inject input or send data. Run it?",
    ko: "\uC774 \uBA85\uB839\uC740 \uC785\uB825\uC744 \uC8FC\uC785\uD558\uAC70\uB098 \uB370\uC774\uD130\uB97C \uBCF4\uB0C5\uB2C8\uB2E4. \uC2E4\uD589\uD560\uAE4C\uC694?"
  },
  towerConfirmRun: {
    en: "Run",
    ko: "\uC2E4\uD589"
  },
  towerConfirmCancel: {
    en: "Cancel",
    ko: "\uCDE8\uC18C"
  },
  towerRunOk: {
    en: "Done.",
    ko: "\uC644\uB8CC."
  },
  towerRunNeedsTarget: {
    en: "No matching target found.",
    ko: "\uB300\uC0C1\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."
  },
  towerRunDenied: {
    en: "Cancelled.",
    ko: "\uCDE8\uC18C\uB428."
  },
  towerRunFailed: {
    en: "Command failed.",
    ko: "\uBA85\uB839 \uC2E4\uD328."
  },
  towerPlanning: {
    en: "Planning\u2026",
    ko: "\uACC4\uD68D \uC138\uC6B0\uB294 \uC911\u2026"
  },
  towerPlanTitle: {
    en: "Plan preview \u2014 press \u23CE to run",
    ko: "\uACC4\uD68D \uBBF8\uB9AC\uBCF4\uAE30 \u2014 \u23CE \uB204\uB974\uBA74 \uC2E4\uD589"
  },
  towerPlanRunAll: {
    en: "Run plan",
    ko: "\uACC4\uD68D \uC2E4\uD589"
  },
  towerPlanDiscard: {
    en: "Discard",
    ko: "\uBC84\uB9AC\uAE30"
  },
  towerPlanFailed: {
    en: "Could not build a runnable plan.",
    ko: "\uC2E4\uD589 \uAC00\uB2A5\uD55C \uACC4\uD68D\uC744 \uB9CC\uB4E4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."
  },
  towerPlanNoAgent: {
    en: "No agent connected \u2014 open a Clubhouse view first.",
    ko: "\uC5F0\uACB0\uB41C \uC5D0\uC774\uC804\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4 \u2014 Clubhouse \uBDF0\uB97C \uBA3C\uC800 \uC5EC\uC138\uC694."
  },
  towerPlanDone: {
    en: "Plan executed.",
    ko: "\uACC4\uD68D \uC2E4\uD589 \uC644\uB8CC."
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

// src/tower/plan.ts
var DESTRUCTIVE = /* @__PURE__ */ new Set([
  "content.close",
  "data.import",
  "data.restore",
  "panel.close",
  "plugin.consent.revoke",
  "plugin.disable",
  "plugin.install",
  "plugin.remove",
  "plugin.update",
  "project.close",
  "secret.delete",
  "view.close",
  "editor.close",
  // view.close 위임(코어 desc "same as view.close") — 닫기이므로 게이트.
  "window.close"
  // 창 닫기 — 파괴.
]);
var INJECT = /* @__PURE__ */ new Set([
  "clipboard.write",
  "media.proxy.info",
  "media.proxy.playlist",
  "media.proxy.stream",
  "net.http.request",
  "net.udp.request",
  "net.udp.send",
  "plugin.dev.load",
  "plugin.dev.new",
  "plugin.enable",
  "schedule.set",
  "secret.set",
  "secret.unlock",
  "term.exec",
  "term.send",
  "ui.input.click",
  "ui.input.dblclick",
  "ui.input.drag",
  "ui.input.fill"
]);
function classifyDanger(name) {
  if (DESTRUCTIVE.has(name)) return "destructive";
  if (INJECT.has(name)) return "inject";
  return void 0;
}
var AXES = /* @__PURE__ */ new Set(["command", "dom", "status"]);
function validatePlan(steps, ctx) {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s || typeof s !== "object" || !AXES.has(s.axis)) {
      return { ok: false, code: "INVALID_STEP", index: i, message: `\uC798\uBABB\uB41C step(axis): ${JSON.stringify(s)}` };
    }
    if (s.axis === "dom") {
      if (typeof s.name !== "string" || !s.name) {
        return { ok: false, code: "INVALID_STEP", index: i, message: "dom step \uC5D0 name \uB204\uB77D" };
      }
      if (!ctx.commandNames.has(s.name)) {
        return { ok: false, code: "UNKNOWN_COMMAND", index: i, message: `\uBBF8\uB4F1\uB85D dom command: ${s.name}` };
      }
      if (typeof s.address !== "string" || !s.address) {
        return { ok: false, code: "INVALID_STEP", index: i, message: "dom step \uC5D0 address \uB204\uB77D" };
      }
      if (!ctx.domAddresses.has(s.address)) {
        return { ok: false, code: "NOT_EXPOSED", index: i, message: `\uB178\uCD9C\uB418\uC9C0 \uC54A\uC740 \uC8FC\uC18C: ${s.address}` };
      }
      continue;
    }
    if (typeof s.name !== "string" || !s.name) {
      return { ok: false, code: "INVALID_STEP", index: i, message: `${s.axis} step \uC5D0 name \uB204\uB77D` };
    }
    if (!ctx.commandNames.has(s.name)) {
      return { ok: false, code: "UNKNOWN_COMMAND", index: i, message: `\uBBF8\uB4F1\uB85D command: ${s.name}` };
    }
  }
  return { ok: true };
}
function planContextFromDomain(map) {
  return {
    commandNames: new Set(map.commands.map((c) => c.name)),
    domAddresses: new Set(map.addresses)
  };
}
function buildPlanSystemPrompt(nl, map, correction) {
  const cmds = map.commands.map((c) => {
    const base = (c.description || "").split(" | ")[0].trim();
    return base ? `  - ${c.name} \u2014 ${base}` : `  - ${c.name}`;
  }).join("\n");
  const addrs = map.addresses.length ? map.addresses.map((a) => `  - ${a}`).join("\n") : "  (\uC5C6\uC74C)";
  const stats = map.statuses.length ? map.statuses.map((s) => `  - ${s.viewId}: ${s.code}${s.message ? ` (${s.message})` : ""}`).join("\n") : "  (\uC5C6\uC74C)";
  const correctionBlock = correction ? `

[\uC9C1\uC804 PLAN \uC774 \uAC70\uBD80\uB418\uC5C8\uC2B5\uB2C8\uB2E4]
${correction}
\uC704 \uB3C4\uBA54\uC778\uB9F5\uC5D0 \uC2E4\uC81C\uB85C \uC788\uB294 command/\uC8FC\uC18C\uB9CC \uC4F0\uC138\uC694. \uCD94\uCE21 \uAE08\uC9C0.` : "";
  return `\uB2F9\uC2E0\uC740 soksak \uCEE8\uD2B8\uB864 \uD0C0\uC6CC\uC758 \uD50C\uB798\uB108\uC785\uB2C8\uB2E4. \uC0AC\uC6A9\uC790\uC758 \uC790\uC5F0\uC5B4 \uC694\uCCAD\uC744 \uC544\uB798 3\uCD95 \uB3C4\uBA54\uC778\uB9F5 \uC548\uC5D0\uC11C\uB9CC \uC2E4\uD589 \uAC00\uB2A5\uD55C PLAN \uC73C\uB85C \uBCC0\uD658\uD558\uC138\uC694.

[\uC0AC\uC6A9\uC790 \uC694\uCCAD]
${nl}

[\uCD951 \u2014 \uC0AC\uC6A9 \uAC00\uB2A5\uD55C command (\uC774 \uC774\uB984\uB4E4\uB9CC \uD5C8\uC6A9)]
${cmds}

[\uCD952 \u2014 \uD604\uC7AC \uD654\uBA74\uC758 \uC870\uC791 \uAC00\uB2A5\uD55C \uC8FC\uC18C (dom \uCD95 ui.input.click/fill \uB300\uC0C1, \uC774 \uC8FC\uC18C\uB4E4\uB9CC \uD5C8\uC6A9)]
${addrs}

[\uCD953 \u2014 \uAC01 \uBDF0\uAC00 \uBCF4\uACE0\uD55C \uD604\uC7AC \uC0C1\uD0DC (\uD30C\uAD34\uC801 step \uC804\uC5D0 \uD655\uC778)]
${stats}

[PLAN \uD615\uC2DD \u2014 \uBC18\uB4DC\uC2DC JSON \uBC30\uC5F4 \uD558\uB098\uB9CC]
\uAC01 step = {"axis":"command"|"dom"|"status", "name":"<command \uC774\uB984>", "params":{...}} \uB610\uB294 dom \uC740 {"axis":"dom","name":"ui.input.click","address":"<\uCD952 \uC8FC\uC18C>"}.
- command/status \uB294 \uCD951 \uC774\uB984\uB9CC. dom \uC740 name \uC744 ui.input.click/ui.input.fill \uB85C \uB450\uACE0 address \uB294 \uCD952 \uC8FC\uC18C\uB9CC.
- \uD30C\uAD34\uC801(\uB2EB\uAE30/\uC81C\uAC70) command \uC55E\uC5D4 status step \uC73C\uB85C \uC548\uC804\uC744 \uBA3C\uC800 \uD655\uC778\uD558\uC138\uC694.
- \uC124\uBA85\xB7\uC778\uC0AC\xB7\uCF54\uB4DC \uC124\uBA85 \uC5C6\uC774 PLAN(JSON \uBC30\uC5F4)\uB9CC \uCD9C\uB825\uD558\uC138\uC694. \uCF54\uB4DC\uD39C\uC2A4\uB85C \uAC10\uC2F8\uB3C4 \uB429\uB2C8\uB2E4.` + correctionBlock;
}
function parsePlan(text) {
  if (typeof text !== "string") return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  const bal = extractBalancedArray(text);
  if (bal) candidates.push(bal);
  candidates.push(text);
  for (const c of candidates) {
    const s = c.trim();
    if (!s) continue;
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) return v;
    } catch {
    }
  }
  return null;
}
function extractBalancedArray(text) {
  const start = text.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
var EXAMPLE_COMMANDS = [
  {
    // "에디터 패널 닫아줘" — 활성 패널의 에디터 뷰를 찾아 닫는다(destructive).
    text: "\uC5D0\uB514\uD130 \uD328\uB110 \uB2EB\uC544\uC918",
    command: "editor.close",
    resolveParams: async (q) => {
      const r = await q("panel.list");
      const panels = Array.isArray(r?.panels) ? r.panels : [];
      for (const p of panels) {
        const v = (p.views ?? []).find((vw) => vw.kind === "editor");
        if (v) return { view: v.id };
      }
      return null;
    }
  },
  {
    // "터미널 패널 닫아줘" — 터미널 뷰가 든 패널 그룹을 닫는다(destructive).
    text: "\uD130\uBBF8\uB110 \uD328\uB110 \uB2EB\uC544\uC918",
    command: "panel.close",
    resolveParams: async (q) => {
      const r = await q("panel.list");
      const panels = Array.isArray(r?.panels) ? r.panels : [];
      const term = panels.find(
        (p) => (p.views ?? []).some((vw) => vw.plugin === "soksak-plugin-terminal")
      );
      if (term) return { group: term.id };
      const active = panels.find((p) => p.active) ?? panels[0];
      return active ? { group: active.id } : null;
    }
  },
  {
    // "분할 반반으로 맞춰줘" — 첫 split 을 균등 분배(비파괴).
    text: "\uBD84\uD560 \uBC18\uBC18\uC73C\uB85C \uB9DE\uCDB0\uC918",
    command: "panel.equalize",
    resolveParams: async (q) => {
      const r = await q("state.tree");
      const sid = findFirstSplitId(r?.tree);
      return sid ? { split: sid } : null;
    }
  },
  {
    // "다크 모드로 바꿔줘" — 현재 테마 유지, 모드만 dark(비파괴).
    text: "\uB2E4\uD06C \uBAA8\uB4DC\uB85C \uBC14\uAFD4\uC918",
    command: "theme.apply",
    resolveParams: async (q) => {
      const r = await q("theme.list");
      const name = typeof r?.current === "string" ? r.current : r?.themes?.[0]?.name;
      return name ? { name, mode: "dark" } : null;
    }
  },
  {
    // "다음 테마로 바꿔줘" — theme.list 순서상 다음 테마(비파괴).
    text: "\uB2E4\uC74C \uD14C\uB9C8\uB85C \uBC14\uAFD4\uC918",
    command: "theme.apply",
    resolveParams: async (q) => {
      const r = await q("theme.list");
      const themes = Array.isArray(r?.themes) ? r.themes : [];
      if (!themes.length) return null;
      const cur = typeof r?.current === "string" ? r.current : themes[0].name;
      const idx = themes.findIndex((tt) => tt.name === cur);
      const next = themes[(idx + 1) % themes.length];
      return next?.name ? { name: next.name } : null;
    }
  }
];
function findFirstSplitId(node) {
  if (!node || typeof node !== "object") return void 0;
  if (node.split && typeof node.split.id === "string") return node.split.id;
  if (typeof node.id === "string" && Array.isArray(node.children)) return node.id;
  for (const v of Object.values(node)) {
    const found = findFirstSplitId(v);
    if (found) return found;
  }
  return void 0;
}

// src/tower/distribute.ts
function stepAssignee(s, participants2, nameOf2) {
  if (s && typeof s.assignee === "string" && participants2.includes(s.assignee)) return s.assignee;
  const hay = JSON.stringify(s ?? {}).toLowerCase();
  for (const id of participants2) {
    for (const cand of [nameOf2(id), id]) {
      if (hay.includes(("@" + cand).toLowerCase())) return id;
    }
  }
  return null;
}
async function distributePlans(opts) {
  const { mode, participants: participants2, facilitatorId, nameOf: nameOf2, planFor } = opts;
  const sys = (id) => opts.systemPromptFor ? opts.systemPromptFor(id) : "";
  if (participants2.length <= 1) {
    const id = participants2[0];
    if (!id) return { mode, plans: [] };
    const steps2 = parsePlan(await planFor(id, sys(id))) ?? [];
    return { mode, plans: steps2.length ? [{ agentId: id, steps: steps2 }] : [] };
  }
  if (mode === "simul") {
    const results = await Promise.all(
      participants2.map(async (id) => {
        const steps2 = parsePlan(await planFor(id, sys(id))) ?? [];
        return { agentId: id, steps: steps2 };
      })
    );
    return { mode, plans: results.filter((p) => p.steps.length > 0) };
  }
  if (mode === "turn") {
    const plans2 = [];
    let priorContext = "";
    for (const id of participants2) {
      const raw2 = await planFor(id, sys(id), priorContext || void 0);
      const steps2 = parsePlan(raw2) ?? [];
      if (steps2.length) plans2.push({ agentId: id, steps: steps2 });
      priorContext = `${priorContext}${priorContext ? "\n" : ""}[${nameOf2(id)} \uC758 \uC9C1\uC804 PLAN]
${JSON.stringify(steps2)}`;
    }
    return { mode, plans: plans2 };
  }
  const fid = participants2.includes(facilitatorId) ? facilitatorId : participants2[0];
  const raw = await planFor(fid, sys(fid));
  const steps = parsePlan(raw) ?? [];
  const byAgent = /* @__PURE__ */ new Map();
  for (const s of steps) {
    const who = stepAssignee(s, participants2, nameOf2) ?? fid;
    const arr = byAgent.get(who) ?? [];
    const { assignee: _drop, ...clean } = s;
    arr.push(clean);
    byAgent.set(who, arr);
  }
  const plans = [];
  for (const id of [fid, ...participants2.filter((p) => p !== fid)]) {
    const arr = byAgent.get(id);
    if (arr && arr.length) plans.push({ agentId: id, steps: arr });
  }
  return { mode, plans };
}

// src/tower/trace.ts
var PLANS = "tower_plans";
var STEPS = "tower_steps";
var PLANS_SCHEMA = { indexes: ["sessionId", "createdAt", "outcome", "agent"] };
var STEPS_SCHEMA = { indexes: ["sessionId", "planId", "seq", "status"] };
function deriveStatus(outcome) {
  if (outcome.ok) return "ok";
  if (outcome.code === "CONFIRM_DENIED") return "denied";
  if (outcome.code === "GATE_REQUIRED" || outcome.code === "FORBIDDEN_CHROME") return "gated";
  return "failed";
}
function createTrace(data, opts) {
  const now = opts.now ?? (() => Date.now());
  const sessionId = opts.sessionId;
  let defined = null;
  const ensureDefined = () => {
    if (!defined) {
      defined = (async () => {
        await data.define(PLANS, PLANS_SCHEMA);
        await data.define(STEPS, STEPS_SCHEMA);
      })().catch(() => {
      });
    }
    return defined;
  };
  async function begin(meta) {
    await ensureDefined();
    const createdAt = now();
    const doc = {
      sessionId,
      nl: meta.nl,
      mode: meta.mode,
      createdAt,
      outcome: "running"
    };
    if (meta.agent !== void 0) doc.agent = meta.agent;
    const planId = await data.put(PLANS, doc);
    let seq = 0;
    const recordStep = async (rec) => {
      const s = rec.step;
      const stepDoc = {
        sessionId,
        planId,
        seq: seq++,
        axis: s.axis,
        name: s.name,
        // 코어 결과 그대로 보존(투명 — 의미가 바뀌면 결과가 바뀐다). status 는 명시 우선, 없으면 코드 파생.
        outcome: rec.outcome,
        status: rec.status ?? deriveStatus(rec.outcome),
        ts: now()
      };
      if (s.params !== void 0) stepDoc.params = s.params;
      if (s.address !== void 0) stepDoc.address = s.address;
      if (rec.danger !== void 0) stepDoc.danger = rec.danger;
      try {
        await data.put(STEPS, stepDoc);
      } catch {
      }
    };
    const finish = async (outcome) => {
      try {
        await data.put(PLANS, { ...doc, outcome, finishedAt: now() }, { id: planId });
      } catch {
      }
    };
    return { planId, recordStep, finish };
  }
  async function recentPlans(o = {}) {
    await ensureDefined();
    const rows = await data.query(PLANS, {
      where: { sessionId },
      order: "createdAt",
      desc: true,
      limit: o.limit ?? 20
    });
    return rows;
  }
  async function stepsOf(planId) {
    await ensureDefined();
    const rows = await data.query(STEPS, {
      where: { sessionId, planId },
      order: "seq",
      desc: false,
      limit: 1e3
    });
    return rows;
  }
  return { sessionId, begin, recentPlans, stepsOf };
}

// src/tower/executor.ts
var ESCALATION_REASON = "\uC5EC\uAE30\uC11C \uB9C9\uD614\uC2B5\uB2C8\uB2E4 \u2014 \uAC1C\uC785 \uD544\uC694";
var CONFIRM_EXPOSED_NODES = ["tower/confirm", "tower/confirm/cancel"];
function isForbiddenChrome(address) {
  return /(^|\/)tower\/confirm(\/|$)/.test(address) || /(^|\/)modal\/confirm-close(\/|$)/.test(address);
}
function randomToken() {
  try {
    const g = globalThis;
    if (g.crypto?.getRandomValues) {
      const b = new Uint8Array(16);
      g.crypto.getRandomValues(b);
      return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    }
  } catch {
  }
  return `t${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
function buildFailureCorrection(fail) {
  if (!fail) return "\uC9C1\uC804 PLAN \uC758 \uC2E4\uD589\uC774 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uB978 \uC811\uADFC\uC73C\uB85C \uB2E4\uC2DC \uACC4\uD68D\uD558\uC138\uC694.";
  const where = fail.step ? ` (\uC2E4\uD328 step: ${fail.step.axis}/${fail.step.name})` : "";
  const code = fail.code ? `[${fail.code}] ` : "";
  const msg = fail.message ?? "\uC6D0\uC778 \uBD88\uBA85";
  return `\uC9C1\uC804 PLAN \uC758 \uC2E4\uD589\uC774 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4${where}: ${code}${msg}. \uC774 \uC2E4\uD328\uB97C \uD53C\uD558\uB3C4\uB85D \uB2E4\uB978 step \uC73C\uB85C \uB2E4\uC2DC \uACC4\uD68D\uD558\uC138\uC694.`;
}
function resolveGoalReached(goalOut, opts) {
  if (opts.verifyGoal) return !!opts.verifyGoal(goalOut);
  if (opts.failGoalCodes && opts.failGoalCodes.length) {
    const codes = new Set(opts.failGoalCodes);
    const statuses = Array.isArray(goalOut?.statuses) ? goalOut.statuses : [];
    return !statuses.some((s) => codes.has(s?.code));
  }
  return !!goalOut.ok;
}
var SEALED = Symbol("tower.executor.sealed");
function createExecutor(deps) {
  const { app, confirmGate } = deps;
  const exec = (name, params) => app.commands.execute(name, params ?? {});
  const gates = /* @__PURE__ */ new Map();
  let confirmTail = Promise.resolve();
  function enqueueConfirm(issue, info) {
    const run = confirmTail.then(() => confirmGate(issue, info));
    confirmTail = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  async function sealedDispatch(token) {
    const entry = gates.get(token);
    if (!entry) {
      return { ok: false, code: "GATE_REQUIRED", message: "\uD655\uC778 \uAC8C\uC774\uD2B8 \uD1A0\uD070\uC774 \uC5C6\uAC70\uB098 \uB9CC\uB8CC\uB428(\uC2E4\uD589 \uBD88\uAC00)" };
    }
    gates.delete(token);
    return exec(entry.name, entry.params);
  }
  async function gatedRun(name, params, danger) {
    const issue = () => {
      const token2 = randomToken();
      gates.set(token2, { name, params });
      return token2;
    };
    const token = await enqueueConfirm(issue, { command: name, danger, params });
    if (token == null) {
      return { ok: false, code: "CONFIRM_DENIED", message: "\uC0AC\uC6A9\uC790\uAC00 \uC704\uD5D8 \uBA85\uB839 \uD655\uC778\uC744 \uAC70\uBD80/\uCDE8\uC18C\uD568" };
    }
    return sealedDispatch(token);
  }
  async function runCommand(name, params = {}) {
    const danger = classifyDanger(name);
    if (danger) return gatedRun(name, params, danger);
    return exec(name, params);
  }
  async function runDom(address) {
    if (isForbiddenChrome(address)) {
      return { ok: false, code: "FORBIDDEN_CHROME", message: `\uBCF4\uC548 chrome \uC740 \uD074\uB9AD \uB300\uC0C1\uC774 \uC544\uB2D8: ${address}` };
    }
    return gatedRun("ui.input.click", { address }, "inject");
  }
  async function runExample(index) {
    const spec = EXAMPLE_COMMANDS[index];
    if (!spec) return { ok: false, code: "UNKNOWN_EXAMPLE", message: `\uC608\uC2DC \uC778\uB371\uC2A4 \uBC94\uC704 \uBC16: ${index}` };
    let params;
    try {
      params = await spec.resolveParams((n, p) => exec(n, p));
    } catch (e) {
      return { ok: false, code: "RESOLVE_FAILED", message: String(e?.message ?? e) };
    }
    if (params == null) {
      return { ok: false, code: "NEEDS_TARGET", message: `\uB300\uC0C1\uC744 \uCC3E\uC9C0 \uBABB\uD568: "${spec.text}"` };
    }
    return runCommand(spec.command, params);
  }
  function stepDanger(s) {
    if (s.axis === "dom") return "inject";
    if (s.axis === "status") return void 0;
    return classifyDanger(s.name);
  }
  async function dispatchStep(s) {
    if (s.axis === "dom") return runDom(s.address);
    if (s.axis === "status") return exec(s.name, s.params ?? {});
    return runCommand(s.name, s.params ?? {});
  }
  async function fetchDomainMap() {
    const [cat, tree, st] = await Promise.all([
      exec("state.commands"),
      exec("ui.tree"),
      exec("status.query").catch(() => ({ statuses: [] }))
    ]);
    return {
      commands: (Array.isArray(cat?.commands) ? cat.commands : []).map((c) => ({
        name: c.name,
        description: c.description
      })),
      addresses: (Array.isArray(tree?.nodes) ? tree.nodes : []).map((n) => n.address),
      statuses: Array.isArray(st?.statuses) ? st.statuses : []
    };
  }
  async function dispatchPlan(steps, opts = {}, tr) {
    const results = [];
    for (const s of steps) {
      if (opts.shouldYield?.()) return { ok: true, yielded: true, results };
      const r = await dispatchStep(s);
      results.push({ step: s, result: r });
      if (tr) await tr.recordStep({ step: s, outcome: r, danger: stepDanger(s), status: deriveStatus(r) });
      if (!r.ok) return { ok: false, code: r.code, message: r.message, results };
    }
    return { ok: true, results };
  }
  async function runPlan(steps) {
    const map = await fetchDomainMap();
    const v = validatePlan(steps, planContextFromDomain(map));
    if (!v.ok) return { ok: false, code: v.code, message: v.message, index: v.index };
    return dispatchPlan(steps);
  }
  function withTrace(frozen, meta) {
    const sink = deps.trace;
    if (!sink || !meta) {
      return { commit: (copts) => dispatchPlan(frozen, copts), discard: async () => {
      } };
    }
    let settled = false;
    return {
      commit: async (copts) => {
        if (settled) return dispatchPlan(frozen, copts);
        settled = true;
        const tr = await sink.begin(meta);
        const r = await dispatchPlan(frozen, copts, tr);
        await tr.finish(r.yielded ? "yielded" : r.ok ? "committed" : "failed");
        return r;
      },
      discard: async () => {
        if (settled) return;
        settled = true;
        const tr = await sink.begin(meta);
        await tr.finish("dry-run-discarded");
      }
    };
  }
  async function planAndRun(nl, opts = {}) {
    if (opts.injectPlan) {
      const map = await fetchDomainMap();
      const v = validatePlan(opts.injectPlan, planContextFromDomain(map));
      if (!v.ok) return { ok: false, code: v.code, message: v.message, steps: opts.injectPlan };
      const frozen = opts.injectPlan;
      const tw = withTrace(frozen, opts.trace);
      return { ok: true, steps: frozen, commit: tw.commit, discard: tw.discard };
    }
    if (!deps.planner) {
      return { ok: false, code: "NO_PLANNER", message: "planning \uC5D4\uC9C4\uC774 \uC5F0\uACB0\uB418\uC9C0 \uC54A\uC74C(\uC5D0\uC774\uC804\uD2B8 \uBBF8\uC5F0\uACB0)" };
    }
    const planner = deps.planner;
    const maxHops = Math.max(1, opts.hops ?? 3);
    let correction;
    let lastErr = {
      code: "PLAN_PARSE_FAILED",
      message: "PLAN \uC744 \uB9CC\uB4E4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."
    };
    for (let hop = 0; hop < maxHops; hop++) {
      const map = await fetchDomainMap();
      const prompt = buildPlanSystemPrompt(nl, map, correction);
      let raw;
      try {
        raw = await planner(prompt);
      } catch (e) {
        lastErr = { code: "PLANNER_FAILED", message: String(e?.message ?? e) };
        correction = `\uD50C\uB798\uB108 \uD638\uCD9C \uC2E4\uD328: ${lastErr.message}`;
        continue;
      }
      const steps = parsePlan(raw);
      if (!steps) {
        lastErr = { code: "PLAN_PARSE_FAILED", message: "PLAN(JSON \uBC30\uC5F4)\uC744 \uD30C\uC2F1\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." };
        correction = "\uC9C1\uC804 \uCD9C\uB825\uC5D0\uC11C JSON \uBC30\uC5F4 PLAN \uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC124\uBA85 \uC5C6\uC774 JSON \uBC30\uC5F4\uB9CC \uCD9C\uB825\uD558\uC138\uC694.";
        continue;
      }
      const v = validatePlan(steps, planContextFromDomain(map));
      if (!v.ok) {
        lastErr = { code: v.code, message: v.message, steps };
        correction = `step #${v.index} \uAC70\uBD80: ${v.message}`;
        continue;
      }
      const frozen = steps;
      const tw = withTrace(frozen, opts.trace);
      return { ok: true, steps: frozen, commit: tw.commit, discard: tw.discard };
    }
    return { ok: false, ...lastErr };
  }
  async function distributeAndRun(nl, opts) {
    const map = await fetchDomainMap();
    const ctx = planContextFromDomain(map);
    const systemPromptFor = (_id) => buildPlanSystemPrompt(nl, map);
    const dist = await distributePlans({
      mode: opts.mode,
      participants: opts.participants,
      facilitatorId: opts.facilitatorId,
      nameOf: opts.nameOf,
      planFor: opts.planFor,
      systemPromptFor
    });
    if (!dist.plans.length) {
      return { ok: false, code: "NO_PLAN", message: "\uC5B4\uB290 \uC5D0\uC774\uC804\uD2B8\uB3C4 \uC720\uD6A8\uD55C PLAN \uC744 \uB9CC\uB4E4\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." };
    }
    const validated = [];
    for (const p of dist.plans) {
      const v = validatePlan(p.steps, ctx);
      if (!v.ok) {
        return {
          ok: false,
          code: v.code,
          message: `${opts.nameOf(p.agentId)} \uC758 PLAN step #${v.index} \uAC70\uBD80: ${v.message}`
        };
      }
      validated.push(p);
    }
    const frozen = validated.map((p) => ({ agentId: p.agentId, steps: p.steps }));
    const sink = deps.trace;
    const meta = opts.trace;
    const dispatchAgent = async (p, copts) => {
      if (!sink || !meta) return dispatchPlan(p.steps, copts);
      const tr = await sink.begin({ nl: meta.nl, mode: meta.mode, agent: opts.nameOf(p.agentId) });
      const r = await dispatchPlan(p.steps, copts, tr);
      await tr.finish(r.yielded ? "yielded" : r.ok ? "committed" : "failed");
      return r;
    };
    const commit = async (copts) => {
      const perAgent = [];
      if (opts.mode === "simul") {
        const settled = await Promise.all(
          frozen.map(async (p) => ({ agentId: p.agentId, result: await dispatchAgent(p, copts) }))
        );
        perAgent.push(...settled);
      } else {
        for (const p of frozen) {
          if (copts?.shouldYield?.()) return { ok: true, yielded: true, perAgent };
          perAgent.push({ agentId: p.agentId, result: await dispatchAgent(p, copts) });
        }
      }
      const yielded = perAgent.some((a) => a.result.yielded);
      const ok = perAgent.every((a) => a.result.ok);
      return { ok, yielded, perAgent };
    };
    return { ok: true, mode: dist.mode, plans: frozen, commit };
  }
  async function dispatchTraced(steps, meta) {
    const sink = deps.trace;
    if (!sink || !meta) return { result: await dispatchPlan(steps), finish: async () => {
    } };
    const tr = await sink.begin(meta);
    const result = await dispatchPlan(steps, {}, tr);
    return { result, finish: (outcome) => tr.finish(outcome) };
  }
  async function reflectAndRun(nl, opts = {}) {
    const planner = opts.planner ?? deps.planner;
    if (!planner) {
      return { ok: false, outcome: "rejected", iterations: [] };
    }
    const maxReplans = Math.max(0, opts.maxReplans ?? 3);
    const maxSteps = Math.max(1, opts.maxSteps ?? 20);
    const iterations = [];
    let correction;
    let lastFailure;
    for (let attempt = 0; attempt <= maxReplans; attempt++) {
      const map = await fetchDomainMap();
      const prompt = buildPlanSystemPrompt(nl, map, correction);
      let raw;
      try {
        raw = await planner(prompt);
      } catch (e) {
        lastFailure = { code: "PLANNER_FAILED", message: String(e?.message ?? e) };
        iterations.push({ steps: [], rejected: true, rejectCode: "PLANNER_FAILED", verified: false, failure: lastFailure });
        correction = `\uD50C\uB798\uB108 \uD638\uCD9C \uC2E4\uD328: ${lastFailure.message}`;
        continue;
      }
      const steps = parsePlan(raw);
      if (!steps) {
        lastFailure = { code: "PLAN_PARSE_FAILED", message: "PLAN(JSON \uBC30\uC5F4)\uC744 \uD30C\uC2F1\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4." };
        iterations.push({ steps: [], rejected: true, rejectCode: "PLAN_PARSE_FAILED", verified: false, failure: lastFailure });
        correction = "\uC9C1\uC804 \uCD9C\uB825\uC5D0\uC11C JSON \uBC30\uC5F4 PLAN \uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC124\uBA85 \uC5C6\uC774 JSON \uBC30\uC5F4\uB9CC \uCD9C\uB825\uD558\uC138\uC694.";
        continue;
      }
      if (steps.length > maxSteps) {
        lastFailure = { code: "TOO_MANY_STEPS", message: `plan step ${steps.length} \uAC1C \u2014 \uD55C\uB3C4 ${maxSteps} \uCD08\uACFC` };
        iterations.push({ steps, rejected: true, rejectCode: "TOO_MANY_STEPS", verified: false, failure: lastFailure });
        correction = `\uC9C1\uC804 PLAN \uC758 step \uC774 ${steps.length} \uAC1C\uB85C \uD55C\uB3C4(${maxSteps} \uB2E8\uACC4)\uB97C \uCD08\uACFC\uD588\uC2B5\uB2C8\uB2E4. \uB354 \uC801\uC740 step \uC73C\uB85C \uAC19\uC740 \uBAA9\uD45C\uB97C \uB2EC\uC131\uD558\uC138\uC694.`;
        continue;
      }
      const v = validatePlan(steps, planContextFromDomain(map));
      if (!v.ok) {
        lastFailure = { code: v.code, message: v.message, step: steps[v.index] };
        iterations.push({ steps, rejected: true, rejectCode: v.code, verified: false, failure: lastFailure });
        correction = `step #${v.index} \uAC70\uBD80: ${v.message}. \uC704 \uB3C4\uBA54\uC778\uB9F5\uC5D0 \uC2E4\uC81C\uB85C \uC788\uB294 command/\uC8FC\uC18C\uB9CC \uC4F0\uC138\uC694.`;
        continue;
      }
      const meta = opts.trace ? { nl: opts.trace.nl, mode: opts.trace.mode, agent: opts.trace.agent } : void 0;
      const { result: commit, finish } = await dispatchTraced(steps, meta);
      const isLast = attempt >= maxReplans;
      if (!commit.ok) {
        const failedStep = commit.results?.find((s) => !s.result.ok);
        lastFailure = {
          code: commit.code ?? failedStep?.result.code,
          message: commit.message ?? failedStep?.result.message,
          step: failedStep?.step,
          result: failedStep?.result
        };
        await finish(isLast ? "escalated" : "failed");
        iterations.push({ steps, verified: false, failure: lastFailure });
        correction = buildFailureCorrection(lastFailure);
        continue;
      }
      if (opts.goalCheck) {
        const goalOut = await dispatchStep(opts.goalCheck);
        const reached = resolveGoalReached(goalOut, opts);
        if (!reached) {
          lastFailure = {
            code: "GOAL_NOT_REACHED",
            message: "\uB514\uC2A4\uD328\uCE58\uB294 \uC131\uACF5\uD588\uC73C\uB098 \uC0AC\uD6C4 status.query \uAC00 \uC758\uB3C4\uD55C \uC0C1\uD0DC \uBBF8\uB2EC\uC131\uC744 \uBCF4\uACE0\uD568",
            step: opts.goalCheck,
            result: goalOut
          };
          await finish(isLast ? "escalated" : "failed");
          iterations.push({ steps, verified: false, failure: lastFailure });
          correction = buildFailureCorrection(lastFailure);
          continue;
        }
      }
      await finish("committed");
      iterations.push({ steps, verified: true });
      return { ok: true, outcome: "succeeded", iterations };
    }
    return {
      ok: false,
      outcome: "escalated",
      iterations,
      escalation: { reason: ESCALATION_REASON, lastFailure }
    };
  }
  const api = { runExample, runCommand, runDom, runPlan, planAndRun, distributeAndRun, reflectAndRun };
  Object.defineProperty(api, SEALED, { value: sealedDispatch, enumerable: false });
  return api;
}

// src/tower/modal.ts
var TOWER_LIVE_TOPIC = "clubhouse.tower.live";
var EXAMPLES = EXAMPLE_COMMANDS.map((e) => e.text);
var STYLE_ID = "tower-modal-style";
var CSS = `
.tower-ov{position:fixed;left:50%;top:76px;transform:translateX(-50%);width:560px;max-width:calc(100vw - 32px);
  z-index:9001;background:var(--card,#262626);color:var(--fg,#e6e6e6);border:1px solid var(--bd,#3a3a3a);
  border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.3);
  font:13px system-ui,-apple-system,sans-serif;overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 110px)}
.tower-hd{display:flex;align-items:center;gap:8px;padding:11px 13px;border-bottom:1px solid var(--bd,#3a3a3a);
  cursor:grab;user-select:none;flex:0 0 auto}
.tower-hd.drag{cursor:grabbing}
.tower-mk{display:inline-flex;align-items:center;color:var(--acc,#7aa2f7)}
.tower-htxt{flex:1 1 auto;min-width:0}
.tower-tt{font-weight:700;letter-spacing:.01em;white-space:nowrap}
.tower-sub{font-size:10.5px;color:var(--fg3,#888);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tower-grip{opacity:.4;letter-spacing:2px;font-size:11px;cursor:grab;user-select:none}
.tower-x{appearance:none;border:0;background:transparent;color:inherit;opacity:.6;cursor:pointer;
  font-size:15px;line-height:1;padding:3px 6px;border-radius:6px}
.tower-x:hover{opacity:1;background:var(--inset,rgba(127,127,127,.14))}
/* \uBCF8\uBB38 = \uC88C(\uC785\uB825\xB7\uC608\uC2DC\xB7\uD314\uB808\uD2B8) | \uC6B0(\uB77C\uC774\uBE0C) 2\uC5F4 */
.tower-bd{display:flex;min-height:0;flex:1 1 auto}
.tower-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;padding:12px;gap:11px;overflow-y:auto}
.tower-side{flex:0 0 188px;border-left:1px solid var(--bd,#3a3a3a);display:flex;flex-direction:column;min-height:0}
/* NL \uC785\uB825\uBC14 */
.tower-inwrap{display:flex;align-items:center;gap:8px;border:1px solid var(--bd,#3a3a3a);border-radius:9px;
  background:var(--inset,rgba(127,127,127,.08));padding:8px 10px}
.tower-inwrap:focus-within{border-color:var(--acc,#7aa2f7)}
.tower-inmk{display:inline-flex;align-items:center;color:var(--acc,#7aa2f7);flex:0 0 auto}
.tower-in{flex:1 1 auto;min-width:0;background:transparent;border:0;outline:0;color:var(--fg,#e6e6e6);font:inherit}
.tower-in::placeholder{color:var(--fg3,#888)}
.tower-enter{flex:0 0 auto;font-size:11px;color:var(--fg3,#888);border:1px solid var(--bd,#3a3a3a);
  border-radius:5px;padding:0 5px;line-height:16px}
/* \uC139\uC158 \uB77C\uBCA8 */
.tower-sec{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--fg3,#888)}
/* \uC608\uC2DC\uD589 */
.tower-exs{display:flex;flex-direction:column;gap:5px}
.tower-ex{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;border:1px solid var(--bd,#3a3a3a);
  background:var(--inset,rgba(127,127,127,.06));cursor:pointer;text-align:left;color:inherit;font:inherit}
.tower-ex:hover{border-color:var(--acc,#7aa2f7);background:var(--accbg,rgba(122,162,247,.12))}
.tower-ex-mk{color:var(--acc,#7aa2f7);flex:0 0 auto;font-size:12px}
.tower-ex-tx{flex:1 1 auto;min-width:0}
.tower-ex-go{flex:0 0 auto;font-size:11px;color:var(--fg3,#888)}
/* dry-run plan \uBBF8\uB9AC\uBCF4\uAE30 \u2014 \uC608\uC2DC\uD589 \uB8E9 \uC7AC\uC0AC\uC6A9(\uC2E4\uD589 \uC804 plan step \uD45C\uC2DC, \u23CE \uB85C commit) */
.tower-plan{display:flex;flex-direction:column;gap:6px;border:1px solid var(--acc,#7aa2f7);border-radius:9px;
  padding:9px;background:var(--accbg,rgba(122,162,247,.08))}
.tower-plan-hd{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:700;letter-spacing:.04em;
  text-transform:uppercase;color:var(--acc,#7aa2f7)}
.tower-plan-hd .sp{flex:1 1 auto}
.tower-plan-steps{display:flex;flex-direction:column;gap:4px}
.tower-pstep{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:7px;border:1px solid var(--bd,#3a3a3a);
  background:var(--inset,rgba(127,127,127,.06))}
.tower-pstep-ax{flex:0 0 auto;font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;
  color:var(--fg3,#888);border:1px solid var(--bd,#3a3a3a);border-radius:5px;padding:0 5px;line-height:15px}
.tower-pstep-tx{flex:1 1 auto;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tower-pstep-dg{flex:0 0 auto;color:var(--danger-soft,#d77);font-size:11px}
.tower-pstep-go{flex:0 0 auto;font-size:11px;color:var(--fg3,#888)}
.tower-plan-act{display:flex;justify-content:flex-end;gap:7px;margin-top:2px}
.tower-plan-btn{appearance:none;border:1px solid var(--bd,#3a3a3a);background:transparent;color:inherit;font:inherit;
  font-size:11.5px;cursor:pointer;border-radius:7px;padding:4px 11px}
.tower-plan-btn:hover{background:var(--inset,rgba(127,127,127,.14))}
.tower-plan-btn.run{border-color:var(--acc,#7aa2f7);color:var(--acc,#7aa2f7);font-weight:600}
.tower-plan-btn.run:hover{background:var(--accbg,rgba(122,162,247,.18))}
.tower-plan-busy{font-size:11.5px;color:var(--fg3,#888);padding:4px 2px}
/* \uD314\uB808\uD2B8 */
.tower-pal{display:flex;flex-direction:column;gap:2px;max-height:208px;overflow-y:auto}
.tower-cmd{display:flex;align-items:center;gap:9px;padding:6px 9px;border-radius:7px;cursor:pointer;
  color:inherit;font:inherit;text-align:left;border:1px solid transparent}
.tower-cmd:hover{background:var(--accbg,rgba(122,162,247,.12));border-color:var(--acc,#7aa2f7)}
.tower-cmd-ic{flex:0 0 18px;text-align:center;color:var(--fg3,#888);font-size:12px}
.tower-cmd-tt{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tower-cmd-sc{flex:0 0 auto;font-size:10.5px;color:var(--fg3,#888);font-variant-numeric:tabular-nums;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.tower-cmd-dg{flex:0 0 auto;color:var(--danger-soft,#d77);font-size:11px}
.tower-empty{font-size:11.5px;color:var(--fg3,#888);padding:8px 9px}
/* \uB77C\uC774\uBE0C\uCE78 \u2014 Clubhouse st-bubble \uB8E9 \uC7AC\uC0AC\uC6A9 */
.tower-live-hd{padding:9px 11px;border-bottom:1px solid var(--bd,#3a3a3a);font-size:10.5px;font-weight:700;
  letter-spacing:.04em;text-transform:uppercase;color:var(--fg3,#888);flex:0 0 auto}
.tower-live{flex:1 1 auto;min-height:120px;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
.tower-live-empty{font-size:11px;color:var(--fg3,#888);line-height:1.45}
.tower-lrow{display:flex;flex-direction:column;gap:2px;max-width:100%}
.tower-lrow.user{align-items:flex-end}
.tower-lwho{font-size:10px;color:var(--fg3,#888);font-weight:600;padding:0 3px}
.tower-lbubble{padding:6px 9px;border-radius:9px;white-space:pre-wrap;word-break:break-word;line-height:1.42;
  font-size:12px;background:var(--inset,rgba(127,127,127,.14))}
.tower-lrow.user .tower-lbubble{background:var(--accbg,rgba(122,162,247,.18))}
/* danger-confirm \uAC8C\uC774\uD2B8 \u2014 \uCF54\uC5B4 ConfirmCloseModal \uD328\uD134 \uC7AC\uC0AC\uC6A9. \uBAA8\uB2EC \uC704 z-index \uB85C \uC0AC\uB78C-only \uD655\uC778. */
.tower-cfm-ov{position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,.42);
  display:flex;align-items:center;justify-content:center;font:13px system-ui,-apple-system,sans-serif}
.tower-cfm{width:360px;max-width:calc(100vw - 32px);background:var(--card,#262626);color:var(--fg,#e6e6e6);
  border:1px solid var(--bd,#3a3a3a);border-radius:11px;box-shadow:0 18px 50px rgba(0,0,0,.5);
  padding:16px 17px;display:flex;flex-direction:column;gap:11px}
.tower-cfm-tt{font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:7px}
.tower-cfm-dg{color:var(--danger-soft,#e08;);font-size:14px}
.tower-cfm-msg{font-size:12px;color:var(--fg3,#aaa);line-height:1.5}
.tower-cfm-cmd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
  background:var(--inset,rgba(127,127,127,.14));border-radius:6px;padding:6px 8px;word-break:break-all}
.tower-cfm-act{display:flex;justify-content:flex-end;gap:8px;margin-top:3px}
.tower-cfm-btn{appearance:none;border:1px solid var(--bd,#3a3a3a);background:transparent;color:inherit;
  font:inherit;cursor:pointer;border-radius:7px;padding:6px 13px}
.tower-cfm-btn:hover{background:var(--inset,rgba(127,127,127,.14))}
.tower-cfm-btn.danger{border-color:var(--danger-soft,#d77);color:var(--danger-soft,#e66);font-weight:600}
.tower-cfm-btn.danger:hover{background:var(--danger-bg,rgba(220,90,90,.16))}
`;
var ICON_BY_PREFIX = {
  terminal: ">_",
  panel: "\u25A4",
  view: "\u25A4",
  content: "\u25A4",
  window: "\u2751",
  file: "\u25A4",
  fs: "\u25A4",
  browser: "\u{1F310}",
  bookmark: "\u2605",
  theme: "\u25D0",
  settings: "\u2699",
  plugin: "\u2B21",
  state: "\u2261",
  status: "\u25F7",
  ui: "\u22B9",
  project: "\u25A2",
  clipboard: "\u2398",
  search: "\u2315"
};
function cmdIcon(name) {
  const pre = name.split(".")[0];
  return ICON_BY_PREFIX[pre] ?? "\xB7";
}
function cmdDanger(name) {
  return /\.(close|remove|delete|kill|clear|reset|disable|quit|destroy)\b/.test(name);
}
function cmdTitle(name, description) {
  const base = (description || "").split(" | ")[0].trim();
  return base || name;
}
var ICON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" /></svg>';
var ICON_SM = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" /></svg>';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
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
function makeDraggable(ov, handle) {
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    const r = ov.getBoundingClientRect();
    let nx = ox + (e.clientX - sx);
    let ny = oy + (e.clientY - sy);
    nx = Math.max(8, Math.min(nx, window.innerWidth - r.width - 8));
    ny = Math.max(8, Math.min(ny, window.innerHeight - r.height - 8));
    ov.style.left = `${nx}px`;
    ov.style.top = `${ny}px`;
    ov.style.transform = "none";
  };
  const onUp = () => {
    dragging = false;
    handle.classList.remove("drag");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  const onDown = (e) => {
    const target = e.target;
    if (target.closest(".tower-x") || target.closest(".tower-in") || target.closest(".tower-ex") || target.closest(".tower-cmd")) {
      return;
    }
    const r = ov.getBoundingClientRect();
    ov.style.left = `${r.left}px`;
    ov.style.top = `${r.top}px`;
    ov.style.transform = "none";
    sx = e.clientX;
    sy = e.clientY;
    ox = r.left;
    oy = r.top;
    dragging = true;
    handle.classList.add("drag");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  handle.addEventListener("pointerdown", onDown);
  return () => handle.removeEventListener("pointerdown", onDown);
}
function createTowerModal(deps) {
  const { app, lang, onChange } = deps;
  ensureStyle();
  let ov = null;
  let undrag = null;
  let subs = [];
  let palWrap = null;
  let liveBox = null;
  let nlInput = null;
  let planBox = null;
  let planning = false;
  let catalog = [];
  let liveActive = null;
  const tr = (key) => t(key, lang());
  let confirmOv = null;
  const confirmGate = (issue, info) => new Promise((resolve) => {
    if (confirmOv) return resolve(null);
    let done = false;
    const finish = (token) => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey, true);
      confirmOv?.remove();
      confirmOv = null;
      resolve(token);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(null);
      }
    };
    const ov2 = el("div", "tower-cfm-ov");
    ov2.dataset.node = CONFIRM_EXPOSED_NODES[0];
    ov2.addEventListener("pointerdown", (e) => {
      if (e.target === ov2) finish(null);
    });
    const card = el("div", "tower-cfm");
    card.addEventListener("pointerdown", (e) => e.stopPropagation());
    const tt = el("div", "tower-cfm-tt");
    tt.append(elText("span", "\u26A0", "tower-cfm-dg"), elText("span", tr("towerConfirmTitle"), ""));
    const msg = elText(
      "div",
      tr(info.danger === "destructive" ? "towerConfirmDestructive" : "towerConfirmInject"),
      "tower-cfm-msg"
    );
    const cmd = elText("div", info.command, "tower-cfm-cmd");
    const act = el("div", "tower-cfm-act");
    const cancel = el("button", "tower-cfm-btn");
    cancel.type = "button";
    cancel.textContent = tr("towerConfirmCancel");
    cancel.dataset.node = CONFIRM_EXPOSED_NODES[1];
    cancel.addEventListener("click", () => finish(null));
    const ok = el("button", "tower-cfm-btn danger");
    ok.type = "button";
    ok.textContent = tr("towerConfirmRun");
    ok.addEventListener("click", () => finish(issue()));
    act.append(cancel, ok);
    card.append(tt, msg, cmd, act);
    ov2.append(card);
    document.body.appendChild(ov2);
    confirmOv = ov2;
    window.addEventListener("keydown", onKey, true);
    ok.focus();
  });
  const executor = createExecutor({ app, confirmGate, lang, planner: deps.planner, trace: deps.trace });
  function reportOutcome(label, r) {
    let key = "towerRunOk";
    if (!r.ok) key = r.code === "NEEDS_TARGET" ? "towerRunNeedsTarget" : r.code === "CONFIRM_DENIED" ? "towerRunDenied" : "towerRunFailed";
    onLive({ kind: "user", who: "\u2726", text: label });
    onLive({ kind: "start", who: "\u2726" });
    onLive({ kind: "end", text: tr(key) });
  }
  const emit = () => {
    try {
      onChange?.();
    } catch {
    }
  };
  async function fetchCatalog() {
    try {
      const r = await app.commands.execute("state.commands", {});
      const cmds = Array.isArray(r?.commands) ? r.commands : [];
      catalog = cmds.filter((c) => c && typeof c.name === "string").map((c) => ({ name: c.name, description: String(c.description ?? "") }));
    } catch {
      catalog = [];
    }
    renderPalette();
  }
  function renderPalette() {
    const wrap = palWrap;
    if (!wrap) return;
    const q = (nlInput?.value ?? "").trim().toLowerCase();
    const rows = catalog.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    );
    wrap.replaceChildren();
    if (!rows.length) {
      wrap.appendChild(elText("div", tr("towerPaletteEmpty"), "tower-empty"));
      return;
    }
    for (const c of rows) {
      const row = el("button", "tower-cmd");
      row.type = "button";
      row.dataset.node = `tower/cmd/${c.name}`;
      row.append(elText("span", cmdIcon(c.name), "tower-cmd-ic"));
      const tt = elText("span", cmdTitle(c.name, c.description), "tower-cmd-tt");
      tt.title = c.name;
      row.append(tt);
      if (cmdDanger(c.name)) row.append(elText("span", "\u26A0", "tower-cmd-dg"));
      row.append(elText("span", c.name, "tower-cmd-sc"));
      row.addEventListener("click", () => {
        void executor.runCommand(c.name).then((r) => reportOutcome(c.name, r));
      });
      wrap.appendChild(row);
    }
  }
  async function submitNL() {
    const raw = (nlInput?.value ?? "").trim();
    if (!raw || planning) return;
    const exIdx = EXAMPLE_COMMANDS.findIndex((e) => e.text === raw);
    if (exIdx >= 0) {
      if (nlInput) nlInput.value = "";
      clearPlanPreview();
      renderPalette();
      void executor.runExample(exIdx).then((r) => reportOutcome(`"${raw}"`, r));
      return;
    }
    const cmd = catalog.find((c) => c.name === raw);
    if (cmd) {
      if (nlInput) nlInput.value = "";
      clearPlanPreview();
      renderPalette();
      void executor.runCommand(cmd.name).then((r) => reportOutcome(cmd.name, r));
      return;
    }
    await runSlowPath(raw);
  }
  async function runSlowPath(raw, opts) {
    planning = true;
    renderPlanBusy(tr("towerPlanning"));
    onLive({ kind: "user", who: "\u2726", text: raw });
    let res;
    try {
      res = await executor.planAndRun(raw, opts);
    } catch (e) {
      res = { ok: false, code: "PLAN_EXCEPTION", message: String(e?.message ?? e) };
    }
    planning = false;
    if (!res.ok) {
      const key = res.code === "NO_PLANNER" ? "towerPlanNoAgent" : "towerPlanFailed";
      renderPlanBusy(tr(key), true);
      onLive({ kind: "start", who: "\u2726" });
      onLive({ kind: "end", text: tr(key) });
      return res;
    }
    renderPlanPreview(raw, res.steps, res.commit);
    return res;
  }
  function renderPlanBusy(msg, _error = false) {
    const box = planBox;
    if (!box) return;
    box.replaceChildren(elText("div", msg, "tower-plan-busy"));
    box.dataset.node = "tower/plan";
  }
  function clearPlanPreview() {
    if (planBox) planBox.replaceChildren();
  }
  function renderPlanPreview(nl, steps, commit) {
    const box = planBox;
    if (!box) return;
    box.replaceChildren();
    const wrap = el("div", "tower-plan");
    const hd = el("div", "tower-plan-hd");
    hd.append(elText("span", "\u2726", ""), elText("span", tr("towerPlanTitle"), ""), el("span", "sp"));
    wrap.appendChild(hd);
    const stepsBox = el("div", "tower-plan-steps");
    steps.forEach((s, i) => {
      const row = el("div", "tower-pstep");
      row.dataset.node = `tower/plan/step/${i}`;
      row.append(elText("span", s.axis, "tower-pstep-ax"));
      const label = s.axis === "dom" ? `${s.name} ${s.address ?? ""}`.trim() : stepLabel(s);
      const tx = elText("span", label, "tower-pstep-tx");
      tx.title = label;
      row.append(tx);
      if (s.axis !== "dom" && cmdDanger(s.name)) row.append(elText("span", "\u26A0", "tower-pstep-dg"));
      row.append(elText("span", "\u23CE", "tower-pstep-go"));
      stepsBox.appendChild(row);
    });
    wrap.appendChild(stepsBox);
    const act = el("div", "tower-plan-act");
    const discard = el("button", "tower-plan-btn");
    discard.type = "button";
    discard.textContent = tr("towerPlanDiscard");
    discard.dataset.node = "tower/plan/discard";
    discard.addEventListener("click", () => clearPlanPreview());
    const run = el("button", "tower-plan-btn run");
    run.type = "button";
    run.textContent = `${tr("towerPlanRunAll")} \u23CE`;
    run.dataset.node = "tower/plan/run";
    let committing = false;
    const doCommit = () => {
      if (committing) return;
      committing = true;
      run.disabled = true;
      void commit().then((r) => {
        clearPlanPreview();
        if (nlInput) nlInput.value = "";
        renderPalette();
        reportOutcome(`"${nl}"`, r.ok ? { ok: true } : r);
      });
    };
    run.addEventListener("click", doCommit);
    act.append(discard, run);
    wrap.appendChild(act);
    box.appendChild(wrap);
    box.dataset.node = "tower/plan";
    run.focus();
  }
  function stepLabel(s) {
    const p = s.params && Object.keys(s.params).length ? ` ${JSON.stringify(s.params)}` : "";
    return `${s.name}${p}`;
  }
  function clearLive() {
    if (!liveBox) return;
    liveBox.replaceChildren(elText("div", tr("towerLiveEmpty"), "tower-live-empty"));
    liveActive = null;
  }
  function liveScroll() {
    if (liveBox) liveBox.scrollTop = liveBox.scrollHeight;
  }
  function onLive(ev) {
    const box = liveBox;
    if (!box) return;
    if (ev.kind === "reset") return clearLive();
    box.querySelector(".tower-live-empty")?.remove();
    if (ev.kind === "user") {
      const row = el("div", "tower-lrow user");
      row.append(elText("div", ev.who ?? "\uB098", "tower-lwho"), elText("div", ev.text ?? "", "tower-lbubble"));
      box.appendChild(row);
      liveActive = null;
      return liveScroll();
    }
    if (ev.kind === "start") {
      const row = el("div", "tower-lrow assistant");
      const who = elText("div", ev.who ?? "", "tower-lwho");
      if (ev.color) who.style.color = ev.color;
      const bubble = el("div", "tower-lbubble");
      row.append(who, bubble);
      box.appendChild(row);
      liveActive = { who: ev.who, color: ev.color, text: bubble };
      return liveScroll();
    }
    if (ev.kind === "delta") {
      if (!liveActive) onLive({ kind: "start", who: ev.who, color: ev.color });
      if (liveActive) liveActive.text.textContent = (liveActive.text.textContent || "") + (ev.text ?? "");
      return liveScroll();
    }
    if (ev.kind === "end") {
      if (liveActive && ev.text) liveActive.text.textContent = ev.text;
      liveActive = null;
      return liveScroll();
    }
  }
  function buildBody(body) {
    const main = el("div", "tower-main");
    const inwrap = el("div", "tower-inwrap");
    const inmk = el("span", "tower-inmk");
    inmk.innerHTML = ICON_SM;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tower-in";
    input.placeholder = tr("towerInputPlaceholder");
    input.dataset.node = "tower/input";
    input.addEventListener("input", () => renderPalette());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        void submitNL();
      }
    });
    nlInput = input;
    inwrap.append(inmk, input, elText("span", "\u23CE", "tower-enter"));
    main.appendChild(inwrap);
    const plan = el("div", "");
    plan.dataset.node = "tower/plan";
    planBox = plan;
    main.appendChild(plan);
    main.appendChild(elText("div", tr("towerExamplesTitle"), "tower-sec"));
    const exs = el("div", "tower-exs");
    EXAMPLES.forEach((text, i) => {
      const ex = el("button", "tower-ex");
      ex.type = "button";
      ex.dataset.node = `tower/example/${i}`;
      ex.append(elText("span", "\u2726", "tower-ex-mk"));
      ex.append(elText("span", `"${text}"`, "tower-ex-tx"));
      ex.append(elText("span", "\u23CE", "tower-ex-go"));
      ex.addEventListener("click", () => {
        void executor.runExample(i).then((r) => reportOutcome(`"${text}"`, r));
      });
      exs.appendChild(ex);
    });
    main.appendChild(exs);
    main.appendChild(elText("div", tr("towerPaletteTitle"), "tower-sec"));
    const pal = el("div", "tower-pal");
    palWrap = pal;
    pal.appendChild(elText("div", tr("towerPaletteEmpty"), "tower-empty"));
    main.appendChild(pal);
    const side = el("div", "tower-side");
    side.append(elText("div", tr("towerLiveTitle"), "tower-live-hd"));
    const live = el("div", "tower-live");
    live.dataset.node = "tower/live";
    liveBox = live;
    side.appendChild(live);
    clearLive();
    body.append(main, side);
  }
  const build = () => {
    const root = el("div", "tower-ov");
    root.dataset.node = "tower/modal";
    const hd = el("div", "tower-hd");
    const mk = el("span", "tower-mk");
    mk.innerHTML = ICON;
    const htxt = el("div", "tower-htxt");
    htxt.append(elText("div", deps.title, "tower-tt"), elText("div", tr("towerSubtitle"), "tower-sub"));
    const grip = elText("span", "\u283F", "tower-grip");
    grip.dataset.node = "tower/grip";
    const x = el("button", "tower-x");
    x.type = "button";
    x.textContent = "\u2715";
    x.title = "\uB2EB\uAE30";
    x.dataset.node = "tower/close";
    x.addEventListener("click", () => api.close());
    hd.append(mk, htxt, grip, x);
    const bd = el("div", "tower-bd");
    bd.dataset.node = "tower/body";
    buildBody(bd);
    root.append(hd, bd);
    undrag = makeDraggable(root, hd);
    return root;
  };
  const api = {
    isOpen: () => ov != null,
    // 헤드리스 slow-path — executor 단일 실행점 직통(모달 open 비의존). dry-run 반환(실행 0), commit() 별도.
    planAndRun: (nl, opts) => executor.planAndRun(nl, opts),
    // 다중 에이전트 분배(M6) — executor.distributeAndRun 직통. 모드별 planFor 는 main.ts 가 주입.
    distributeAndRun: (nl, opts) => executor.distributeAndRun(nl, opts),
    // reflection 루프(M8) — executor.reflectAndRun 직통(모달 open 비의존, executor 상주). danger 게이트 매 step.
    reflectAndRun: (nl, opts) => executor.reflectAndRun(nl, opts),
    // 결정적 시각 E2E — 모달을 열고 KNOWN plan 을 dry-run preview 로 렌더(라이브 LLM 우회). 실행 0.
    previewInject: async (nl, steps) => {
      if (!ov) api.open();
      return runSlowPath(nl, { injectPlan: steps });
    },
    open: () => {
      if (ov) return;
      ov = build();
      document.body.appendChild(ov);
      subs.push(app.bus.on(TOWER_LIVE_TOPIC, (p) => onLive(p)));
      subs.push(app.events.on("theme.changed", () => fetchCatalog()));
      subs.push(app.events.on("locale.changed", () => fetchCatalog()));
      void fetchCatalog();
      emit();
    },
    close: () => {
      if (!ov) return;
      for (const off of subs) {
        try {
          off.dispose();
        } catch {
        }
      }
      subs = [];
      undrag?.();
      undrag = null;
      confirmOv?.remove();
      confirmOv = null;
      ov.remove();
      ov = null;
      palWrap = liveBox = planBox = null;
      nlInput = null;
      planning = false;
      catalog = [];
      liveActive = null;
      emit();
    },
    toggle: () => ov ? api.close() : api.open(),
    // dispose — 액션 해지 중 호출되므로 onChange 재렌더를 일으키지 않는다(누수 방지).
    dispose: () => {
      for (const off of subs) {
        try {
          off.dispose();
        } catch {
        }
      }
      subs = [];
      undrag?.();
      undrag = null;
      confirmOv?.remove();
      confirmOv = null;
      ov?.remove();
      ov = null;
      palWrap = liveBox = planBox = null;
      nlInput = null;
      planning = false;
    }
  };
  return api;
}

// src/tower/header.ts
var SPARKLE_ICON = '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />';
function setupTower(app, label, lang, planner, trace) {
  const modal = createTowerModal({ title: label, lang, app, planner, trace, onChange: () => render() });
  let unregister = null;
  const render = () => {
    unregister = app.ui.registerHeaderAction({
      id: "tower",
      label,
      // 아이콘 폴백
      icon: SPARKLE_ICON,
      title: label,
      active: modal.isOpen(),
      onClick: () => modal.toggle()
      // active 갱신은 onChange → render 가 담당
    });
  };
  render();
  return {
    planAndRun: (nl, opts) => modal.planAndRun(nl, opts),
    distributeAndRun: (nl, opts) => modal.distributeAndRun(nl, opts),
    reflectAndRun: (nl, opts) => modal.reflectAndRun(nl, opts),
    previewInject: (nl, steps) => modal.previewInject(nl, steps),
    dispose: () => {
      unregister?.();
      modal.dispose();
    }
  };
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
function clubhouseBase(speaker, others, place, nameOf2) {
  const room = others.length ? `\uB3D9\uB8CC ${others.join(", ")} \uC640(\uACFC) \uB2F9\uC2E0(${nameOf2(speaker)})\uC774 \uD568\uAED8 \uC788\uC2B5\uB2C8\uB2E4.` : `\uC9C0\uAE08\uC740 \uB2F9\uC2E0(${nameOf2(speaker)}) \uD63C\uC790\uC785\uB2C8\uB2E4.`;
  const at = `@${others[0] ?? "\uB3D9\uB8CC"}`;
  return `\uC5EC\uAE30\uB294 'Clubhouse' \u2014 \uC5EC\uB7EC AI \uCF54\uB529 \uC5D0\uC774\uC804\uD2B8\uAC00 \uD55C \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4\uC5D0\uC11C \uC0AC\uC6A9\uC790\uC758 \uC77C\uC744 \uD568\uAED8 \uD558\uB294 \uD611\uC5C5 \uCC44\uD305\uBC29\uC785\uB2C8\uB2E4. ${room}${place}
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
  return clubhouseBase(speaker, others, place, nameOf2) + note;
}
function facilitatorPreamble(facilitator, roster, nameOf2, cwd) {
  const others = roster.filter((id) => id !== facilitator).map(nameOf2);
  const place = cwd ? ` \uC791\uC5C5 \uB514\uB809\uD130\uB9AC\uB294 ${cwd} \uC785\uB2C8\uB2E4.` : "";
  const ex = others[0] ?? "\uB3D9\uB8CC";
  return clubhouseBase(facilitator, others, place, nameOf2) + `
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
var CSS2 = `
.st{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg,#1e1e1e);color:var(--fg,#ddd);font:13px system-ui,-apple-system,sans-serif;overflow:hidden}
.st-bar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid rgba(127,127,127,.2);flex:0 0 auto;flex-wrap:nowrap;min-width:0}
.st-bar b{font-weight:700;letter-spacing:.02em;flex:0 0 auto;white-space:nowrap}
.st-tabs{display:flex;align-items:center;gap:5px;flex-wrap:nowrap;flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}
.st-tabs::-webkit-scrollbar{display:none}
.st-tab{flex:0 0 auto}
.st-tab{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:8px;border:1px solid rgba(127,127,127,.28);background:rgba(127,127,127,.08);cursor:grab;font-size:12px;user-select:none;touch-action:none;transition:opacity .12s,border-color .12s}
.st-tab.off{opacity:.4}
.st-tab.drag{cursor:grabbing;opacity:.95;border-color:currentColor;box-shadow:0 3px 10px rgba(0,0,0,.35);transform:scale(1.06);position:relative;z-index:3}
.st-tab .chk{width:13px;height:13px;border-radius:4px;border:1.5px solid currentColor;display:inline-flex;align-items:center;justify-content:center;font-size:10px;line-height:1}
.st-tab .nm{font-weight:600}
.st-crown{cursor:pointer;font-size:10px;opacity:.3;user-select:none;filter:grayscale(1)}
.st-crown:hover{opacity:.7}
.st-crown.on{opacity:1;filter:none}
.st-kib{margin-left:4px;display:inline-flex;border-radius:8px;overflow:hidden;border:1px solid rgba(127,127,127,.28);flex:0 0 auto}
.st-kib button{appearance:none;border:0;background:transparent;color:inherit;opacity:.6;font:inherit;font-size:11px;padding:3px 9px;cursor:pointer}
.st-kib button.on{opacity:1;background:rgba(127,127,127,.2);font-weight:700}
.st-status{margin-left:auto;font-size:11px;color:var(--fg3,#888);flex:0 0 auto;white-space:nowrap}
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
.st-mention{position:absolute;left:10px;bottom:calc(100% + 4px);min-width:160px;background:var(--card,#262626);border:1px solid rgba(127,127,127,.35);border-radius:8px;padding:4px;box-shadow:0 6px 20px rgba(0,0,0,.4);z-index:20}
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
.st-modal-box{background:var(--card,#262626);border:1px solid rgba(127,127,127,.4);border-radius:12px;padding:16px 18px;max-width:300px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
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
    const liveEmit = (ev) => app.bus.emit(TOWER_LIVE_TOPIC, ev);
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
    let activeClubhouse = null;
    const towerPlanner = async (systemPrompt) => {
      const st = activeClubhouse;
      const agent = st && (participants(st.roster).includes(st.facilitatorId) ? st.facilitatorId : participants(st.roster)[0]) || "claude";
      const cwd = st?.cwd ?? projectCwd();
      return engine.requestPlan({ agent }, systemPrompt, cwd);
    };
    const towerPlanFor = async (agentId, systemPrompt, priorContext) => {
      const st = activeClubhouse;
      const cwd = st?.cwd ?? projectCwd();
      const prompt = priorContext ? `${systemPrompt}

[\uC55E \uC5D0\uC774\uC804\uD2B8\uB4E4\uC758 PLAN(\uC758\uC874 \uB9E5\uB77D)]
${priorContext}` : systemPrompt;
      return engine.requestPlan({ agent: agentId }, prompt, cwd);
    };
    const traceSessionId = () => app.project?.current?.()?.root || "default";
    const trace = app.data ? createTrace(app.data, { sessionId: traceSessionId() }) : void 0;
    const tower = setupTower(app, t("towerTitle", lang), () => lang, towerPlanner, trace);
    ctx.subscriptions.push({ dispose: () => tower.dispose() });
    const distOptions = () => {
      const st = activeClubhouse;
      if (!st) return null;
      const parts = participants(st.roster);
      if (!parts.length) return null;
      const facilitatorId = parts.includes(st.facilitatorId) ? st.facilitatorId : parts[0];
      return { mode: st.mode, participants: parts, facilitatorId, nameOf, planFor: towerPlanFor };
    };
    ctx.subscriptions.push(
      app.commands.register("send", {
        description: "Inject a human message into the active Clubhouse view, equivalent to typing and submitting via the textarea. Use to drive or interject a multi-agent conversation programmatically (E2E, automation, AI control).",
        triggers: { ko: "\uC2A4\uD29C\uB514\uC624 \uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uB300\uD654 \uC8FC\uC785 \uCC38\uACAC" },
        params: {
          text: { type: "string", required: true, description: "Message text to send." },
          mode: { type: "string", description: "turn|facil|simul \u2014 set conversation mode before sending. Omit to keep current mode." },
          cut: { type: "boolean", description: "true = immediately interrupt the current agent turn without the ask/wait dialog (deterministic for E2E)." }
        },
        handler: async (p) => {
          const text = String(p?.text ?? "").trim();
          if (!text) return { ok: false, error: "text \uD544\uC218" };
          if (!activeClubhouse) return { ok: false, error: "\uD65C\uC131 Clubhouse \uBDF0 \uC5C6\uC74C(\uBDF0\uB97C \uBA3C\uC800 \uC5EC\uC138\uC694)" };
          if (p?.mode === "turn" || p?.mode === "facil" || p?.mode === "simul") {
            setMode(activeClubhouse, p.mode);
          }
          onHuman(activeClubhouse, text, p?.cut === true);
          return { ok: true, sent: text, mode: activeClubhouse.mode, running: activeClubhouse.running };
        }
      })
    );
    ctx.subscriptions.push(
      app.commands.register("state", {
        description: "Return the live state of the active Clubhouse view: conversation mode, running flag, utterance count, roster check states, and streaming length of in-progress agent turns. Use to observe the clubhouse from E2E tests or AI automation.",
        triggers: { ko: "\uC2A4\uD29C\uB514\uC624 \uC0C1\uD0DC \uB300\uD654 \uC9C4\uD589 \uD655\uC778 \uBAA8\uB4DC \uB85C\uC2A4\uD130" },
        params: {},
        handler: async () => {
          const st = activeClubhouse;
          if (!st) return { ok: false, error: "\uD65C\uC131 Clubhouse \uBDF0 \uC5C6\uC74C" };
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
      app.commands.register("tower.plan", {
        description: "Drive the control-tower slow-path headlessly: turn an ambiguous natural-language request into a validated 3-axis plan (command/dom/status) via a planning turn with the live domain map injected, then return a dry-run preview (no execution). Pass commit:true to dispatch the validated plan (safe steps run; destructive steps still require the desktop confirm gate). Use for utterance E2E and AI automation of the tower.",
        triggers: { ko: "\uD0C0\uC6CC \uACC4\uD68D \uC790\uC5F0\uC5B4 \uBA85\uB839 \uBCC0\uD658 plan \uC2AC\uB85C\uC6B0\uD328\uC2A4 dry-run \uCEE8\uD2B8\uB864\uD0C0\uC6CC" },
        params: {
          text: { type: "string", required: true, description: 'Natural-language request (e.g. "close the left panel and show the terminal big").' },
          commit: { type: "boolean", description: "true = dispatch the validated plan after planning (destructive steps still gated). Omit/false = dry-run only (return steps, execute nothing)." },
          plan: {
            type: "array",
            description: "Deterministic E2E injection: a KNOWN plan (array of {axis, name, params|address}) to validate and dry-run instead of calling the live planning agent. Still validated (unknown command/address rejected) and still danger-gated on commit \u2014 no security bypass."
          },
          render: {
            type: "boolean",
            description: "true = render the dry-run preview in the tower modal UI (opens it if closed) for visual snapshot verification. Requires plan injection."
          },
          distribute: {
            type: "boolean",
            description: "true = multi-agent distribution (M6): the active conversation mode decides how the plan is split \u2014 facil (the facilitator splits across domain peers via @mention), turn (sequential dependent-step chain, one round-robin), simul (each checked agent proposes an independent plan in parallel). Destructive confirms are serialized FIFO (one open at a time). Requires an active Clubhouse view with checked agents."
          }
        },
        handler: async (p) => {
          const text = String(p?.text ?? "").trim();
          if (!text) return { ok: false, error: "text \uD544\uC218" };
          const inject = Array.isArray(p?.plan) ? p.plan : void 0;
          if (p?.render === true && inject) {
            const r = await tower.previewInject(text, inject);
            if (!r.ok) return { ok: false, code: r.code, message: r.message };
            return { ok: true, dryRun: true, rendered: true, steps: r.steps };
          }
          const shouldYield = () => (activeClubhouse?.pendingHuman.length ?? 0) > 0;
          if (p?.distribute === true) {
            const opts = distOptions();
            if (!opts) return { ok: false, error: "\uD65C\uC131 Clubhouse \uBDF0/\uCC38\uC5EC\uC790 \uC5C6\uC74C(\uBD84\uBC30\uB294 \uB77C\uC774\uBE0C \uBAA8\uB4DC\xB7\uB85C\uC2A4\uD130 \uD544\uC694)" };
            const res2 = await tower.distributeAndRun(text, { ...opts, trace: { nl: text, mode: opts.mode } });
            if (!res2.ok) return { ok: false, code: res2.code, message: res2.message };
            if (p?.commit !== true) return { ok: true, dryRun: true, mode: res2.mode, plans: res2.plans };
            const c2 = await res2.commit({ shouldYield });
            return { ok: c2.ok, committed: true, mode: res2.mode, plans: res2.plans, yielded: c2.yielded, perAgent: c2.perAgent };
          }
          const traceMeta = { nl: text, mode: activeClubhouse?.mode ?? "solo" };
          const res = await tower.planAndRun(text, inject ? { injectPlan: inject, trace: traceMeta } : { trace: traceMeta });
          if (!res.ok) return { ok: false, code: res.code, message: res.message };
          const steps = res.steps;
          if (p?.commit !== true) return { ok: true, dryRun: true, steps };
          const c = await res.commit({ shouldYield });
          return { ok: c.ok, committed: true, code: c.code, steps, results: c.results, yielded: c.yielded };
        }
      })
    );
    ctx.subscriptions.push(
      app.commands.register("tower.reflect", {
        description: "Drive the control-tower post-execution reflection loop (M8): plan -> dispatch (each step still danger-gated) -> verify the outcome (a step that failed at runtime, or a goal-verify status.query showing the intended state was not reached) -> feed the failure back into a re-plan turn -> dispatch the corrected plan. Bounded by maxSteps (reject an over-large plan) and maxReplans (cap re-plan iterations); on cap-exceeded it ESCALATES to the human instead of looping forever, surfacing the last failure. Each iteration and the escalation are persisted to the session trace (tower.trace). Pass a scripted plans sequence for deterministic E2E (still validated and danger-gated \u2014 no security bypass).",
        triggers: { ko: "\uD0C0\uC6CC reflection \uC7AC\uACC4\uD68D \uAC80\uC99D \uB8E8\uD504 \uC790\uC728 escalate \uAC00\uB4DC \uCEE8\uD2B8\uB864\uD0C0\uC6CC" },
        params: {
          text: { type: "string", required: true, description: "Natural-language request to plan, dispatch, verify, and re-plan on failure." },
          plans: {
            type: "array",
            description: "Deterministic E2E injection: an ordered array of KNOWN plans (each a step array of {axis,name,params|address}). The reflection loop consumes them in order as if a planner returned them \u2014 exercising dispatch, verify, re-plan, escalation, and trace without a live LLM. Each plan is still validated (unknown command/address rejected) and danger-gated on every step."
          },
          goalCheck: {
            type: "object",
            description: "Optional post-execution goal-verify step (a status.query step {axis:'status',name:'status.query',params}). After a plan dispatches ok, this is queried and its result decides whether the intended state was reached. Use with failGoalCodes."
          },
          failGoalCodes: {
            type: "array",
            description: 'Status codes that mean the goal was NOT reached: if any goalCheck status carries one of these codes, the loop treats the plan as a goal-verify failure and re-plans. Declarative goal-verify for headless E2E (e.g. ["dirty","busy"]).'
          },
          maxReplans: { type: "number", description: "Cap on re-plan iterations (default 3). On cap-exceeded the loop escalates to the human instead of looping forever." },
          maxSteps: { type: "number", description: "Max steps per plan (default 20). A plan exceeding this is rejected (not dispatched) and the loop re-plans with a smaller-plan correction (step-inflation guard)." }
        },
        handler: async (p) => {
          const text = String(p?.text ?? "").trim();
          if (!text) return { ok: false, error: "text \uD544\uC218" };
          let plannerInject;
          if (Array.isArray(p?.plans)) {
            const scripted = p.plans;
            let i = 0;
            plannerInject = async () => {
              const cur = scripted[Math.min(i++, scripted.length - 1)];
              return JSON.stringify(Array.isArray(cur) ? cur : []);
            };
          }
          const goalCheck = p?.goalCheck && typeof p.goalCheck === "object" ? p.goalCheck : void 0;
          const failGoalCodes = Array.isArray(p?.failGoalCodes) ? p.failGoalCodes : void 0;
          const maxReplans = Number.isFinite(p?.maxReplans) ? Math.max(0, Number(p.maxReplans)) : void 0;
          const maxSteps = Number.isFinite(p?.maxSteps) ? Math.max(1, Number(p.maxSteps)) : void 0;
          const traceMeta = { nl: text, mode: activeClubhouse?.mode ?? "reflect" };
          const res = await tower.reflectAndRun(text, {
            planner: plannerInject,
            goalCheck,
            failGoalCodes,
            maxReplans,
            maxSteps,
            trace: traceMeta
          });
          return {
            ok: res.ok,
            outcome: res.outcome,
            iterations: res.iterations,
            escalation: res.escalation
          };
        }
      })
    );
    ctx.subscriptions.push(
      app.commands.register("tower.trace", {
        description: "Query the control-tower session trace persisted via the host generic data store (app.data): recent plans (id, nl, mode, agent, createdAt, outcome) in most-recent-first order, and, when a planId is given, that plan's steps (axis, name, params/address, danger, status, outcome, ts) in execution order. Read-only observability of what the tower ran \u2014 survives reload. Use for audit, utterance-E2E verification, and AI automation.",
        triggers: { ko: "\uD0C0\uC6CC trace \uC774\uB825 \uC138\uC158 plan step \uACB0\uACFC \uAC10\uC0AC \uC870\uD68C \uCEE8\uD2B8\uB864\uD0C0\uC6CC" },
        params: {
          plan: { type: "string", description: "A planId from a recent plan: return that plan's steps in execution order instead of the plan list." },
          limit: { type: "number", description: "Max number of recent plans to return (default 20). Ignored when plan is given." }
        },
        handler: async (p) => {
          if (!trace) return { ok: false, code: "DATA_UNAVAILABLE", message: "data \uC601\uC18D\uC774 \uBE44\uD65C\uC131(app.data \uBBF8\uC81C\uACF5)" };
          const planId = typeof p?.plan === "string" && p.plan ? p.plan : void 0;
          if (planId) {
            const steps = await trace.stepsOf(planId);
            return { ok: true, planId, steps };
          }
          const limit = Math.max(1, Math.min(200, Number(p?.limit) || 20));
          const plans = await trace.recentPlans({ limit });
          return { ok: true, session: trace.sessionId, plans };
        }
      })
    );
    ctx.subscriptions.push(
      app.commands.register("ask", {
        description: "Send a single prompt to one ACP agent (connect \u2192 new session \u2192 prompt) and return the response text and tool calls. Use for headless single-turn queries without opening the Clubhouse UI.",
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
      app.ui.registerView("clubhouse", {
        mount(container) {
          teardown(container);
          container.style.position = "relative";
          const style = document.createElement("style");
          style.textContent = CSS2;
          const root = document.createElement("div");
          root.className = "st";
          buildClubhouse(container, root);
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
        if (st === activeClubhouse) activeClubhouse = null;
        for (const c of st.actives) engine.cancel(c.connId, c.sessionId);
        for (const connId of st.conns.values()) core("disconnect", { connId }).catch(() => {
        });
        st.conns.clear();
      }
      states.delete(container);
      container.replaceChildren();
    }
    function buildClubhouse(container, root) {
      const bar = el2("div", "st-bar");
      const tabsEl = el2("div", "st-tabs");
      const kibEl = el2("div", "st-kib");
      const status = el2("div", "st-status");
      const msgs = el2("div", "st-msgs");
      const inrow = el2("div", "st-in");
      const ta = document.createElement("textarea");
      ta.placeholder = t("placeholder", lang);
      ta.rows = 1;
      ta.dataset.node = "input";
      const send = document.createElement("button");
      send.textContent = t("sendBtn", lang);
      send.dataset.node = "send";
      const mentionPop = el2("div", "st-mention");
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
      activeClubhouse = st;
      buildKibitz(st);
      renderTabs(st, tabsEl);
      bar.append(elText2("b", "Clubhouse"), tabsEl, kibEl, status);
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
          const row = el2("div", "st-mention-item" + (i === menActive ? " on" : ""));
          row.style.color = COLOR[t2.id] ?? "var(--fg,#ddd)";
          row.append(elText2("span", "@", "st-mention-at"), elText2("span", t2.label, "st-mention-nm"));
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
        const chip = el2("div", "st-tab" + (entry.checked ? "" : " off"));
        chip.style.color = a?.color ?? "#888";
        chip.dataset.id = entry.id;
        chip.dataset.node = `tab/${entry.id}`;
        const chk = el2("span", "chk");
        chk.textContent = entry.checked ? "\u2713" : "";
        const nm = elText2("span", a?.label ?? entry.id, "nm");
        nm.style.color = "var(--fg,#ddd)";
        chip.append(chk, nm);
        if (st.mode === "facil" && entry.checked) {
          const crown = elText2("span", "\u{1F451}", "st-crown" + (entry.id === st.facilitatorId ? " on" : ""));
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
      liveEmit({ kind: "start", who: nameOf(speaker), color: COLOR[speaker] });
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
        liveEmit({ kind: "end", who: nameOf(speaker), color: COLOR[speaker], text: work });
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
        liveEmit({ kind: "delta", who: nameOf(cur.agentId), color: COLOR[cur.agentId], text: t2 });
      }
    }
    function renderUser(st, text) {
      const row = el2("div", "st-row user");
      const who = el2("div", "st-who");
      who.append(elText2("span", t("whoMe", lang), "st-who-name"), elText2("span", ` \xB7 ${hhmmss()}`, "st-who-time"));
      row.append(who, bubble(text));
      st.msgs.appendChild(row);
      scroll(st);
      liveEmit({ kind: "user", who: t("whoMe", lang), text });
    }
    function renderQueued(st) {
      clearQueued(st);
      const last = st.pendingHuman[st.pendingHuman.length - 1] ?? "";
      const row = el2("div", "st-row user queued");
      row.dataset.queued = "1";
      const who = el2("div", "st-who");
      who.append(elText2("span", t("whoMe", lang), "st-who-name"), elText2("span", t("queuedTag", lang), "st-queued-tag"));
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
      const back = el2("div", "st-modal");
      const box = el2("div", "st-modal-box");
      box.append(elText2("div", tp("modalTitle", lang, { who }), "st-modal-title"));
      box.append(elText2("div", t("modalMsg", lang), "st-modal-msg"));
      const btns = el2("div", "st-modal-btns");
      const close = (c) => {
        back.remove();
        cb(c);
      };
      const mk = (label, c, primary) => {
        const b = elText2("button", label, "st-modal-btn" + (primary ? " primary" : ""));
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
      const row = el2("div", "st-row assistant");
      const who = el2("div", "st-who");
      const nameEl = elText2("span", nameOf(agentId), "st-who-name");
      nameEl.style.color = COLOR[agentId] ?? "var(--fg3,#888)";
      const timeEl = el2("span", "st-who-time");
      const startStamp = hhmmss();
      timeEl.textContent = ` \xB7 ${startStamp}`;
      who.append(nameEl, timeEl);
      const pending = el2("div", "st-pending");
      pending.append(el2("span", "st-dot"), document.createTextNode(t("pending", lang)));
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
          const box = el2("div", "st-bubble");
          const text = el2("span", "st-bubble-text");
          const time = el2("span", "st-box-time");
          box.append(text, time);
          endTimeEl = time;
          swap(box);
          return text;
        },
        fail(reason) {
          const box = el2("div", "st-fail");
          box.title = reason;
          const time = el2("span", "st-box-time");
          box.append(elText2("span", `\u26A0 ${reason}`, "st-fail-text"), time);
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
          const badge = elText2("span", t("thinkBadge", lang), "st-think");
          badge.title = t("thinkBadgeTitle", lang);
          const panel = elText2("div", text, "st-think-body");
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
    function el2(tag, cls) {
      const e = document.createElement(tag);
      e.className = cls;
      return e;
    }
    function elText2(tag, text, cls = "") {
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
      const b = el2("div", "st-bubble");
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
