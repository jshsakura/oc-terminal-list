# 디자인 가이드

Terminal List 프론트엔드의 시각/구조 규칙. 새 컴포넌트를 추가하거나 기존을 고칠 때 이 문서의 규칙을 따른다.

## 1. 디자인 토큰 — 단일 진실의 출처

`frontend/src/styles/tokens.js` 가 모든 색·간격·타이포·반경·모션의 원본이다.

- **색**: `var(--ui-*)` CSS 변수를 가리키므로 `ThemeProvider` 가 `:root` 변수만 갱신해도 전체 UI 가 즉시 테마 따라감 (React 리렌더 없음).
- **간격(`space`)**: 4px 그리드 (`space['1']`=4px ... `space['5']`=20px).
- **반경(`radius`)**: `xs`(3) / `sm`(6) / `lg`(10) / `full`.
- **모션(`motion`)**: `fast`(120ms) — hover/focus 전이용.

새 색·간격을 하드코딩하지 말고 토큰을 추가하거나 가까운 기존 토큰을 쓴다.

## 2. 색 톤 — 의미로 묶기

- `accent` — primary 액션, 강조(예: ⌘ Quick Input).
- `success` / `warning` / `danger` / `info` — 결과 상태.
- `muted` / `faint` — 비활성, 보조 정보.
- `tone` 옵션 (모바일 단축키 등): `accent | danger | muted | (default)`.

`^C` 같은 파괴적 키는 `tone: 'danger'`. 자주 쓰는 헬퍼 키는 `tone: 'muted'`. 디폴트는 별도 표기 없음.

## 3. 모달 패턴

**중앙 오버레이를 표준으로** 한다. bottom-anchored popover 는 모바일 키보드 + safe-area 와 충돌해서 화면 점유율이 의도와 달라지므로 쓰지 않는다.

```js
overlay: {
  position: 'fixed', inset: 0,
  background: color.scrim,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 10001,
  backdropFilter: 'blur(2px)',
}
modal: {
  width: '90%', maxWidth: 380~520,   // 컨텐츠 양에 따라
  maxHeight: '80vh',                 // 작은 폼은 무지정 (auto-fit)
  background: color.base,
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  boxShadow: shadow.lg,
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
}
```

크기 가이드:
- 짧은 확인/알림 → `maxWidth: 380px`, height auto.
- 입력 1~2개 → `maxWidth: 420px`, height auto.
- 다중 섹션 폼 → `maxWidth: 520px`, `height: 88vh` 또는 `maxHeight: 80vh`.

backdrop 클릭으로 닫기. 내부 `onClick={(e) => e.stopPropagation()}`. ESC 도 닫기.

## 4. Settings 모달

탭 구조: `[General] [Mobile] [Hosts] [SSH Keys]`

- **General / Mobile** — 사용자 설정 편집, footer 가 `[Reset] [Cancel] [Save]`.
- **Hosts / SSH Keys** — 별도 modal flow 로 진입하는 인덱스 뷰, footer 는 카운트 + `[Close]`.

탭 분기는 `SETTINGS_TABS = new Set(['general', 'mobile'])` 으로 footer 가 어느 모드인지 결정.

모바일 전용 항목 (`fontSizeMobile`, `mobileKeys`) 은 General 에 섞지 않고 **Mobile 탭에 모은다**.

## 5. 모바일 단축키 바 — 데이터 모델

`utils/mobileKeys.js` 의 `DEFAULT_MOBILE_KEYS` 가 디폴트 구성. 모델:

```ts
{ id, kind, label?, payload?, modifier?, tone? }
kind: 'send' | 'mod' | 'cmdInput' | 'paste' | 'sep'
```

- `send` — `payload` 를 raw bytes 로 PTY 에 전송.
- `mod` — `modifier` ('ctrl'|'alt') 토글, 다음 send 키에 1회 적용.
- `cmdInput` — Quick Input 모달 오픈.
- `paste` — 클립보드 붙여넣기.
- `sep` — 구분선.

**그룹 규칙**: 비파괴 키와 파괴적 키는 같은 sep 그룹에 섞지 않는다. 디폴트 배치:

```
⌘ | ←↑↓→ | ESC TAB | CTRL ALT | ^C 📋
```

`^C` 는 `tone: 'danger'` 로 마지막 그룹에 위치. `⌫` 라벨에 `\x15`(Ctrl+U) 를 넣지 않는다 — 라벨/페이로드 의미 일치 원칙.

## 6. MobileKeysEditor — 편집기 레이아웃

좁은 모달(360~520px)과 모바일 뷰포트(<360px) 모두에서 깨지지 않도록 **2-row** 구조:

```
┌──────────────────────────────────────────┐
│ [kind ▼] [label........]   [↑] [↓] [🗑]   │  ← 1행 (sep 행은 여기까지)
│ [payload | modifier ▼]      [tone ▼]      │  ← 2행 (kind 별 가변)
└──────────────────────────────────────────┘
```

