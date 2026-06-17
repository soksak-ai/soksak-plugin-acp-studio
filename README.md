# soksak-plugin-acp-studio

A soksak plugin for collaborating with multiple AI coding agents (Claude, Codex) in **a single conversation** within one workspace.
Based on ACP (Agent Client Protocol); depends on `soksak-plugin-acp-core` (engine).

Select participating models via checkboxes, order them by tab position, and collaborate across three conversation modes to work on real files. Addressing a peer directly is unified to a single channel: `@name` in the message body.

> Gemini is temporarily disabled (hidden): gemini-cli service discontinued + antigravity-cli ACP not implemented. Will be restored when the path is recovered.

## Conversation Modes (Three Personalities)

- **Facilitator** (default) — The facilitator (👑, assigned in tabs) is the human's single point of contact. Coordinates peers via `@mention`, simultaneous (all at once), or sequential (one by one), and decides when to conclude after each stall (peer response complete). If the facilitator addresses nobody, the turn ends naturally. A hard round cap prevents infinite loops.
- **Sequential** — Each participant speaks once in tab order, then stops. Fair and complete coverage.
- **Simultaneous** — Everyone sees the same context (snapshot) and responds once in parallel. Peers cannot see each other's answers (zero anchoring, zero groupthink).

The human always has highest-priority intervention (interrupts an in-progress facilitator turn → preserves the partial response → injects input → restarts). Agents that encounter session errors (including brief disconnections) are automatically unchecked (human re-checks to re-invite).

## @Mention

Typing `@` in the input field opens an autocomplete popup of checked participant models (↑↓ · Enter · Esc). If `@model` is present, that model is addressed directly regardless of mode — multiple mentions trigger simultaneous (parallel) delivery; a single mention addresses only that model. The facilitator in Facilitator mode is also bypassed.

## Commands (Headless · CLI/MCP)

- `send` — Send a human message to the active Studio (live run · intervention). `mode` switches the mode before sending (E2E).
- `state` — Live state of the active Studio (mode · facilitator · conversation count · streaming length of the in-progress turn — for observation · E2E).
- `ask` — Single agent, single turn.
- `converse` — Multi-agent, one exchange (one turn each). `agents` accepts a preset id or `{id,cmd,args}` (E2E launch).

## Settings

Permission request policy · default conversation mode (facilitator/sequential/simultaneous) · `@` chaining limit · facilitator mode round cap.

## Development

```
npm install
npm run typecheck && npm run test && npm run build
```

Pure logic (`conversation.ts`) is verified with vitest unit tests; integration is verified via exposed commands (`send`/`state`) + `window.snapshot` screen capture. `host-contract.test.ts` is the host chrome standards compliance gate.

## DOM Exposure (Structural Addresses)

DOM nodes exposed to external access (address-based click/measure · E2E) are declared in `plugin.json` `contributes.nodes` — listed on the consent screen; actual elements receive a `data-node` instance attribute. Elements not declared are inaccessible (`NOT_EXPOSED`).

| Node | data-node | Description |
|---|---|---|
| `send` | `send` | Send button |
| `input` | `input` | Message input field |
| `tab` | `tab/<agentId>` | Agent tab (checkbox · drag) |

Address example: `content/view/soksak-plugin-acp-studio.studio/node/send`. Use `sok ui.tree` to inspect currently exposed nodes.
