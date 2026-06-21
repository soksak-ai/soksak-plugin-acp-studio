// engine — agents-clubhouse 실작업 엔진. 코어 헬퍼(연결·턴·디스크 검증).
// 역할 고정 plan→review→implement 루프는 폐기(H=emergent 확정) — 누가 무엇을 할지는 대화에서 자연 발생.
// 남긴 것: connect+session(cwd 지정 → 에이전트가 그 디렉터리에서 실파일 작업) · ask(코어 dedup r.text) ·
// cwd 스냅샷 diff 로 filesWritten 를 디스크 사실로 검증(에이전트 텍스트 주장이 아니라).
//
// acp-core 의존: connect/session-new/prompt/disconnect 를 app.commands 로 호출(엔진은 코어가 소유).

const CORE = "plugin.soksak-plugin-agents-acp.";

export interface Conn {
  connId: number;
  sessionId: string;
}

export interface AgentLaunch {
  agent?: string; // preset(claude/codex/gemini)
  cmd?: string; // 또는 임의 cmd/args
  args?: string[];
}

export interface AskResult {
  text: string; // 코어가 조립·dedup 한 텍스트(델타+최종 완결 재전송 정리, 2배 중복 0)
  updates: any[]; // session/update 원본(tool_call 등)
  stopReason?: string;
}

export function createEngine(app: any) {
  const core = (name: string, params?: any) => app.commands.execute(CORE + name, params ?? {});

  // 에이전트 프로세스 연결 + 새 세션(cwd 지정). preset 이면 agent, 임의 도구면 cmd/args. permission 정책 전달.
  async function connect(launch: AgentLaunch, cwd?: string, permission?: string): Promise<Conn> {
    const params = launch.agent
      ? { agent: launch.agent, cwd, permission }
      : { cmd: launch.cmd, args: launch.args, cwd, permission };
    const c = await core("connect", params);
    if (!c.ok) throw new Error(c.error || c.message || "connect 실패");
    const s = await core("session-new", { connId: c.connId, cwd });
    if (!s.ok) throw new Error(s.error || s.message || "session 실패");
    return { connId: c.connId, sessionId: s.sessionId };
  }

  // 새 세션만 — canonical full-replay 용(턴마다 새 세션 + 전체 맥락 재주입, 세션 메모리 비의존).
  async function newSession(connId: number, cwd?: string): Promise<string> {
    const s = await core("session-new", { connId, cwd });
    if (!s.ok) throw new Error(s.error || s.message || "session 실패");
    return s.sessionId;
  }

  // 한 턴 — prompt 전송, 코어 dedup r.text + updates 반환.
  async function ask(connId: number, sessionId: string, text: string): Promise<AskResult> {
    const r = await core("prompt", { connId, sessionId, text });
    if (!r.ok) throw new Error(r.error || r.message || "prompt 실패");
    return { text: r.text ?? "", updates: r.updates ?? [], stopReason: r.stopReason };
  }

  async function cancel(connId: number, sessionId: string): Promise<void> {
    // 진행 중 턴 중단(사람 참견 시) — 코어가 cancel 을 노출하면 호출, 없으면 무시(상위가 결과 폐기로 처리).
    await core("cancel", { connId, sessionId }).catch(() => {});
  }

  async function disconnect(connId: number): Promise<void> {
    await core("disconnect", { connId }).catch(() => {});
  }

  // cwd top-level 파일 스냅샷(name→mtime) — 턴 전후 비교로 실제 디스크 변경 검증(비재귀, fs:read 필요).
  async function snapshot(cwd?: string): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    if (!cwd || !app.fs?.list) return m;
    try {
      const r: any = await app.fs.list(cwd, { meta: true });
      for (const ch of r?.children ?? []) if (!ch.dir) m.set(ch.name, ch.modified ?? 0);
    } catch {
      /* 디렉터리 없음/권한 — 빈 스냅샷(검증 생략) */
    }
    return m;
  }
  function diffWritten(before: Map<string, number>, after: Map<string, number>): string[] {
    const out: string[] = [];
    for (const [name, mt] of after) if (!before.has(name) || before.get(name) !== mt) out.push(name);
    return out.sort();
  }

  return { connect, newSession, ask, cancel, disconnect, snapshot, diffWritten };
}

export type Engine = ReturnType<typeof createEngine>;
