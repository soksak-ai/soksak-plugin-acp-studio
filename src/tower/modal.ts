// 타워 모달 셸 + 본문(M3) + fast-path 실행 배선(M4) — AI-명령 모달. 560px 드래그 오버레이 +
//   헤더(✦ AI 명령 · 부제 · 그립 · ✕) + 본문(NL 입력바 · 예시행 5 · 명령 팔레트 · 검색 · 우측 라이브칸).
//   M4: 예시행/팔레트 클릭 = executor.runExample/runCommand 로 실행(NL 바 채우기 stub 제거). danger 는
//   confirm 게이트 경유. 로직은 executor.ts 단일 실행점에만 — modal 은 클릭을 executor 로 넘기고 결과를
//   라이브칸에 반영할 뿐(RULE 6, 로직 누수 0).
//
// ⚠️ danger-confirm 게이트(매트릭스 불변식 b): confirm 모달의 accept 버튼은 data-node 가 없다 →
//   collectExposed 미수집 → ui.input.click 으로 자가승인 불가. 컨테이너/취소만 노출(사람·E2E 가시성).
//   accept 는 사람 pointer click 만 받는다. executor 의 runDom 도 "tower/confirm" 주소를 영구 거부.
//
// 코어 변경 0. 호스트 테마 변수(--card/--bd/--acc/--accbg/--inset/--fg/--fg3)만 사용 → 5테마 per-theme 코드 0.
// document.body 직속(뷰 컨테이너 밖)이라 코어 catalogDom.collectExposed 가 호스트 크롬으로 수집:
//   data-node="tower/<path>" → 주소 win/<win>/chrome/tower/<path>. 모든 인터랙티브 노드를 data-node 로 전수 노출
//   (RULE 8): input·example/0..4·cmd/<name>·live·close·grip.
// Clubhouse content 탭은 건드리지 않는다(별도 DOM, additive). 라이브칸은 Clubhouse 의 .st-bubble 룩을 재사용.
//
// RULE 7(이벤트-우선·폴링 0): 팔레트는 모달 open 시 state.commands 1회 fetch + theme/locale 변경 이벤트에
//   재fetch. 레지스트리-변경 이벤트는 호스트가 노출하지 않으므로(PluginEventMap 에 없음) open-시 fetch 가
//   정공법 — setInterval/poll 루프 금지. 라이브칸은 stable bus 토픽 구독(per-connId 추측·폴링 없음).

import { t, type I18nKey } from "../i18n";
import {
  createExecutor,
  CONFIRM_EXPOSED_NODES,
  type ConfirmGate,
  type TowerExecutor,
  type Planner,
  type PlanRunResult,
  type PlanRunOptions,
  type DistRunResult,
  type DistRunOptions,
  type ReflectResult,
  type ReflectOptions,
} from "./executor";
import { EXAMPLE_COMMANDS, type PlanStep } from "./plan";
import { deleteStep, moveStep, editParams } from "./editplan";
import type { TraceSink } from "./trace";

// 라이브칸이 구독하는 stable bus 토픽 — Clubhouse 런타임(main.ts)이 스트림 단일 진실에서 재방송한다.
//   acp.update.<connId> 는 connId 별이라 모달이 직접 못 잡는다 → main.ts onStream 이 이 토픽으로 relay(이벤트-우선).
export const TOWER_LIVE_TOPIC = "clubhouse.tower.live";

// 라이브 이벤트 — main.ts 가 emit. kind 로 버블 구분(시작/델타/종료/사람/시스템).
export interface TowerLiveEvent {
  kind: "start" | "delta" | "end" | "user" | "reset";
  who?: string; // 표시 이름(에이전트/나)
  color?: string; // 에이전트 브랜드 색(없으면 테마 토큰)
  text?: string; // delta=증분, user=전체, end=최종(있으면 교체)
}

// 예시행 문구 — plan.ts EXAMPLE_COMMANDS 의 text 단일 진실에서 파생(사본 금지 — fast-path EXACT 매치가
//   같은 문자열에 의존하므로 한 출처여야 함). 클릭 = executor.runExample(i)(M4), Enter EXACT = 동일 경로(M5).
const EXAMPLES = EXAMPLE_COMMANDS.map((e) => e.text);

