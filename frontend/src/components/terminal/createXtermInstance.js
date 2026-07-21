import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ImageAddon } from '@xterm/addon-image';
import { normalizeTerminalFontFamily } from '../../utils/terminalFonts';
import { measureTerminalFit } from '../../utils/terminalFit';
import { PredictiveEcho } from '../../utils/predictiveEcho';
import { reportTerminalTitle } from '../../utils/agentStatusStore';
import { WASM_ALLOWED } from './terminalConstants';

// 글자 대비 설정 → xterm minimumContrastRatio.
// high=또렷(저대비 색 자동 보정, 가독성 최대) / original=테마 팔레트 그대로(1=보정 없음).
const CONTRAST_RATIOS = { high: 7, balanced: 4.5, original: 1 };
export const resolveContrast = (mode) => CONTRAST_RATIOS[mode] ?? 7;

const SCROLLBACK_LINES = 3000;
const SMOOTH_SCROLL_MS = 100;

/**
 * xterm 인스턴스 + 애드온 한 벌을 만들어 컨테이너에 붙인다.
 * 여기서는 *만들기만* 한다 — 이벤트 배선과 WS 연결은 호출부가 한다.
 *
 * @returns {{ term, fitAddon, searchAddon, predictiveEcho }}
 */
const createXtermInstance = ({ container, settings, theme, paneId, sessionId, onEdgeGutter }) => {
  const term = new Terminal({
    theme,
    fontFamily: normalizeTerminalFontFamily(settings.fontFamily),
    fontSize: settings.fontSize,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: 'block',
    cursorInactiveStyle: 'outline',
    scrollback: SCROLLBACK_LINES,
    tabStopWidth: 4,
    minimumContrastRatio: resolveContrast(settings.terminalContrast),
    allowProposedApi: true,
    convertEol: false,
    bracketedPasteMode: true,
    windowsMode: false,
    smoothScrollDuration: settings.smoothScroll ? SMOOTH_SCROLL_MS : 0,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    altClickMovesCursor: true,
    drawBoldTextInBrightColors: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  /* FitAddon 이 스크롤바 폭만큼 cols 를 적게 잡아 우측에 빈틈이 생긴다(우린 스크롤바를 CSS 로
     지웠으므로 공제가 틀렸다). proposeDimensions/fit 을 덮어써 공제를 건너뛰고, 대신 분수 셀
     잔여(remainder)를 밖으로 알려 테마색 가장자리로 마감하게 한다. */
  const origPropose = fitAddon.proposeDimensions.bind(fitAddon);
  fitAddon.proposeDimensions = function proposeDimensions() {
    const metrics = measureTerminalFit(this._terminal, null);
    if (!metrics) return origPropose();
    onEdgeGutter?.(metrics);
    return { cols: metrics.cols, rows: metrics.rows };
  };

  const origFit = fitAddon.fit.bind(fitAddon);
  fitAddon.fit = function fit() {
    if (container) {
      container.style.width = '100%';
      container.style.height = '100%';
    }
    origFit();
    onEdgeGutter?.(measureTerminalFit(this._terminal, null));
  };

  term.loadAddon(new WebLinksAddon());

  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';

  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);

  // ImageAddon 은 SIXEL 디코딩에 WebAssembly 를 쓴다 — WASM 이 CSP 로 막혀 있으면
  // 로드하지 않는다(막힌 채 로드하면 CompileError 가 폭주한다).
  if (WASM_ALLOWED) {
    try {
      term.loadAddon(new ImageAddon());
    } catch { /* 이미지 애드온 실패는 치명적이지 않다 — 텍스트 터미널은 정상 동작 */ }
  }

  // BEL(\x07) — 탭이 백그라운드일 때만 브라우저 알림(설정으로 켜야 동작).
  term.onBell(() => {
    if (!settings.bellNotifications) return;
    if (!document.hidden) return;
    if (Notification.permission !== 'granted') return;
    new Notification('Terminal bell', {
      body: paneId ? `Pane ${paneId.slice(0, 6)}` : 'Terminal',
      icon: '/favicon.svg',
      tag: `bell-${paneId || sessionId}`,
      silent: false,
    });
  });

  // 에이전트 상태 — tmux 가 `set-titles on` 으로 pane 타이틀을 OSC 0 으로 흘려준다.
  // 별도 파싱 없이 여기서 받는다. 원격 호스트 pane 도 같은 경로로 온다(백엔드 tmux
  // 폴링은 로컬 세션만 볼 수 있어서, 원격 감지는 전적으로 이 경로에 의존한다).
  term.onTitleChange((title) => {
    reportTerminalTitle(sessionId, title);
  });

  term.open(container);

  // xterm v6 의 FitAddon 은 core.viewport.scrollBarWidth 대신 상수(14)를 쓴다. 위의
  // proposeDimensions 패치로 이미 우회했지만, 내부에서 참조할 여지가 있어 0 으로 고정해 둔다.
  try {
    const core = term._core;
    if (core?.viewport) {
      Object.defineProperty(core.viewport, 'scrollBarWidth', {
        configurable: true,
        get: () => 0,
        set: () => {},
      });
    }
  } catch { /* 내부 구조가 바뀌었어도 치명적이지 않다 */ }

  // 예측 입력(로컬 에코) — term.open 후 .xterm-screen 이 생겨야 붙일 수 있다.
  let predictiveEcho = null;
  try {
    predictiveEcho = new PredictiveEcho(term);
    predictiveEcho.setGhostColor(`color-mix(in srgb, ${theme.foreground || '#cdd6f4'} 55%, transparent)`);
    predictiveEcho.setEnabled(settings?.predictiveEcho !== false);
  } catch { /* 부착 실패해도 터미널 자체는 정상 동작 */ }

  return { term, fitAddon, searchAddon, predictiveEcho };
};

export default createXtermInstance;
