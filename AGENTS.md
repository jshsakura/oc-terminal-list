# AGENTS.md

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

## General

- Build command: `cd frontend && npx vite build`
- Test command: `cd frontend && npx vitest run`