- `kind` 는 select(편집 가능). 변경 시 `morphForKind()` 가 종류별 필수 필드를 보정 (label 은 사용자 입력 우선).
- `tone` 은 항상 2행 우측 (1행에 두면 좁은 폭에서 깨짐).
- 액션: `[+ Add empty]` `[Presets ▾]` `[↺ Restore]` 3버튼. 프리셋만 토글 — Add 흐름과 분리해 산만함 제거.

## 7. 탭 / Pane 닫기 시맨틱

- **마지막 1개 pane** 닫기 = `closeTab(tabId)` 위임. 빈 picker 만 남기는 자투리 상태를 만들지 않는다.
- **다중 pane** 중 하나 닫기 = pane 만 제거, 레이아웃 재배열.
- 빈 pane (picker 상태) 은 **분할 시(splitPane)** 의 정상 상태 — 닫기 단계에서 만들어지는 게 아니다.
- tmux off 호스트는 작업 소실 경고 메시지로 분기.

## 8. i18n 규칙

- 모든 사용자-노출 텍스트는 `frontend/src/i18n/locales.js` 의 `en` / `ko` 양쪽에 추가.
- 컴포넌트는 `t?.(key, fallback)` 패턴으로 fallback 을 명시 — 키 누락 시에도 깨지지 않게.
- 라벨 키 접두 컨벤션: `kind*`, `tone*`, `field*`, `confirm*`, `theme*`, `language*`.

## 9. 아이콘 vs 이모지

**이모지 금지**. 이모지는 OS/폰트마다 렌더링 편차가 크고 톤(색상)을 토큰으로 제어할 수 없다. 모든 시각 심볼은 `lucide-react` 아이콘으로 통일.

- `paste` → `ClipboardPaste`
- `cmdInput` (Quick Input) → `Command`
- 영속 세션 표시 → `Anchor`
- 사용자가 직접 라벨을 적는 `send` 키는 텍스트 그대로 (`←`, `↑`, `^C` 등은 유니코드 글리프, 이모지 아님 — 허용).

## 10. 상단 정렬

`TabBar` 와 `Sidebar.activityBar` 의 첫 행은 동일한 y-축 라인에서 끝나야 한다.

- TabBar: `height: 34px`, **바닥 실선 없음**(§14 — 면 차이가 경계를 대신한다).
- ActivityBar: `paddingTop: 2`, 첫 RailIconBtn `height: 32px` → 34px 라인에서 동일하게 끝남.
- ActivityBar 폭은 `36px` (TabBar 의 brandBtn 너비와 정렬).

이 규칙을 깨면 사이드바와 탭바가 따로 노는 시각적 어긋남이 발생한다.

## 14. 면의 방향 — 크롬은 콘텐츠 위로 뜬다 (2026-07-31)

`styles/themeUI.js` 다크 분기가 이 규칙의 유일한 출처다. **터미널(base)이 가장 깊은 면이고,
그것을 감싸는 크롬이 그 위로 뜬다.**

| 층 | 값 | 쓰이는 곳 |
|---|---|---|
| `base` | 테마 배경 | 터미널(콘텐츠) |
| `crust` | +6% | 탭바·서브탭바·사이드바 바탕 |
| `surface0` | +10% | hover, 비활성 칩의 기준 |
| `surface1` | +14.5% | 팝오버/입력 |
| `surface2` | +20% | 활성 칩 |

이전엔 crust/mantle 을 bg 에서 **검정 쪽으로 25~40% 깎아** 크롬을 콘텐츠보다 눌렀다(Zed/VSCode 관행).
그러면 크롬이 거의 순검정이 되고 그 위에 밝은 글자가 올라가 대비가 18:1 근처까지 벌어진다 —
"고대비 모드" 같은 투박한 인상의 정체였다. 되돌리지 말 것.

사다리는 **단조 증가**여야 한다. hover(surface0)가 크롬 바닥(crust)보다 확실히 밝지 않으면
반응이 안 읽힌다.

## 15. 탭 = 칩 (상자 보더 없음)

탭은 4면 보더로 그린 상자가 아니라 바 위에 얹힌 **칩**이다. 경계는 선이 아니라 면과 틈이 만든다.

- **3단계**: 바(`crust`) < 비활성 칩(`surface0` 55% 혼합 ≈ +8.2%) < 활성 칩(`surface2`).
  비활성을 투명으로 두면 탭이 가로를 채울 때 경계가 통째로 사라져 상자 시절보다 나빠진다.
  반대로 비활성을 또렷하게 칠하면 탭 줄 전체가 무거워진다 — "면이 있다" 정도만.
- **굵기는 고정**(`medium`). 활성 표시는 면과 글자색이 한다. 굵기가 바뀌면 탭을 옮길 때마다
  라벨 폭이 흔들린다.
- **히트 영역과 칩은 분리**한다 (`tabHit` / `tab`). 바깥이 바 높이(34px)를 채워 터치 타깃을
  유지하고, 안쪽 칩만 24px 로 얇다. 칩 크기로 히트 영역까지 줄이면 위아래 띠와 칩 사이 틈이
  아무 탭에도 안 속해 헛눌림이 난다 (모바일에서 특히).
