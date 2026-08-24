import createTerminalGeometry from '../../utils/terminalGeometry';
import {
  shouldUseNaturalMouseSelection,
  selectionArgsFromCells,
  shouldRouteWheelToPty,
  shouldClearSelectionOnScroll,
} from '../../utils/terminalMouseSelection';
import { copyTextToClipboard, uploadImageAndGetPath, pasteWhenConnected, reportClientError } from './terminalHelpers';
import { uploadWithRetry } from './uploadRetry';
import { getLinkAtClient } from '../../utils/terminalLinkAt';

/**
 * 터미널의 포인터/키보드 배선 — 휠·터치 스크롤 라우팅, 자연스러운 마우스 선택,
 * 붙여넣기(이미지 포함), 컨텍스트 메뉴, 키 가로채기.
 *
 * 전부 DOM 리스너다. detach() 로 한 번에 걷는다.
 */

// SGR 마우스 리포트 버튼 코드 — 휠 위/아래.

/**
 * Keys that switch or drive the OS input method (한/영, 한자, かな, and the `Process`
 * key browsers report mid-composition).
 *
 * These must reach the IME, not the terminal. xterm's key handler consumes the event —
 * and on Windows a consumed keydown means the Hangul key does not toggle, which is the
 * "한영 버튼이 잘 안 눌린다" symptom: it works sometimes (when focus happens to be
 * elsewhere) and not others. We return false so xterm ignores it **without**
 * preventDefault, the same trick the Ctrl+V path uses to let the browser do its job.
 */
export const isImeModeKey = (e) => {
  const key = e?.key;
  const code = e?.code;
  return key === 'HangulMode' || key === 'Hangul' || key === 'HanjaMode' || key === 'Hanja'
    || key === 'KanaMode' || key === 'Convert' || key === 'NonConvert' || key === 'Process'
    || code === 'Lang1' || code === 'Lang2'
    // Legacy numeric codes some Windows keyboards still report (21=Hangul, 25=Hanja).
    || e?.keyCode === 21 || e?.keyCode === 25;
};

const SGR_WHEEL_UP = 64;
const SGR_WHEEL_DOWN = 65;
// 한 이벤트로 보낼 최대 휠 리포트 수 — 트랙패드 관성 스크롤이 tmux 를 익사시키지 않게.
const MAX_WHEEL_REPORTS = { wheel: 12, touch: 8 };

const LONG_PRESS_MS = 500;         // 롱프레스 → 컨텍스트 메뉴
const TOUCH_SCROLL_THRESHOLD_PX = 5;
const DRAG_SELECT_THRESHOLD_PX = 5; // 이만큼 끌어야 선택으로 전환(클릭은 앱으로)
const SELECTION_SETTLE_MS = 80;    // 드래그가 멎고 나서 한 번만 클립보드에 쓴다
const COPY_FLASH_MS = 1800;
const RIGHT_CLICK_MENU_DEDUP_MS = 700;
const IMAGE_TOAST_DONE_MS = 1200;
const IMAGE_TOAST_ERROR_MS = 2500;

