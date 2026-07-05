import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const TYPE_CHAR_MS = 55;
const TYPE_JITTER_MS = 35;
const AFTER_ENTER_MS = 350;
const OUTPUT_LINE_MS = 90;
const BETWEEN_COMMANDS_MS = 1400;
const LOOP_PAUSE_MS = 2200;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Scripted xterm.js replay — no real shell, no WebSocket, no user input.
 * Types out each command at a human pace, then prints its canned output.
 * Loops forever so the demo always has something happening on screen.
 */
const DemoTerminal = ({ script, isActive }) => {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const term = new Terminal({
      // 실제 앱은 번들된 Nerd Font 를 쓰지만, 이 데모는 프로모션용 정적 사이트라 5MB+ 폰트
      // 파일을 별도로 실어 나를 가치가 없다 — 시스템 모노스페이스로 충분히 그럴듯하다.
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      cursorStyle: 'block',
      disableStdin: true,
      scrollback: 2000,
      theme: {
        background: '#11121a',
        foreground: '#cdd6f4',
        cursor: '#89b4fa',
        black: '#1e1e2e', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
        blue: '#89b4fa', magenta: '#cba6f7', cyan: '#94e2d5', white: '#cdd6f4',
        brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5', brightWhite: '#a6adc8',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;
    cancelledRef.current = false;

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* noop */ }
    });
    resizeObserver.observe(container);

    const typeText = async (text) => {
      for (const char of text) {
        if (cancelledRef.current) return;
        term.write(char);
        await sleep(TYPE_CHAR_MS + Math.random() * TYPE_JITTER_MS);
      }
    };

    const runLoop = async () => {
      while (!cancelledRef.current) {
        term.clear();
        term.write(script.prompt);
        for (const { cmd, output } of script.commands) {
          if (cancelledRef.current) return;
          await typeText(cmd);
          if (cancelledRef.current) return;
          term.write('\r\n');
          await sleep(AFTER_ENTER_MS);
          for (const line of output) {
            if (cancelledRef.current) return;
            term.writeln(line);
            await sleep(OUTPUT_LINE_MS);
          }
          if (cancelledRef.current) return;
          await sleep(BETWEEN_COMMANDS_MS);
          term.write(script.prompt);
        }
        await sleep(LOOP_PAUSE_MS);
      }
    };
    runLoop();

    return () => {
      cancelledRef.current = true;
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // script identity (scriptId) is stable per tab — re-running on every render would restart typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script]);

  // 탭이 다시 활성화될 때 크기가 어긋나 있을 수 있으므로 refit.
  useEffect(() => {
    if (!isActive) return;
    const raf = requestAnimationFrame(() => {
      try { fitAddonRef.current?.fit(); } catch { /* noop */ }
    });
    return () => cancelAnimationFrame(raf);
  }, [isActive]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', padding: '8px 4px' }} />;
};

export default DemoTerminal;
