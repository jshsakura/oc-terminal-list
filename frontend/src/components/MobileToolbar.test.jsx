import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import MobileToolbar from './MobileToolbar';

describe('MobileToolbar quick input', () => {
  afterEach(() => {
    cleanup();
    delete window.terminalSessions;
  });

  it('keeps quick input available when saved mobile keys omit it', () => {
    const onOpenCommandInput = vi.fn();

    render(
      <MobileToolbar
        language="en"
        keys={[{ id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' }]}
        onOpenCommandInput={onOpenCommandInput}
      />
    );

    fireEvent.click(screen.getByTitle('Quick Input'));
    expect(onOpenCommandInput).toHaveBeenCalledTimes(1);
  });

  it('opens quick input even while the terminal session registry is not ready', () => {
    const onOpenCommandInput = vi.fn();

    render(
      <MobileToolbar
        language="en"
        terminalSessionId="pending-session"
        keys={[{ id: 'cmd', kind: 'cmdInput', tone: 'accent' }]}
        onOpenCommandInput={onOpenCommandInput}
      />
    );

    fireEvent.click(screen.getByTitle('Quick Input'));
    expect(onOpenCommandInput).toHaveBeenCalledTimes(1);
  });
});

describe('MobileToolbar 길게 누르기 반복', () => {
  it('백스페이스를 누르고 있으면 반복 전송된다 — iOS 는 떼야 mousedown 이 와서 터치로만 가능', () => {
    vi.useFakeTimers();
    try {
      const onSendKey = vi.fn();
      const { getByText } = render(
        <MobileToolbar onSendKey={onSendKey} keys={[{ id: 'bs', kind: 'send', label: '⌫', payload: '\x7f' }]} />
      );
      const key = getByText('⌫').closest('button');

      fireEvent.touchStart(key);
      expect(onSendKey).toHaveBeenCalledTimes(1);       // 누르는 즉시 1회
      act(() => { vi.advanceTimersByTime(420 + 80 * 4); });
      expect(onSendKey.mock.calls.length).toBeGreaterThan(3);

      const afterRelease = onSendKey.mock.calls.length;
      fireEvent.touchEnd(key);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(onSendKey).toHaveBeenCalledTimes(afterRelease);   // 떼면 멈춘다
      expect(onSendKey).toHaveBeenCalledWith('\x7f');
    } finally {
      vi.useRealTimers();
    }
  });

  it('터치 뒤 따라오는 합성 mousedown 은 무시한다 — 한 번 눌렀는데 두 글자 지워지면 안 된다', () => {
    const onSendKey = vi.fn();
    const { getByText } = render(
      <MobileToolbar onSendKey={onSendKey} keys={[{ id: 'bs', kind: 'send', label: '⌫', payload: '\x7f' }]} />
    );
    const key = getByText('⌫').closest('button');
    fireEvent.touchStart(key);
    fireEvent.touchEnd(key);
    fireEvent.mouseDown(key);
    expect(onSendKey).toHaveBeenCalledTimes(1);
  });
});