- **폭은 균일 고정** (`0 1 156px`). 내용 맞춤(`0 1 auto`)으로 두면 **활성 탭에만 뜨는 `⋯` 버튼**
  때문에 탭을 고를 때마다 폭이 17px 씩 요동친다. 늘림(`1 1 auto`)은 바를 빈틈없는 덩어리로 만든다.
- 칩 안쪽 여백은 사방 5px, 칩 사이 4px, 탭 스트립 양 끝에만 짧은 세로 rule(`railDivider`) — 좌우 대칭.

## 15-1. 면 차이는 최소 대비를 보장하지 않는다 (2026-07-31)

`themeUI` 의 층은 **배경에서 흰색 쪽으로 몇 %** 로 만들어진다. 그 차이는 테마 배경에
비례하므로, 배경이 밝거나 저대비인 테마에서는 인접 두 층이 사실상 같은 색이 된다.
실제로 메인 탭바(crust +6%)와 서브탭바(mantle +3.5%)가 어떤 테마에서 구분이 사라졌다.

규칙: **크롬 층이 맞닿는 경계 중 어느 테마에서도 사라지면 안 되는 곳에는 hairline 을 둔다.**
면으로 충분한 곳(칩 vs 바, 크롬 vs 콘텐츠)엔 여전히 선을 긋지 않는다 — §15 는 유효하다.
지금 그 예외는 서브탭바의 `borderTop` 하나뿐이다.

## 16. 숫자 타일과 pane 주소

- 탭/서브탭의 번호는 `styles/numberTile.js` 한 곳에서 나온다. 크기는 **옆 아이콘 타일과 같은
  변수**를 봐야 한다(`tileSize`, `SUB_ICON_PX`) — 숫자를 손으로 맞춰두면 아이콘만 조정할 때 어긋난다.
- **배경 위에 배경을 겹치지 않는다.** 서브탭 번호와 pane 주소 배지는 이미 칩/배지라는 면 위에
  있으므로 숫자에 또 상자를 두르지 않는다. 그러면 왼쪽만 패딩이 두 겹으로 쌓여 숫자가 밀려 보인다.
- pane 주소(`PaneAddressLabel`)는 **탭.pane 한 쌍**을 옅은 1px 구분선으로 끊어 한 덩어리로 보여준다
  (`1｜3`). 점 찍은 문자열(`1.3`)은 터미널 출력 숫자에 섞여 안 읽힌다.
- 이름은 `utils/paneLabel.js` 의 `derivePaneLabel` 로 뽑는다 — 모바일 서브탭바와 pane 배지가
  **같은 함수**를 써야 한다. 두 곳이 다른 이름을 말하면 주소로 부를 수가 없다.

## 11. Rail 아이콘 버튼 (TabBar 상단 액션 / RightPanel 우측 활동바)

`components/common/RailIconBtn.jsx` — 모든 chrome rail 의 단일 진실의 출처. TabBar 상단 액션 그룹과 RightPanel 우측 활동바가 같은 컴포넌트를 쓴다 (이전엔 두 곳이 따로 정의돼 미묘하게 어긋남).

| 항목 | 값 |
|---|---|
| 외부 hit-area | 32×32 |
| inner box | 24×24, `borderRadius: radius.sm` (6px) |
| 아이콘 | `size={15}` `strokeWidth={1.8}` |
| 색상 base | `color.subtext` |
| 호버 | inner bg `surface0`, color `text` |
| 활성 | inner bg `surface1`, color `accent` (border-left 같은 부속 표식 안 씀) |
| 트랜지션 | `motion.fast` (120ms) |
| 배지 | inner box 우상단, accent 배경, `mantle` ring 1.5px |

다른 곳에서 chrome 버튼이 필요하면 이 컴포넌트를 쓰지, 새로 inline 으로 작성하지 않는다.

## 12. 영속 세션 표시

탭 라벨 우측에 작은 `Anchor` 아이콘 (10px, muted 컬러). 표시 조건:

- `tab.type === 'local'` — 로컬 셸은 항상 tmux backed.
- `tab.type === 'host'` 이고 호스트의 `use_remote_tmux === true`.

App.jsx 가 `tabsWithMeta` 로 `isPersistent` derived field 를 미리 계산해 TabBar 에 넘긴다. TabBar 는 hosts 를 직접 알 필요 없음.

## 13. 안 하는 것

- bottom-anchored popover (CommandInput 등) — safe-area + 모바일 키보드와 충돌.
- 모달 안에 또 다른 모달의 별도 backdrop (z-index 카오스 방지).
- 탭마다 다른 footer 시각 스타일 — 동일 footer 슬롯에 액션만 분기.
- 의미 없는 단축키를 디폴트에 넣기 (라벨/페이로드 일치).
- 이모지 (위 §9 참조).
