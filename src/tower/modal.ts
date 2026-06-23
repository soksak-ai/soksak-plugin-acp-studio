// 타워 모달 셸 — AI-명령 모달의 얇은 컨테이너(M2: 빈 셸). 내용물(NL 바·예시행·팔레트·검색·라이브칸)은
//   M3 가 채운다. 여기서는 560px 드래그 가능 오버레이 + 헤더(✦ AI 명령 · 드래그 그립 · ✕) + 빈 본문만.
//
// 코어 변경 0. 호스트 테마 변수(--card/--bd/--acc/--fg)만 사용 → 5테마 per-theme 코드 0.
// document.body 직속(뷰 컨테이너 밖)이라 코어 catalogDom.collectExposed 가 호스트 크롬으로 수집:
//   data-node="tower/modal" → 주소 win/<win>/chrome/tower/modal,  "tower/close" → .../chrome/tower/close.
//   각 [data-node] 는 독립 평면 주소(코어가 el.dataset.node 를 그대로 chrome/<path> 로 노출).
// Clubhouse content 탭은 건드리지 않는다(별도 DOM, additive).

const STYLE_ID = "tower-modal-style";
const CSS = `
.tower-ov{position:fixed;left:50%;top:76px;transform:translateX(-50%);width:560px;max-width:calc(100vw - 32px);
  z-index:9001;background:var(--card,#262626);color:var(--fg,#e6e6e6);border:1px solid var(--bd,#3a3a3a);
  border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.3);
  font:13px system-ui,-apple-system,sans-serif;overflow:hidden;display:flex;flex-direction:column}
.tower-hd{display:flex;align-items:center;gap:8px;padding:11px 13px;border-bottom:1px solid var(--bd,#3a3a3a);
  cursor:grab;user-select:none;flex:0 0 auto}
.tower-hd.drag{cursor:grabbing}
.tower-mk{display:inline-flex;align-items:center;color:var(--acc,#7aa2f7)}
.tower-tt{font-weight:700;letter-spacing:.01em;flex:1 1 auto;white-space:nowrap}
.tower-grip{opacity:.4;letter-spacing:2px;font-size:11px;cursor:grab;user-select:none}
.tower-x{appearance:none;border:0;background:transparent;color:inherit;opacity:.6;cursor:pointer;
  font-size:15px;line-height:1;padding:3px 6px;border-radius:6px}
.tower-x:hover{opacity:1;background:var(--inset,rgba(127,127,127,.14))}
.tower-bd{padding:14px;min-height:96px}
`;

const ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" /></svg>';

export interface TowerModal {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  dispose: () => void;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
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
    // 창 경계 내로 clamp(완전 화면 밖 이탈 방지).
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
    // 닫기 버튼 등 인터랙티브 요소에서 시작한 드래그는 무시.
    if ((e.target as HTMLElement).closest(".tower-x")) return;
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

// onChange — 모달 열림/닫힘 상태가 바뀔 때마다 호출(이벤트-우선). 호출원(클릭·닫기버튼·프로그램)
//   무관하게 헤더 액션의 active 를 동기화하는 단일 채널 — 폴링 없음.
export function createTowerModal(title: string, onChange?: () => void): TowerModal {
  ensureStyle();
  let ov: HTMLElement | null = null;
  let undrag: (() => void) | null = null;
  const emit = () => {
    try {
      onChange?.();
    } catch {
      // 구독자 실패 격리.
    }
  };

  const build = (): HTMLElement => {
    const root = document.createElement("div");
    root.className = "tower-ov";
    root.dataset.node = "tower/modal"; // 호스트 크롬 주소: chrome/tower/modal

    const hd = document.createElement("div");
    hd.className = "tower-hd";

    const mk = document.createElement("span");
    mk.className = "tower-mk";
    mk.innerHTML = ICON;

    const tt = document.createElement("span");
    tt.className = "tower-tt";
    tt.textContent = title;

    const grip = document.createElement("span");
    grip.className = "tower-grip";
    grip.textContent = "⠿";

    const x = document.createElement("button");
    x.type = "button";
    x.className = "tower-x";
    x.textContent = "✕";
    x.title = "닫기";
    x.dataset.node = "tower/close"; // 호스트 크롬 주소: chrome/tower/close
    x.addEventListener("click", () => api.close());

    hd.append(mk, tt, grip, x);

    const bd = document.createElement("div");
    bd.className = "tower-bd";
    bd.dataset.node = "tower/body"; // 빈 본문(M3 가 채움) — 노출만 선언

    root.append(hd, bd);
    undrag = makeDraggable(root, hd);
    return root;
  };

  const api: TowerModal = {
    isOpen: () => ov != null,
    open: () => {
      if (ov) return;
      ov = build();
      document.body.appendChild(ov);
      emit();
    },
    close: () => {
      if (!ov) return;
      undrag?.();
      undrag = null;
      ov.remove();
      ov = null;
      emit();
    },
    toggle: () => (ov ? api.close() : api.open()),
    // dispose — 액션 해지 중 호출되므로 onChange 재렌더를 일으키지 않는다(누수 방지).
    dispose: () => {
      undrag?.();
      undrag = null;
      ov?.remove();
      ov = null;
    },
  };
  return api;
}
