# AGENTS.md

Terminal List — 브라우저 기반 다중 pane 터미널 매니저. React(Vite) + FastAPI.

## 어디부터 읽나

| 하려는 일 | 읽을 것 |
|---|---|
| **설치·실행·설정** | [`README.md`](./README.md) (한국어: [`README.ko.md`](./README.ko.md)) |
| **코드를 고친다** | [`CLAUDE.md`](./CLAUDE.md) — 이 저장소가 실제로 밟은 함정과 그 규칙들. 길지만 대부분이 "왜 이렇게 되어 있는지" 라, 건드릴 영역의 절을 먼저 찾아 읽는 편이 빠르다 |
| **운영(백업·키 회전·2FA)** | [`deploy/README.md`](./deploy/README.md) |
| UI 컨텍스트 메뉴를 만든다 | 이 파일 아래쪽 규칙 |

## 처음 30초

```bash
docker compose up -d && open http://localhost:38822   # 가장 빠름. .env 없이 그대로 된다
```

개발용으로 띄우려면:

```bash
python run.py          # 백엔드(reload) + vite dev server 를 같이 띄운다
```

## 명령

```bash
cd backend  && ../.venv/bin/python -m pytest -q   # 백엔드 테스트
cd frontend && npx vitest run                     # 프론트 테스트
cd frontend && npx vite build                     # 프론트 빌드
cd backend  && ruff check .                       # 린트 (line-length 120)
```

## 이 저장소에서 반드시 알아야 할 것

- **백엔드는 LLM API 를 부르지 않는다.** 터미널 stdin/stdout 만 라우팅하는 벤더 중립 설계다.
  에이전트 관련 기능(상태 감지 등)도 tmux pane 제목 파싱이지 추론이 아니다.
- **새 엔드포인트는 `backend/routes/*.py` 에.** `main.py` 는 앱 객체·미들웨어·lifespan·
  라우터 등록만 갖는다. **등록 순서가 곧 매칭 우선순위**라 순서를 바꾸면 조용히 라우팅이 깨진다.
- **주석은 영문, 커밋 메시지와 UI 문구는 한국어.**
- **tmux 세션은 백엔드보다 오래 산다**(`KillMode=process`). 재시작해도 사용자 셸은 살아있다.
- 재연결·성능 관련 코드는 지뢰밭이다. 손대기 전에 CLAUDE.md 의 해당 절을 읽을 것 —
  거기 적힌 함정은 전부 실제로 밟은 것들이다.

## Context Menu Pattern Rules

### 1. Position-measurement opacity trick — always use explicit `measured` state

When a context menu needs to measure its own size before adjusting position (viewport clamping), use a `measured` boolean state. Never derive visibility from `ref.current` truthiness.

```jsx
const [measured, setMeasured] = useState(false);
useEffect(() => {
  if (ref.current) {
    // ... position clamping ...
    setPos({ x: nextX, y: nextY });
    setMeasured(true);
  }
}, [x, y]);
// style: opacity: measured ? 1 : 0
```

**Why:** `pos === ctx && ref.current ? 0 : 1` breaks when position needs no adjustment — `ref.current` is already set after first render, causing opacity to flip to 0 on the effect-triggered re-render. The menu appears for one frame then vanishes.

### 2. Stable event listeners — use ref for callbacks in useEffect

When registering global `document`/`window` event listeners (mousedown, keydown) for closing context menus, store `onClose` in a ref and use an empty dependency array `[]`. Never put inline callbacks in the dep array.

```jsx
const onCloseRef = useRef(onClose);
onCloseRef.current = onClose;
useEffect(() => {
  const handle = (e) => { if (!ref.current?.contains(e.target)) onCloseRef.current(); };
  document.addEventListener('mousedown', handle);
  return () => document.removeEventListener('mousedown', handle);
}, []);
```

**Why:** Inline `onClose={() => setContextMenu(null)}` creates a new reference every render, causing the effect to re-run and briefly remove all listeners. With frequent parent re-renders (e.g. busy terminal status), listeners are constantly torn down and re-attached, creating timing windows for missed events or premature closures.

### 3. Use `setTimeout(fn, 0)` when adding listeners on mount

When a context menu mounts in response to a click/contextmenu event, defer listener attachment by one tick to avoid the opening event itself triggering the close handler.

```jsx
useEffect(() => {
  const id = setTimeout(() => {
    document.addEventListener('mousedown', handle);
  }, 0);
  return () => { clearTimeout(id); document.removeEventListener('mousedown', handle); };
}, []);
```