const attachTerminalInteractions = ({
  term,
  container,
  overlay,
  input,
  getSocket,
  isMobile,
  sessionId,
  // 원격 pane 이면 붙여넣은 이미지가 **그 호스트에** 올라가야 한다.
  hostId = null,
  logger,
  setContextMenu,
  setCopyFlash,
  setImagePasteState,
}) => {
  const { deltaToLines, cellFromClientPoint, bufferCellFromClientPoint } = createTerminalGeometry(term);

  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };

  /* ── 휠 / 터치 스크롤 라우팅 ──────────────────────────────────────────────
     tmux attach 는 바깥 xterm 을 alternate buffer 로 돌린다 — 이때 xterm 의 로컬
     스크롤백은 진짜 tmux 히스토리를 대변하지 못한다. 그래서 alt-screen 이면 SGR 휠
     리포트를 PTY 로 보내 앱(tmux/vim)이 직접 스크롤하게 한다. 스크롤을 xterm 의
     네이티브 선택/복사보다 우선한다(의도적). */
  let wheelLineRemainder = 0;
  let touchLineRemainder = 0;

  const sendWheelToPty = (lines, clientX, clientY, source) => {
    const ws = getSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN || lines === 0) return;
    const { col, row } = cellFromClientPoint(clientX, clientY);
    const button = lines < 0 ? SGR_WHEEL_UP : SGR_WHEEL_DOWN;
    const count = Math.min(MAX_WHEEL_REPORTS[source] ?? 12, Math.max(1, Math.abs(lines)));
    let payload = '';
    for (let i = 0; i < count; i++) payload += `\x1b[<${button};${col};${row}M`;
    // 즉시 send 하지 않고 입력 큐로 — 트랙패드 스무스 스크롤이 초당 100회를 불러도
    // 다음 flush 틱에 합쳐 1회 전송된다. 키 입력과 같은 경로라 순서도 보존된다.
    input.push(payload);
  };

  const handleScrollDelta = (deltaY, deltaMode, clientX, clientY, source = 'wheel') => {
    const rawLines = deltaToLines(deltaY, deltaMode);
    if (!Number.isFinite(rawLines) || rawLines === 0) return false;

    // 분수 줄을 누적했다가 정수가 될 때만 실제로 스크롤한다(부드러운 스크롤 보존).
    const isTouch = source === 'touch';
    if (isTouch) touchLineRemainder += rawLines;
    else wheelLineRemainder += rawLines;

    const remainder = isTouch ? touchLineRemainder : wheelLineRemainder;
    const lines = Math.trunc(remainder);
    if (isTouch) touchLineRemainder -= lines;
    else wheelLineRemainder -= lines;
    if (lines === 0) return true;

    if (shouldClearSelectionOnScroll({ hasSelection: term.hasSelection(), lines })) {
      try { term.clearSelection(); } catch { /* noop */ }
    }

    const routeToPty = shouldRouteWheelToPty({
      bufferType: term.buffer?.active?.type || 'normal',
      mouseTrackingMode: term.modes?.mouseTrackingMode || 'none',
    });
    if (routeToPty) sendWheelToPty(lines, clientX, clientY, source);
    else {
      try { term.scrollLines(lines); } catch { /* noop */ }
    }
    return true;
  };

  // xterm.d.ts: true = xterm 기본 처리 허용, false = 우리가 처리했으니 중단.
  term.attachCustomWheelEventHandler((e) => {
    handleScrollDelta(e.deltaY, e.deltaMode, e.clientX, e.clientY, 'wheel');
    return false;
  });

  /* ── 붙여넣기 ───────────────────────────────────────────────────────────
     ClipboardEvent.clipboardData 를 쓰므로 clipboard-read 권한이 필요 없다.
     capture 단계에서 xterm 자체 핸들러보다 먼저 잡아 중복 전송을 막는다.
     PTY 는 텍스트만 나르므로 이미지는 서버에 올리고 그 *경로* 를 대신 입력한다. */
  /* 업로드가 막히면 **blob 을 붙잡고 다시 시도한다.** 예전에는 그 순간 이미지를 버려서
     사용자가 다시 복사해 오는 수밖에 없었다 — 정작 원인은 공유 HTTP/2 연결이 막힌 것뿐이고
     WebSocket 은 그동안에도 멀쩡히 살아 있다. 그래서 실패를 그 살아있는 WS 로 서버에
     알린다(reportClientError) — HTTP 가 막힌 상황이라 다른 길이 없다. */
  const uploadPastedImage = async (blob) => {
    const data = await uploadWithRetry({
      attempt: () => uploadImageAndGetPath(blob, hostId),
      onState: (state, err) => {
        if (state === 'done') return;                 // 경로 삽입까지 끝난 뒤에 표시한다
        if (state === 'uploading' || state === 'retrying') {
          setImagePasteState('uploading');
          return;
        }
        logger.error(`image paste upload ${state}`, err);
        reportClientError(getSocket, { scope: 'paste-image', kind: err?.kind || state, detail: err?.detail });
        setImagePasteState(state === 'blocked' ? 'blocked' : 'error');
        later(() => setImagePasteState(null), IMAGE_TOAST_ERROR_MS);
      },
    });
    if (!data) return;
    // ⚠️ 200 을 받은 것과 경로가 셸에 도착한 것은 다른 사건이다. 재연결 중이면 입력 큐가
    // 4초 뒤 그 항목을 버리므로(STALE_INPUT_MS), 넣을 수 있을 때까지 잠깐 기다린다.
    const inserted = await pasteWhenConnected(term, `${data.path} `, getSocket); // 뒤 공백 — 이어서 타이핑할 수 있게
    if (!inserted) {
      logger.error('image paste: upload ok but terminal was not connected');
      setImagePasteState('error');
      later(() => setImagePasteState(null), IMAGE_TOAST_ERROR_MS);
      return;
    }
    // The estimate rides on the toast: cost is only actionable at the moment of pasting.
    setImagePasteState(data.tokens ? { kind: 'done', tokens: data.tokens } : 'done');
    later(() => setImagePasteState(null), IMAGE_TOAST_DONE_MS);
  };

  const handlePaste = (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const imageItem = Array.from(cd.items || []).find(
      (it) => it.kind === 'file' && it.type.startsWith('image/'),
    );
    if (imageItem) {
      const blob = imageItem.getAsFile();
      if (blob) {
        e.preventDefault();
        e.stopPropagation();
        uploadPastedImage(blob);
        return;
      }
    }
    const text = cd.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    term.paste(text);
  };

  /* ── 키 가로채기 ────────────────────────────────────────────────────────── */
  const handleKeyDown = (e) => {
    // Ctrl+Shift+F → 앱 검색(표준 터미널 컨벤션과 별개의 앱 단축키).
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('terminal:open-search', { detail: { sessionId } }));
    }
  };

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (e.key === 'F12') return false; // DevTools 는 브라우저에 양보
    // 한/영·한자 같은 입력기 전환 키는 IME 가 받아야 한다 (preventDefault 하지 않는다).
    if (isImeModeKey(e)) return false;
    /* Ctrl+V / Cmd+V — false 를 돌려 xterm 처리는 막되 preventDefault 는 하지 않는다.
       그러면 브라우저가 paste 이벤트를 발화하고 handlePaste 가 권한 없이 읽는다. */
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'v' || e.key === 'V')) return false;
    // Ctrl+Shift+C (Linux/Win) 또는 Cmd+C (Mac, 선택이 있을 때) → 복사
    if ((e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C'))
        || (e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C'))) {
      const sel = term.getSelection();
      if (sel) {
        e.preventDefault();
        copyTextToClipboard(sel);
        return false;
      }
    }
    return true;
  });

  /* ── 우클릭 메뉴 ────────────────────────────────────────────────────────
     contextmenu 만 막으면 이미 발생한 right-button mousedown 이 xterm 을 통해 원격
     TUI 로 전달돼 앱 자체 메뉴가 터미널 위에 그려진다. mousedown 단계에서 잡는다. */
  let lastRightClickMenuAt = 0;
  const openContextMenuFromEvent = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    lastRightClickMenuAt = Date.now();
    setContextMenu({ x: e.clientX, y: e.clientY, hasSelection: !!term.hasSelection(), linkUrl: getLinkAtClient(term, e.clientX, e.clientY) });
  };
  const handleRightMouseDown = (e) => {
    if (e.button !== 2) return;
    openContextMenuFromEvent(e);
  };
  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    // mousedown 에서 이미 열었으면 뒤따르는 contextmenu 는 무시.
    if (Date.now() - lastRightClickMenuAt < RIGHT_CLICK_MENU_DEDUP_MS) return;
    openContextMenuFromEvent(e);
  };

  /* ── 선택 → 자동 복사 ───────────────────────────────────────────────────
     드래그 중 mousemove 마다 onSelectionChange 가 터진다. 멎은 뒤 한 번만 쓴다. */
  let selectionTimer = null;
  let copyFlashTimer = null;
  let lastCopied = '';

  /**
   * ⚠️ **The clipboard write has to happen inside the user's gesture.**
   *
   * This used to fire from a settle timer, which means no transient activation by the
   * time it ran. Chrome usually lets that through (it grants clipboard-write to the
   * focused tab), but Firefox refuses it outright, and Chrome itself refuses when the
   * document is not focused — and the `execCommand` fallback needs a gesture too. So on
   * some machines selecting text simply never copied, while the UI flashed "copied"
   * every time because the old code ignored the return value.
   *
   * Now the copy runs from mouseup/keyup — still within the gesture that made the
   * selection — and the flash is shown **only if it actually landed**.
   */
  const copySelection = async () => {
    const selection = term.getSelection();
    // 모바일은 자동 복사가 선택 핸들 조작을 방해하므로 PC 에서만.
    if (!selection || isMobile()) return;
    if (selection === lastCopied) return;          // 같은 선택을 두 번 쓰지 않는다
    const ok = await copyTextToClipboard(selection);
    if (!ok) {
      // 거짓 성공을 띄우지 않는다. 선택은 그대로 두므로 사용자가 Ctrl+C 로 이어갈 수 있다.
      logger.error('selection copy was refused by the browser');
      return;
    }
    lastCopied = selection;
    setCopyFlash(true);
    if (copyFlashTimer) clearTimeout(copyFlashTimer);
    copyFlashTimer = setTimeout(() => setCopyFlash(false), COPY_FLASH_MS);
  };

  term.onSelectionChange(() => {
    if (!term.getSelection()) lastCopied = '';
    if (selectionTimer) clearTimeout(selectionTimer);
    /* The timer stays as a backstop for selections no gesture of ours sees (xterm's own
       double/triple-click paths, programmatic selects). It runs late and may be refused;
       the gesture path above is the one that normally wins. */
    selectionTimer = setTimeout(copySelection, SELECTION_SETTLE_MS);
  });

  /* ── 자연스러운 마우스 선택 ─────────────────────────────────────────────
     tmux/vim 이 마우스 트래킹을 켜도 PC 기본 UX 는 지킨다: 클릭은 앱으로 보내고,
     plain left-drag 가 임계값을 넘는 순간부터만 xterm 선택으로 전환한다. */
  let naturalSelection = null;
  const handleNaturalMouseDown = (e) => {
    const screen = term.element?.querySelector('.xterm-screen');
    if (!screen?.contains(e.target)) {
      naturalSelection = null;
      return;
    }
    if (!shouldUseNaturalMouseSelection({
      event: e,
      isMobile: isMobile(),
      mouseTrackingMode: term.modes?.mouseTrackingMode || 'none',
    })) {
      naturalSelection = null;
      return;
    }
    naturalSelection = {
      startX: e.clientX,
      startY: e.clientY,
      start: bufferCellFromClientPoint(e.clientX, e.clientY),
      selecting: false,
    };
  };
  const handleNaturalMouseMove = (e) => {
    if (!naturalSelection || (e.buttons & 1) !== 1) return;
    const dx = Math.abs(e.clientX - naturalSelection.startX);
    const dy = Math.abs(e.clientY - naturalSelection.startY);
    if (!naturalSelection.selecting && Math.max(dx, dy) < DRAG_SELECT_THRESHOLD_PX) return;
    naturalSelection.selecting = true;
    e.preventDefault();
    e.stopPropagation();
    const args = selectionArgsFromCells(
      naturalSelection.start,
      bufferCellFromClientPoint(e.clientX, e.clientY),
      term.cols,
    );
    if (args) term.select(args.column, args.row, args.length);
  };
  const handleNaturalMouseUp = (e) => {
    if (!naturalSelection) return;
    if (naturalSelection.selecting) {
      e.preventDefault();
      e.stopPropagation();
    }
    naturalSelection = null;
  };

  /* Any mouse-up over the terminal ends a selection gesture — including xterm's own
     drag, which we do not route through `naturalSelection`. This is the moment the
     clipboard is still allowed to be written to. */
  const handleSelectionGestureEnd = () => {
    if (selectionTimer) clearTimeout(selectionTimer);
    copySelection();
  };

  /* ── 모바일 터치 ────────────────────────────────────────────────────────
     오버레이 div 가 canvas 위에서 터치를 독점한다. touch-action:none 이 걸려 있어
     iOS 가 스크롤 제스처를 선점하지 않고, passive:false 라 preventDefault 가 먹는다. */
  let touchStartX = 0;
  let touchStartY = 0;
  let isTouchScrolling = false;
  let longPressFired = false;
  let longPressTimer = null;

  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isTouchScrolling = false;
    longPressFired = false;
    longPressTimer = setTimeout(() => {
      if (isTouchScrolling) return;
      longPressFired = true;
      setContextMenu({ x: touchStartX, y: touchStartY, hasSelection: !!term.hasSelection(), linkUrl: getLinkAtClient(term, touchStartX, touchStartY) });
    }, LONG_PRESS_MS);
  };

  const handleTouchMove = (e) => {
    if (e.touches.length !== 1) return;
    clearTimeout(longPressTimer);
    const dy = touchStartY - e.touches[0].clientY; // 양수 = 손가락 위로
    const dx = Math.abs(e.touches[0].clientX - touchStartX);

    if (!isTouchScrolling) {
      // 세로 우세 제스처만 스크롤로 친다.
      if (Math.abs(dy) > TOUCH_SCROLL_THRESHOLD_PX && Math.abs(dy) > dx) isTouchScrolling = true;
      else return;
    }

    e.preventDefault();
    touchStartY = e.touches[0].clientY;
    handleScrollDelta(dy, 0, e.touches[0].clientX, e.touches[0].clientY, 'touch');
  };

  const handleTouchEnd = () => {
    clearTimeout(longPressTimer);
    /* 짧은 탭(스크롤도 롱프레스도 아님) → 포커스해서 iOS 키보드를 올린다.
       touchstart 에서 preventDefault 했으므로 합성 click 이 안 온다 — 여기서 직접,
       사용자 제스처 컨텍스트 안에서 focus 해야 키보드가 뜬다. */
    if (!isTouchScrolling && !longPressFired) term.focus();
  };

  const blockContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // ── 배선 ──
  container.addEventListener('mousedown', handleRightMouseDown, true);
  container.addEventListener('contextmenu', handleContextMenu, true);
  container.addEventListener('keydown', handleKeyDown);
  container.addEventListener('paste', handlePaste, true);
  container.addEventListener('mousedown', handleNaturalMouseDown, true);
  container.addEventListener('touchstart', handleTouchStart, { passive: false });
  container.addEventListener('touchend', handleTouchEnd, { passive: true });
  document.addEventListener('mousemove', handleNaturalMouseMove, true);
  document.addEventListener('mouseup', handleNaturalMouseUp, true);
  // Bubble phase, after xterm has finished updating its selection.
  document.addEventListener('mouseup', handleSelectionGestureEnd);
  document.addEventListener('keyup', handleSelectionGestureEnd);

  if (overlay) {
    overlay.addEventListener('contextmenu', blockContextMenu);
    overlay.addEventListener('touchstart', handleTouchStart, { passive: false });
    overlay.addEventListener('touchmove', handleTouchMove, { passive: false });
    overlay.addEventListener('touchend', handleTouchEnd, { passive: true });
  }

  return {
    detach: () => {
      container.removeEventListener('mousedown', handleRightMouseDown, true);
      container.removeEventListener('contextmenu', handleContextMenu, true);
      container.removeEventListener('keydown', handleKeyDown);
      container.removeEventListener('paste', handlePaste, true);
      container.removeEventListener('mousedown', handleNaturalMouseDown, true);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('mousemove', handleNaturalMouseMove, true);
      document.removeEventListener('mouseup', handleNaturalMouseUp, true);
      document.removeEventListener('mouseup', handleSelectionGestureEnd);
      document.removeEventListener('keyup', handleSelectionGestureEnd);

      if (overlay) {
        overlay.removeEventListener('contextmenu', blockContextMenu);
        overlay.removeEventListener('touchstart', handleTouchStart);
        overlay.removeEventListener('touchmove', handleTouchMove);
        overlay.removeEventListener('touchend', handleTouchEnd);
      }

      if (selectionTimer) clearTimeout(selectionTimer);
      if (copyFlashTimer) clearTimeout(copyFlashTimer);
      if (longPressTimer) clearTimeout(longPressTimer);
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
};

export default attachTerminalInteractions;
