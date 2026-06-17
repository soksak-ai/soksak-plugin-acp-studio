#!/usr/bin/env node
// acp-studio E2E mock 에이전트 — 인증 없이 다중 에이전트 턴테이킹을 결정적으로 검증(테스트 전용, UI 비노출).
// acp-core 는 에이전트-agnostic(cmd/args 수용) → converse 가 {id,cmd,args} 로 직접 launch. 코어는 이 목을 모름(락인 0).
//
// 동작: prompt 받으면 [이 세션 턴 수 N] + 받은 대화의 마지막 비어있지 않은 줄(직전 발화 echo)을 담아 한마디.
//   → canonical 주입(앞 발화자 포함) 검증 가능. 동시에 cwd 의 mock-<name>.txt 에 한 줄 append → 실작업/디스크 diff 검증.
import * as acp from "@agentclientprotocol/sdk";
import { Writable, Readable } from "node:stream";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.split("=")[1] : d;
};
const name = arg("name", "mock");

// 결함 주입(견고함 검증) — --crash: 시작 즉시 code 1 종료(codex 류 크래시 모사). 연결 실패 → 상위가 건너뛴다.
if (process.argv.includes("--crash")) {
  process.stderr.write(`mock ${name} crash\n`);
  process.exit(1);
}

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
let conn;
const turns = new Map(); // sessionId → 턴 수

const agent = {
  async initialize() {
    return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} };
  },
  async newSession() {
    return { sessionId: `s-${name}-${turns.size}` };
  },
  async authenticate() {
    return {};
  },
  async prompt(params) {
    const sid = params.sessionId;
    const userText = (params.prompt || [])
      .map((b) => (b && b.type === "text" ? b.text : ""))
      .join("");
    const lines = userText.split("\n").map((s) => s.trim()).filter(Boolean);
    // 직전 줄 echo — 꺾쇠 제거(태그 문자를 본문에 되울려 demux 가 재파싱하는 fixture 아티팩트 방지).
    const last = (lines.length ? lines[lines.length - 1] : "").replace(/[<>]/g, "");
    const n = (turns.get(sid) || 0) + 1;
    turns.set(sid, n);
    let text = `${name} 한마디(턴 ${n}) — 직전: "${last.slice(0, 48)}"`;
    // 사교 태그 주입(E2E demux/호명 검증) — --club="문구" 는 <잡담>, --summon=NAME 은 그 동료 호명.
    const club = arg("club", "");
    const summon = arg("summon", "");
    if (summon) text += ` <잡담>${summon}, 너는 어떻게 생각해?</잡담>`;
    else if (club) text += ` <잡담>${club}</잡담>`;
    await conn.sessionUpdate({
      sessionId: sid,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    });
    // 실작업 증거 — cwd 에 파일 한 줄 추가(디스크 diff 로 검증). 권한/경로 실패는 무시.
    try {
      appendFileSync(join(process.cwd(), `mock-${name}.txt`), text + "\n");
    } catch {
      /* noop */
    }
    return { stopReason: "end_turn" };
  },
  async cancel() {
    return {};
  },
};

conn = new acp.AgentSideConnection((_client) => agent, stream);
