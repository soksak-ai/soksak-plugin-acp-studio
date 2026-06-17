#!/usr/bin/env node
// soksak dev 소켓 RPC 호출기 — acp-studio E2E 하니스. 등록 커맨드 = 소켓 메서드(plugin.<id>.<name> 포함).
// 사용: node scripts/rpc.mjs <method> '<paramsJSON>'   (env SOKSAK_SOCKET 또는 ~/.soksak/com.soksak.dev.sock)
import net from "node:net";

const SOCKET = process.env.SOKSAK_SOCKET || `${process.env.HOME}/.soksak/com.soksak.dev.sock`;
const [method, paramsRaw] = process.argv.slice(2);
if (!method) {
  console.error("사용: node scripts/rpc.mjs <method> '<paramsJSON>'");
  process.exit(2);
}
let params = {};
try {
  params = paramsRaw ? JSON.parse(paramsRaw) : {};
} catch (e) {
  console.error("paramsJSON 파싱 실패:", e.message);
  process.exit(2);
}

const sock = net.createConnection(SOCKET);
sock.setNoDelay(true);
let buf = "";
sock.on("connect", () => sock.write(JSON.stringify({ id: 1, method, params }) + "\n"));
sock.on("data", (d) => {
  buf += d.toString("utf8");
  const i = buf.indexOf("\n");
  if (i < 0) return;
  const msg = JSON.parse(buf.slice(0, i));
  console.log(JSON.stringify(msg, null, 2));
  sock.end();
  process.exit(msg.ok === false ? 1 : 0);
});
sock.on("error", (e) => {
  console.error("소켓 오류:", e.message);
  process.exit(2);
});
setTimeout(() => {
  console.error("TIMEOUT");
  process.exit(3);
}, 300000);