const STYLE_ID = "tower-modal-style";
const CSS = `
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
/* 본문 = 좌(입력·예시·팔레트) | 우(라이브) 2열 */
.tower-bd{display:flex;min-height:0;flex:1 1 auto}
.tower-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;padding:12px;gap:11px;overflow-y:auto}
.tower-side{flex:0 0 188px;border-left:1px solid var(--bd,#3a3a3a);display:flex;flex-direction:column;min-height:0}
/* NL 입력바 */
.tower-inwrap{display:flex;align-items:center;gap:8px;border:1px solid var(--bd,#3a3a3a);border-radius:9px;
  background:var(--inset,rgba(127,127,127,.08));padding:8px 10px}
.tower-inwrap:focus-within{border-color:var(--acc,#7aa2f7)}
.tower-inmk{display:inline-flex;align-items:center;color:var(--acc,#7aa2f7);flex:0 0 auto}
.tower-in{flex:1 1 auto;min-width:0;background:transparent;border:0;outline:0;color:var(--fg,#e6e6e6);font:inherit}
.tower-in::placeholder{color:var(--fg3,#888)}
.tower-enter{flex:0 0 auto;font-size:11px;color:var(--fg3,#888);border:1px solid var(--bd,#3a3a3a);
  border-radius:5px;padding:0 5px;line-height:16px}
/* 섹션 라벨 */
.tower-sec{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--fg3,#888)}
/* 예시행 */
.tower-exs{display:flex;flex-direction:column;gap:5px}
.tower-ex{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;border:1px solid var(--bd,#3a3a3a);
  background:var(--inset,rgba(127,127,127,.06));cursor:pointer;text-align:left;color:inherit;font:inherit}
.tower-ex:hover{border-color:var(--acc,#7aa2f7);background:var(--accbg,rgba(122,162,247,.12))}
.tower-ex-mk{color:var(--acc,#7aa2f7);flex:0 0 auto;font-size:12px}
.tower-ex-tx{flex:1 1 auto;min-width:0}
.tower-ex-go{flex:0 0 auto;font-size:11px;color:var(--fg3,#888)}
/* dry-run plan 미리보기 — 예시행 룩 재사용(실행 전 plan step 표시, ⏎ 로 commit) */
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
/* M9 — 편집 가능 preview: step별 delete/up/down + 인라인 params 편집(전수 data-node 노출, RULE 8) */
.tower-pstep{flex-wrap:wrap}
.tower-pstep-ed{flex:0 0 auto;display:flex;align-items:center;gap:3px}
.tower-pstep-eb{appearance:none;border:1px solid var(--bd,#3a3a3a);background:transparent;color:var(--fg3,#999);
  font:inherit;font-size:11px;line-height:16px;cursor:pointer;border-radius:5px;width:20px;height:20px;
  display:inline-flex;align-items:center;justify-content:center;padding:0}
.tower-pstep-eb:hover{border-color:var(--acc,#7aa2f7);color:var(--acc,#7aa2f7);background:var(--accbg,rgba(122,162,247,.12))}
.tower-pstep-eb.del:hover{border-color:var(--danger-soft,#d77);color:var(--danger-soft,#e66);background:var(--danger-bg,rgba(220,90,90,.14))}
.tower-pstep-eb:disabled{opacity:.32;cursor:default}
.tower-pstep-pin{flex:1 1 100%;order:9;min-width:0;margin-top:3px;appearance:none;font:inherit;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:inherit;
  background:var(--card,rgba(0,0,0,.18));border:1px solid var(--bd,#3a3a3a);border-radius:6px;padding:4px 7px}
.tower-pstep-pin:focus{outline:none;border-color:var(--acc,#7aa2f7)}
.tower-pstep-pin.bad{border-color:var(--danger-soft,#d77)}
.tower-plan-act{display:flex;justify-content:flex-end;gap:7px;margin-top:2px}
.tower-plan-btn{appearance:none;border:1px solid var(--bd,#3a3a3a);background:transparent;color:inherit;font:inherit;
  font-size:11.5px;cursor:pointer;border-radius:7px;padding:4px 11px}
.tower-plan-btn:hover{background:var(--inset,rgba(127,127,127,.14))}
.tower-plan-btn.run{border-color:var(--acc,#7aa2f7);color:var(--acc,#7aa2f7);font-weight:600}
.tower-plan-btn.run:hover{background:var(--accbg,rgba(122,162,247,.18))}
.tower-plan-busy{font-size:11.5px;color:var(--fg3,#888);padding:4px 2px}
/* 팔레트 */
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
/* 라이브칸 — Clubhouse st-bubble 룩 재사용 */
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
/* danger-confirm 게이트 — 코어 ConfirmCloseModal 패턴 재사용. 모달 위 z-index 로 사람-only 확인. */
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

// 명령 prefix → 글리프(축2 dom 아님, 시각 보조만). 미스 시 점 글리프.
const ICON_BY_PREFIX: Record<string, string> = {
  terminal: ">_",
  panel: "▤",
  view: "▤",
  content: "▤",
  window: "❑",
  file: "▤",
  fs: "▤",
  browser: "🌐",
  bookmark: "★",
  theme: "◐",
  settings: "⚙",
  plugin: "⬡",
  state: "≡",
  status: "◷",
  ui: "⊹",
  project: "▢",
  clipboard: "⎘",
  search: "⌕",
};
function cmdIcon(name: string): string {
  const pre = name.split(".")[0];
  return ICON_BY_PREFIX[pre] ?? "·";
}
// destructive 어휘 → danger 글리프(M3 시각만 — 실제 게이트는 M4). catalogJson 이 danger 를 안 실어
//   이름 기반 휴리스틱으로 표식만 한다(가짜 안전감 아님 — 단지 시각 힌트).
function cmdDanger(name: string): boolean {
  return /\.(close|remove|delete|kill|clear|reset|disable|quit|destroy)\b/.test(name);
}
// 표시 제목 — catalogJson description 은 "base | 트리거…" 합성본이라 ' | ' 앞 base 만(없으면 name).
function cmdTitle(name: string, description: string): string {
  const base = (description || "").split(" | ")[0].trim();
  return base || name;
}

const ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" /></svg>';
const ICON_SM =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" /></svg>';

export interface TowerModalDeps {
  title: string;
  lang: () => string; // 현재 호스트 언어(locale.changed 로 갱신됨) — 본문 텍스트·재fetch 에 사용
  app: any; // ctx.app — commands.execute(팔레트) · events.on(재fetch) · bus.on(라이브)
  planner?: Planner; // slow-path planning 턴 seam — 없으면 NL Enter 모호 입력이 NO_PLANNER 보고
  trace?: TraceSink; // 세션/trace 영속(M7, app.data) — executor 로 전달. 없으면 영속 0(순수 동작).
  onChange?: () => void; // 열림/닫힘 변화 단일 채널(헤더 active 동기화, 이벤트-우선)
}

export interface TowerModal {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  dispose: () => void;
  // 헤드리스 slow-path 구동(노출 command·E2E) — executor.planAndRun 직통. 모달 open 비의존(executor 상주).
  planAndRun: (nl: string, opts?: PlanRunOptions) => Promise<PlanRunResult>;
  // 편집된 plan 재검증 + dry-run(M9) — executor.revalidateAndRun 직통. 편집(삭제·reorder·param)된 plan 을
  //   다시 validatePlan(편집 검증 우회 0) → dry-run + commit(편집된 plan 디스패치, rollback 보호). 헤드리스 E2E.
  revalidateAndRun: (steps: PlanStep[], opts?: PlanRunOptions) => Promise<PlanRunResult>;
  // 다중 에이전트 분배(M6) — 모드별(facil/turn/simul) 다중 plan → 단일 dry-run + commit. danger confirm 직렬 큐.
  distributeAndRun: (nl: string, opts: DistRunOptions) => Promise<DistRunResult>;
  // post-execution reflection 루프(M8) — executor.reflectAndRun 직통. 디스패치→verify→실패 되먹임→재계획,
  //   maxSteps/maxReplans 가드 + 상한 초과 escalate. fast-path 미경유(planAndRun 과 별개 자율 루프).
  reflectAndRun: (nl: string, opts?: ReflectOptions) => Promise<ReflectResult>;
  // 결정적 시각 E2E — KNOWN plan 을 모달 UI 에 dry-run preview 로 렌더(라이브 LLM 우회). 모달 닫혀 있으면
  //   먼저 연다. 검증·게이트는 동일(주입 plan 도 validatePlan + danger 게이트). snapshot 으로 미리보기 확인용.
  previewInject: (nl: string, steps: PlanStep[]) => Promise<PlanRunResult>;
}

interface CatalogCmd {
  name: string;
  description: string;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
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

// 드래그 — 그립/헤더 pointerdown 으로 창 경계 내에서 reposition(left/top 절대, transform 해제).
function makeDraggable(ov: HTMLElement, handle: HTMLElement): () => void {
  let sx = 0,
    sy = 0,
    ox = 0,
    oy = 0,
    dragging = false;
  const onMove = (e: PointerEvent) => {
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
  const onDown = (e: PointerEvent) => {
    // 닫기 버튼·입력바·예시·팔레트 등 인터랙티브 요소에서 시작한 드래그는 무시(그립/헤더 빈 곳만 드래그).
    const target = e.target as HTMLElement;
    if (
      target.closest(".tower-x") ||
      target.closest(".tower-in") ||
      target.closest(".tower-ex") ||
      target.closest(".tower-cmd")
    ) {
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

export function createTowerModal(deps: TowerModalDeps): TowerModal {
  const { app, lang, onChange } = deps;
  ensureStyle();
  let ov: HTMLElement | null = null;
  let undrag: (() => void) | null = null;
  // 본문 라이프사이클(open 마다 새로) — 구독 해지(호스트 Disposable)·필터·라이브 상태.
  let subs: Array<{ dispose: () => void }> = [];
  let palWrap: HTMLElement | null = null;
  let liveBox: HTMLElement | null = null;
  let nlInput: HTMLInputElement | null = null;
  let planBox: HTMLElement | null = null; // dry-run plan 미리보기 슬롯(NL 바 아래, 예시행 위)
  let planning = false; // slow-path 진행 중 — 중복 Enter 차단(직렬)
  let planNl = ""; // 현재 편집 중 preview 의 원 NL(편집 재검증 trace 메타·재렌더용)
  let planSteps: PlanStep[] = []; // 현재 preview 의 last-valid step(편집 거부 시 되돌릴 기준, M9)
  let catalog: CatalogCmd[] = [];
  let liveActive: { who?: string; color?: string; text: HTMLElement } | null = null;

  const tr = (key: I18nKey) => t(key, lang());

  // ── danger-confirm 게이트(DOM) — accept 는 data-node 없음(executor 도달 밖). 사람 pointer click 만
  //   토큰 발급(issue). overlay/취소/Escape = 거부(null). 한 번에 하나(중첩 confirm 직렬). ──
  let confirmOv: HTMLElement | null = null;
  const confirmGate: ConfirmGate = (issue, info) =>
    new Promise<string | null>((resolve) => {
      // executor 가 enqueueConfirm(FIFO)으로 confirmGate 호출을 직렬화한다(M6) — 동시 destructive 도 한
      //   번에 하나만 여기 도달. 따라서 confirmOv 는 호출 시 항상 null(아래 가드는 belt-and-suspenders).
      if (confirmOv) return resolve(null);
      let done = false;
      const finish = (token: string | null) => {
        if (done) return;
        done = true;
        window.removeEventListener("keydown", onKey, true);
        confirmOv?.remove();
        confirmOv = null;
        resolve(token);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          finish(null);
        }
      };

      const ov = el("div", "tower-cfm-ov");
      ov.dataset.node = CONFIRM_EXPOSED_NODES[0]; // "tower/confirm" — 컨테이너만 노출(가시성). accept 비노출.
      ov.addEventListener("pointerdown", (e) => {
        if (e.target === ov) finish(null); // overlay 클릭 = 취소.
      });
      const card = el("div", "tower-cfm");
      card.addEventListener("pointerdown", (e) => e.stopPropagation());

      const tt = el("div", "tower-cfm-tt");
      tt.append(elText("span", "⚠", "tower-cfm-dg"), elText("span", tr("towerConfirmTitle"), ""));
      const msg = elText(
        "div",
        tr(info.danger === "destructive" ? "towerConfirmDestructive" : "towerConfirmInject"),
        "tower-cfm-msg",
      );
      const cmd = elText("div", info.command, "tower-cfm-cmd");

      const act = el("div", "tower-cfm-act");
      const cancel = el("button", "tower-cfm-btn");
      (cancel as HTMLButtonElement).type = "button";
      cancel.textContent = tr("towerConfirmCancel");
      cancel.dataset.node = CONFIRM_EXPOSED_NODES[1]; // "tower/confirm/cancel" — 취소 노출 OK(자가-취소 안전).
      cancel.addEventListener("click", () => finish(null));
      const ok = el("button", "tower-cfm-btn danger");
      (ok as HTMLButtonElement).type = "button";
      ok.textContent = tr("towerConfirmRun");
      // ⚠️ accept = data-node 없음 → ui.tree/ui.input.click 도달 밖. 사람 pointer click 만 토큰 발급.
      ok.addEventListener("click", () => finish(issue()));
      act.append(cancel, ok);

      card.append(tt, msg, cmd, act);
      ov.append(card);
      document.body.appendChild(ov);
      confirmOv = ov;
      window.addEventListener("keydown", onKey, true);
      ok.focus();
    });

  // executor = 유일 실행점. 모달은 클릭을 여기로 넘기고 결과만 라이브칸에 반영(로직 누수 0, RULE 6).
  //   trace(M7) 주입 — executor 가 commit/discard 시 app.data 에 plan·step·outcome 을 영속(이벤트-우선).
  const executor: TowerExecutor = createExecutor({ app, confirmGate, lang, planner: deps.planner, trace: deps.trace });

  // 실행 결과를 라이브칸 시스템 버블로 — 폴링 0, 사람 가시 피드백.
  function reportOutcome(label: string, r: { ok: boolean; code?: string }): void {
    let key: I18nKey = "towerRunOk";
    if (!r.ok) key = r.code === "NEEDS_TARGET" ? "towerRunNeedsTarget" : r.code === "CONFIRM_DENIED" ? "towerRunDenied" : "towerRunFailed";
    onLive({ kind: "user", who: "✦", text: label });
    onLive({ kind: "start", who: "✦" });
    onLive({ kind: "end", text: tr(key) });
  }

  const emit = () => {
    try {
      onChange?.();
    } catch {
      // 구독자 실패 격리.
    }
  };

  // ── 팔레트(축1 라이브) — state.commands 1회 fetch 후 현재 검색어로 렌더(이벤트-우선, 폴링 0) ──
  async function fetchCatalog(): Promise<void> {
    try {
      const r = await app.commands.execute("state.commands", {});
      const cmds: any[] = Array.isArray(r?.commands) ? r.commands : [];
      catalog = cmds
        .filter((c) => c && typeof c.name === "string")
        .map((c) => ({ name: c.name as string, description: String(c.description ?? "") }));
    } catch {
      catalog = []; // 거부/오류 — 빈 팔레트(검색은 동작, 가짜 행 0)
    }
    renderPalette();
  }

  function renderPalette(): void {
    const wrap = palWrap;
    if (!wrap) return;
    const q = (nlInput?.value ?? "").trim().toLowerCase();
    const rows = catalog.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    );
    wrap.replaceChildren();
    if (!rows.length) {
      wrap.appendChild(elText("div", tr("towerPaletteEmpty"), "tower-empty"));
      return;
    }
    for (const c of rows) {
      const row = el("button", "tower-cmd");
      (row as HTMLButtonElement).type = "button";
      row.dataset.node = `tower/cmd/${c.name}`; // RULE 8 — 팔레트 행 전수 노출(주소 chrome/tower/cmd/<name>)
      row.append(elText("span", cmdIcon(c.name), "tower-cmd-ic"));
      const tt = elText("span", cmdTitle(c.name, c.description), "tower-cmd-tt");
      tt.title = c.name; // hover 로 정식 command 이름 노출
      row.append(tt);
      if (cmdDanger(c.name)) row.append(elText("span", "⚠", "tower-cmd-dg"));
      row.append(elText("span", c.name, "tower-cmd-sc")); // 단축키 필드 부재 → command 이름을 mono 로(축1 진실)
      // 클릭 = executor.runCommand(이 command 자체). danger 면 confirm 게이트 경유(executor 가 판정·게이트).
      //   파라미터 없는 fast-path — 필수 파라미터 command 는 코어가 INVALID_PARAMS 로 거부(그 거부가 진실).
      row.addEventListener("click", () => {
        void executor.runCommand(c.name).then((r) => reportOutcome(c.name, r));
      });
      wrap.appendChild(row);
    }
  }

  // ── NL 바 Enter(M5) — fast-path/slow-path 분기 단일 진입점 ──
  //   1) 입력이 예시행 문구/팔레트 command 와 EXACT-매치면 fast-path(M4) — 에이전트 우회 즉답.
  //   2) 아니면 slow-path — executor.planAndRun(도메인맵 라이브 주입 planning 턴) → dry-run preview.
  //      실행은 사람이 ⏎(commit) 눌러야. (안전모델: slow-path 는 항상 dry-run 우선.)
  async function submitNL(): Promise<void> {
    const raw = (nlInput?.value ?? "").trim();
    if (!raw || planning) return;
    // 1) fast-path EXACT 매치 — 예시 문구 그대로면 그 예시 실행(라이브 파라미터 해소·게이트 포함).
    const exIdx = EXAMPLE_COMMANDS.findIndex((e) => e.text === raw);
    if (exIdx >= 0) {
      if (nlInput) nlInput.value = "";
      clearPlanPreview();
      renderPalette();
      void executor.runExample(exIdx).then((r) => reportOutcome(`"${raw}"`, r));
      return;
    }
    // 팔레트 command 이름 EXACT 매치(예: "theme.apply").
    const cmd = catalog.find((c) => c.name === raw);
    if (cmd) {
      if (nlInput) nlInput.value = "";
      clearPlanPreview();
      renderPalette();
      void executor.runCommand(cmd.name).then((r) => reportOutcome(cmd.name, r));
      return;
    }
    // 2) slow-path — 모호 NL → planning 턴 → dry-run preview.
    await runSlowPath(raw);
  }

  // slow-path 단일 경로 — planAndRun(라이브 또는 주입) → 성공 시 *편집 가능* dry-run preview 렌더, 실패 시 사유
  //   표시. opts.injectPlan 주입 시 라이브 LLM 우회(결정적 E2E) — 검증·게이트는 동일. UI 진입점·헤드리스 공용.
  async function runSlowPath(raw: string, opts?: PlanRunOptions): Promise<PlanRunResult> {
    planning = true;
    renderPlanBusy(tr("towerPlanning"));
    onLive({ kind: "user", who: "✦", text: raw });
    let res: PlanRunResult;
    try {
      res = await executor.planAndRun(raw, opts);
    } catch (e) {
      res = { ok: false, code: "PLAN_EXCEPTION", message: String((e as Error)?.message ?? e) };
    }
    planning = false;
    if (!res.ok) {
      const key: I18nKey = res.code === "NO_PLANNER" ? "towerPlanNoAgent" : "towerPlanFailed";
      renderPlanBusy(tr(key), true);
      onLive({ kind: "start", who: "✦" });
      onLive({ kind: "end", text: tr(key) });
      return res;
    }
    // 편집 가능 preview — 초기 검증 통과 step 을 last-valid 로 두고 편집 가능하게 렌더(M9).
    planNl = raw;
    planSteps = res.steps;
    renderPlanPreview(raw, res.steps, res.commit);
    return res;
  }

  // 편집 후 재검증·재렌더(M9, 이벤트-우선 RULE 7) — 사람이 step 을 편집하면(삭제·reorder·param) *편집된* plan 을
  //   executor.revalidateAndRun 으로 다시 validatePlan(편집이 검증 우회 0). 통과 → last-valid 갱신 + 편집 가능
  //   preview 재렌더(commit 은 편집된 plan 에 bind). 거부(미등록 command/주소) → 직전 last-valid 로 되돌려 렌더
  //   + 거부 사유 표시(잘못된 편집이 commit 대상이 되지 않는다). trace 메타는 초기 plan 과 동일.
  async function reRenderEdited(nextSteps: PlanStep[]): Promise<void> {
    const meta = { nl: planNl, mode: activeMode() };
    let res: PlanRunResult;
    try {
      res = await executor.revalidateAndRun(nextSteps, { trace: meta });
    } catch (e) {
      res = { ok: false, code: "PLAN_EXCEPTION", message: String((e as Error)?.message ?? e) };
    }
    if (!res.ok) {
      // 편집 거부 — last-valid 로 되돌려 렌더하고 사유를 라이브칸·input 에 표시(잘못된 편집은 commit 불가).
      onLive({ kind: "start", who: "✦" });
      onLive({ kind: "end", text: tr("towerPlanInvalidEdit") });
      const back = await executor.revalidateAndRun(planSteps, { trace: meta });
      if (back.ok) renderPlanPreview(planNl, back.steps, back.commit, tr("towerPlanInvalidEdit"));
      return;
    }
    planSteps = res.steps; // 편집 통과 → last-valid 갱신.
    renderPlanPreview(planNl, res.steps, res.commit);
  }

  // 현재 대화 모드(trace 메타) — 모달은 활성 뷰 모드를 모르므로 host 가 planner 와 함께 주입 안 한 경우 "solo".
  //   main.ts 의 헤드리스 경로(tower.plan)는 자체 trace 메타를 쓰므로 여기 값은 UI-편집 재검증 trace 에만 쓰인다.
  function activeMode(): string {
    return "solo";
  }

  // dry-run 진행/실패 메시지(plan 슬롯) — busy 표시. error=true 면 톤만 구분.
  function renderPlanBusy(msg: string, _error = false): void {
    const box = planBox;
    if (!box) return;
    box.replaceChildren(elText("div", msg, "tower-plan-busy"));
    box.dataset.node = "tower/plan"; // RULE 8 — plan 미리보기 슬롯 노출
  }

  function clearPlanPreview(): void {
    if (planBox) planBox.replaceChildren();
    planNl = "";
    planSteps = [];
  }

  // dry-run plan 미리보기 — 검증된 step 을 *편집 가능한* 행으로(M9). 각 행·각 컨트롤 data-node 전수 노출
  //   (RULE 8). 실행 0. 각 step 행: [axis][라벨][⚠ danger][↑ up][↓ down][✕ delete] + 인라인 params(JSON) input.
  //   편집(삭제·reorder·param) = editplan 순수 연산 → reRenderEdited(재검증·재렌더, 이벤트-우선 RULE 7).
  //   [계획 실행 ⏎] = commit() — *편집된* plan 디스패치(danger step 은 executor confirm 게이트, rollback 보호).
  //   [버리기] = 폐기. note(있으면) = 직전 편집이 거부됐다는 사유 표시.
  function renderPlanPreview(
    nl: string,
    steps: PlanStep[],
    commit: () => Promise<{ ok: boolean; code?: string; rollback?: any }>,
    note?: string,
  ): void {
    const box = planBox;
    if (!box) return;
    box.replaceChildren();
    const wrap = el("div", "tower-plan");
    const hd = el("div", "tower-plan-hd");
    hd.append(elText("span", "✦", ""), elText("span", tr("towerPlanTitle"), ""), el("span", "sp"));
    wrap.appendChild(hd);
    if (note) wrap.appendChild(elText("div", note, "tower-plan-busy"));

    const stepsBox = el("div", "tower-plan-steps");
    steps.forEach((s, i) => {
      const row = el("div", "tower-pstep");
      row.dataset.node = `tower/plan/step/${i}`; // RULE 8 — 각 preview step 노출
      row.append(elText("span", s.axis, "tower-pstep-ax"));
      const label = s.axis === "dom" ? `${s.name} ${s.address ?? ""}`.trim() : stepLabel(s);
      const tx = elText("span", label, "tower-pstep-tx");
      tx.title = label;
      row.append(tx);
      if (s.axis !== "dom" && cmdDanger(s.name)) row.append(elText("span", "⚠", "tower-pstep-dg"));

      // 편집 컨트롤 — up/down/delete. 전수 data-node 노출(RULE 8), AI/E2E 가 ui.input.click 으로 조작 가능.
      const ed = el("div", "tower-pstep-ed");
      const up = el("button", "tower-pstep-eb");
      (up as HTMLButtonElement).type = "button";
      up.textContent = "↑";
      up.title = tr("towerPlanStepUp");
      up.dataset.node = `tower/plan/step/${i}/up`; // RULE 8
      (up as HTMLButtonElement).disabled = i === 0;
      up.addEventListener("click", () => void reRenderEdited(moveStep(steps, i, "up")));
      const down = el("button", "tower-pstep-eb");
      (down as HTMLButtonElement).type = "button";
      down.textContent = "↓";
      down.title = tr("towerPlanStepDown");
      down.dataset.node = `tower/plan/step/${i}/down`; // RULE 8
      (down as HTMLButtonElement).disabled = i === steps.length - 1;
      down.addEventListener("click", () => void reRenderEdited(moveStep(steps, i, "down")));
      const del = el("button", "tower-pstep-eb del");
      (del as HTMLButtonElement).type = "button";
      del.textContent = "✕";
      del.title = tr("towerPlanStepDelete");
      del.dataset.node = `tower/plan/step/${i}/delete`; // RULE 8
      del.addEventListener("click", () => void reRenderEdited(deleteStep(steps, i)));
      ed.append(up, down, del);
      row.append(ed);

      // 인라인 params 편집 — dom 은 {address}, 그 외는 step.params 의 JSON. 변경 시 editParams → 재검증.
      const pin = document.createElement("input");
      pin.type = "text";
      pin.className = "tower-pstep-pin";
      pin.value = s.axis === "dom" ? JSON.stringify({ address: s.address ?? "" }) : JSON.stringify(s.params ?? {});
      pin.spellcheck = false;
      pin.dataset.node = `tower/plan/step/${i}/params`; // RULE 8 — 인라인 파라미터 필드 노출
      pin.title = tr("towerPlanStepParams");
      const commitParam = () => {
        let parsed: Record<string, unknown>;
        try {
          const v = JSON.parse(pin.value);
          if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not-object");
          parsed = v as Record<string, unknown>;
        } catch {
          pin.classList.add("bad"); // 잘못된 JSON — 이전 값 유지(편집 미반영).
          onLive({ kind: "start", who: "✦" });
          onLive({ kind: "end", text: tr("towerPlanBadJson") });
          return;
        }
        void reRenderEdited(editParams(steps, i, parsed));
      };
      pin.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitParam();
        }
      });
      pin.addEventListener("change", commitParam);
      row.append(pin);

      stepsBox.appendChild(row);
    });
    wrap.appendChild(stepsBox);

    const act = el("div", "tower-plan-act");
    const discard = el("button", "tower-plan-btn");
    (discard as HTMLButtonElement).type = "button";
    discard.textContent = tr("towerPlanDiscard");
    discard.dataset.node = "tower/plan/discard"; // RULE 8
    discard.addEventListener("click", () => clearPlanPreview());
    const run = el("button", "tower-plan-btn run");
    (run as HTMLButtonElement).type = "button";
    run.textContent = `${tr("towerPlanRunAll")} ⏎`;
    run.dataset.node = "tower/plan/run"; // RULE 8 — ⏎ commit 어포던스
    let committing = false;
    const doCommit = () => {
      if (committing) return;
      committing = true;
      (run as HTMLButtonElement).disabled = true;
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
    // 기본 포커스를 실행 버튼에 — 사람이 곧바로 ⏎ 로 commit(dry-run 검토 후 한 키).
    (run as HTMLButtonElement).focus();
  }

  // plan step 표시 라벨 — command/status 는 name + params 요약(mono). 좌표 hallucination 없는 정확 표기.
  function stepLabel(s: PlanStep): string {
    const p = s.params && Object.keys(s.params).length ? ` ${JSON.stringify(s.params)}` : "";
    return `${s.name}${p}`;
  }

  // ── 라이브칸(이벤트-우선) — main.ts 가 TOWER_LIVE_TOPIC 으로 재방송한 스트림을 버블로 ──
  function clearLive(): void {
    if (!liveBox) return;
    liveBox.replaceChildren(elText("div", tr("towerLiveEmpty"), "tower-live-empty"));
    liveActive = null;
  }
  function liveScroll(): void {
    if (liveBox) liveBox.scrollTop = liveBox.scrollHeight;
  }
  function onLive(ev: TowerLiveEvent): void {
    const box = liveBox;
    if (!box) return;
    if (ev.kind === "reset") return clearLive();
    box.querySelector(".tower-live-empty")?.remove();
    if (ev.kind === "user") {
      const row = el("div", "tower-lrow user");
      row.append(elText("div", ev.who ?? "나", "tower-lwho"), elText("div", ev.text ?? "", "tower-lbubble"));
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

  // 본문 빌드 — open 시 1회. 좌(입력·예시·팔레트) | 우(라이브). 모든 인터랙티브 노드 data-node 전수 노출.
  function buildBody(body: HTMLElement): void {
    const main = el("div", "tower-main");

    // NL 입력바 — ✦ 프리픽스 · placeholder · ⏎ 뱃지. 입력이 곧 팔레트 검색 필터(한 입력 = NL + 검색).
    const inwrap = el("div", "tower-inwrap");
    const inmk = el("span", "tower-inmk");
    inmk.innerHTML = ICON_SM;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tower-in";
    input.placeholder = tr("towerInputPlaceholder");
    input.dataset.node = "tower/input"; // RULE 8
    input.addEventListener("input", () => renderPalette()); // 타이핑 = 라이브 검색(이벤트-우선)
    input.addEventListener("keydown", (e) => {
      // Enter = executor 진입점(M5) — fast-path EXACT 매치면 즉답, 아니면 slow-path dry-run. 실행은 모두
      //   executor 단일 실행점 경유(danger 게이트 포함). slow-path 는 dry-run 우선이라 여기서 직접 디스패치 0.
      if (e.key === "Enter" && !(e as any).isComposing) {
        e.preventDefault();
        void submitNL();
      }
    });
    nlInput = input;
    inwrap.append(inmk, input, elText("span", "⏎", "tower-enter"));
    main.appendChild(inwrap);

    // dry-run plan 미리보기 슬롯 — slow-path 가 검증한 plan 을 여기 행으로(실행 전). NL 바 바로 아래.
    const plan = el("div", "");
    plan.dataset.node = "tower/plan"; // RULE 8 — plan 미리보기 영역 노출(비어 있어도 주소 존재)
    planBox = plan;
    main.appendChild(plan);

    // 예시행 섹션 — 클릭 = NL 바 채움(실행 X).
    main.appendChild(elText("div", tr("towerExamplesTitle"), "tower-sec"));
    const exs = el("div", "tower-exs");
    EXAMPLES.forEach((text, i) => {
      const ex = el("button", "tower-ex");
      (ex as HTMLButtonElement).type = "button";
      ex.dataset.node = `tower/example/${i}`; // RULE 8 — 예시행 전수 노출
      ex.append(elText("span", "✦", "tower-ex-mk"));
      ex.append(elText("span", `"${text}"`, "tower-ex-tx"));
      ex.append(elText("span", "⏎", "tower-ex-go"));
      // 클릭 = executor.runExample(i) — text → 실 command + 라이브 파라미터 해소 → 실행. danger 면 게이트.
      ex.addEventListener("click", () => {
        void executor.runExample(i).then((r) => reportOutcome(`"${text}"`, r));
      });
      exs.appendChild(ex);
    });
    main.appendChild(exs);

    // 명령 팔레트 섹션 — 레지스트리 라이브(state.commands). 검색은 NL 바가 구동.
    main.appendChild(elText("div", tr("towerPaletteTitle"), "tower-sec"));
    const pal = el("div", "tower-pal");
    palWrap = pal;
    pal.appendChild(elText("div", tr("towerPaletteEmpty"), "tower-empty")); // fetch 전 자리표시
    main.appendChild(pal);

    // 우측 라이브칸 — Clubhouse 스트림 버블 룩 재사용.
    const side = el("div", "tower-side");
    side.append(elText("div", tr("towerLiveTitle"), "tower-live-hd"));
    const live = el("div", "tower-live");
    live.dataset.node = "tower/live"; // RULE 8 — 라이브칸 노출
    liveBox = live;
    side.appendChild(live);
    clearLive();

    body.append(main, side);
  }

  const build = (): HTMLElement => {
    const root = el("div", "tower-ov");
    root.dataset.node = "tower/modal"; // chrome/tower/modal

    const hd = el("div", "tower-hd");
    const mk = el("span", "tower-mk");
    mk.innerHTML = ICON;
    const htxt = el("div", "tower-htxt");
    htxt.append(elText("div", deps.title, "tower-tt"), elText("div", tr("towerSubtitle"), "tower-sub"));
    const grip = elText("span", "⠿", "tower-grip");
    grip.dataset.node = "tower/grip"; // RULE 8 — 드래그 그립 노출
    const x = el("button", "tower-x");
    (x as HTMLButtonElement).type = "button";
    x.textContent = "✕";
    x.title = "닫기";
    x.dataset.node = "tower/close"; // chrome/tower/close
    x.addEventListener("click", () => api.close());
    hd.append(mk, htxt, grip, x);

    const bd = el("div", "tower-bd");
    bd.dataset.node = "tower/body"; // chrome/tower/body
    buildBody(bd);

    root.append(hd, bd);
    undrag = makeDraggable(root, hd);
    return root;
  };

  const api: TowerModal = {
    isOpen: () => ov != null,
    // 헤드리스 slow-path — executor 단일 실행점 직통(모달 open 비의존). dry-run 반환(실행 0), commit() 별도.
    planAndRun: (nl: string, opts?: PlanRunOptions) => executor.planAndRun(nl, opts),
    // 편집된 plan 재검증 + dry-run(M9) — executor 직통. 편집 검증 우회 0, commit 은 편집된 plan + rollback 보호.
    revalidateAndRun: (steps: PlanStep[], opts?: PlanRunOptions) => executor.revalidateAndRun(steps, opts),
    // 다중 에이전트 분배(M6) — executor.distributeAndRun 직통. 모드별 planFor 는 main.ts 가 주입.
    distributeAndRun: (nl: string, opts: DistRunOptions) => executor.distributeAndRun(nl, opts),
    // reflection 루프(M8) — executor.reflectAndRun 직통(모달 open 비의존, executor 상주). danger 게이트 매 step.
    reflectAndRun: (nl: string, opts?: ReflectOptions) => executor.reflectAndRun(nl, opts),
    // 결정적 시각 E2E — 모달을 열고 KNOWN plan 을 dry-run preview 로 렌더(라이브 LLM 우회). 실행 0.
    previewInject: async (nl: string, steps: PlanStep[]) => {
      if (!ov) api.open();
      return runSlowPath(nl, { injectPlan: steps });
    },
    open: () => {
      if (ov) return;
      ov = build();
      document.body.appendChild(ov);
      // 이벤트-우선 구독: 라이브(bus) + 팔레트 재fetch(theme/locale). 폴링 0.
      subs.push(app.bus.on(TOWER_LIVE_TOPIC, (p: any) => onLive(p as TowerLiveEvent)));
      subs.push(app.events.on("theme.changed", () => fetchCatalog()));
      subs.push(app.events.on("locale.changed", () => fetchCatalog()));
      void fetchCatalog(); // open 시 1회 — 레지스트리-변경 이벤트가 없으므로 정공법(RULE 7 fallback)
      emit();
    },
    close: () => {
      if (!ov) return;
      for (const off of subs) {
        try {
          off.dispose();
        } catch {
          // 해지 실패 격리.
        }
      }
      subs = [];
      undrag?.();
      undrag = null;
      confirmOv?.remove(); // 진행 중 confirm 도 함께 정리(고아 게이트 0).
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
    toggle: () => (ov ? api.close() : api.open()),
    // dispose — 액션 해지 중 호출되므로 onChange 재렌더를 일으키지 않는다(누수 방지).
    dispose: () => {
      for (const off of subs) {
        try {
          off.dispose();
        } catch {
          /* 격리 */
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
    },
  };
  return api;
}
