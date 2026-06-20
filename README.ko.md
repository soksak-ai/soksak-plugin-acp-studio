# soksak-plugin-acp-studio

여러 AI 코딩 에이전트(Claude·Codex)를 한 워크스페이스에서 **하나의 대화**로 협업시키는 soksak 플러그인.
ACP(Agent Client Protocol) 기반, `soksak-plugin-acp-core`(엔진) 의존.

참여 모델을 체크박스로 선택, 탭 순서로 정렬, 세 가지 대화 모드로 협업해 실파일 작업. 동료 직접 호출은
본문 `@이름` 한 채널로 단일화한다.

> Gemini 는 임시 비활성(hidden): gemini-cli 서비스 종료 + antigravity-cli ACP 미구현. 경로 복구 시 부활.

## 대화 모드 (세 성격)

- **진행** (기본) — 진행자(👑, 탭에서 지정)가 사람의 단일 창구. 동료를 `@지목`·동시(다 같이)·순차(차례로)로
  조율하고, 매 stall(동료 응답 완료)마다 종료를 판단한다. 진행자가 아무도 안 부르면 마무리(자연 종료). 하드
  라운드 상한으로 무한 불가.
- **순차** — 탭 순서로 각 1회씩 발언 후 멈춤. 공평·빠짐없는 커버리지.
- **동시** — 전원이 같은 맥락(스냅샷)을 보고 병렬로 한 번씩. 서로의 답은 못 봄(앵커링 0·groupthink 0).

사람은 언제나 최우선 참견(진행 발화 중단 → 부분응답 종결 보존 → 입력 주입 → 재구동). 세션 오류(순단 포함)
나는 에이전트는 자동으로 체크 해제된다(사람이 다시 체크해 재소환).

## @지목

입력창에서 `@` 를 치면 체크된 참가 모델 자동완성 팝업(↑↓·Enter·Esc). `@모델`이 있으면 모드와 무관하게 그
모델에게 직행한다 — 여럿이면 동시(병렬), 하나면 그 모델만. 진행 모드의 진행자도 우회한다.

## 커맨드(헤드리스·CLI/MCP)

- `send` — 활성 Studio 에 사람 메시지 전송(라이브 구동·참견). `mode` 로 전송 전 모드 전환(E2E).
- `state` — 활성 Studio 라이브 상태(모드·진행자·대화 수·진행 중 발화의 스트리밍 길이 — 관찰·E2E).
- `ask` — 단일 에이전트 1회.
- `converse` — 다중 에이전트 1교환(각 1회). `agents`는 preset id 또는 `{id,cmd,args}`(E2E 런치).

## 설정

권한 요청 정책 · 대화 기본 모드(진행/순차/동시) · `@`연쇄 상한 · 진행 모드 라운드 상한.

## 개발

```
npm install
npm run typecheck && npm run test && npm run build
```

순수 로직(`conversation.ts`)은 vitest 단위검증, 통합은 노출 커맨드(`send`/`state`) + `window.snapshot`
화면 캡처로 검증한다. `host-contract.test.ts`는 호스트 크롬 표준 준수 게이트.

## DOM 노출 (구조적 주소)

외부(주소 클릭/측정·E2E)에 노출하는 DOM 노드를 `plugin.json` `contributes.nodes` 에 선언한다 — 동의 화면에
표기되고, 실제 요소엔 `data-node` 로 인스턴스 부여. 노출 안 된 요소는 접근 불가(`NOT_EXPOSED`).

| 노드 | data-node | 설명 |
|---|---|---|
| `send` | `send` | 전송 버튼 |
| `input` | `input` | 메시지 입력 |
| `tab` | `tab/<agentId>` | 에이전트 탭(체크·드래그) |

주소 예: `content/view/soksak-plugin-acp-studio.studio/node/send`. `sok ui.tree` 로 현재 노출 노드 확인.
