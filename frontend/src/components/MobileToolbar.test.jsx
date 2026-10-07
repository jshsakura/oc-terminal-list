import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import MobileToolbar from './MobileToolbar';

describe('MobileToolbar quick input', () => {
  it('view mode offers copy and text viewing, and requires explicit switching for input', () => {
    const onToggle = vi.fn();
    const onAction = vi.fn();
    render(<MobileToolbar language="en" viewOnly onToggleViewOnly={onToggle} onAction={onAction} />);
    expect(screen.queryByTitle('Quick Input')).toBeNull();
    expect(screen.queryByText('ESC')).toBeNull();
    expect(screen.queryByTitle('Paste')).toBeNull();
    fireEvent.click(screen.getByTitle('View as text'));
    expect(onAction).toHaveBeenCalledWith('viewAsText');
    fireEvent.click(screen.getByTitle('Copy selection'));
    expect(onAction).toHaveBeenCalledWith('copy');
    fireEvent.click(screen.getByTitle('Scroll to Bottom'));
    expect(onAction).toHaveBeenCalledWith('scrollToBottom');
    fireEvent.click(screen.getByRole('button', { name: 'Return to the bottom with Esc and switch to input mode' }));
    expect(onAction).toHaveBeenCalledWith('escapeToInput');
    expect(screen.getByRole('button', { name: 'Switch to input mode' }).querySelector('svg')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to input mode' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
  afterEach(() => {
    cleanup();
    delete window.terminalSessions;
  });

  /* ⚠️ 도크가 상시 노출이던 시절엔 이 버튼을 **안 그렸다.** 도크를 되돌린 지금 그건
     모바일에서 입력할 방법이 아예 없다는 뜻이다 — 저장된 키셋에 없으면 되돌려 넣는다. */
  it('저장된 키셋에 없어도 빠른입력 버튼을 되돌려 넣는다', () => {
    render(
      <MobileToolbar
        language="en"
        keys={[{ id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' }]}
        onOpenCommandInput={vi.fn()}
      />
    );
    expect(screen.getByTitle('Quick Input')).toBeTruthy();
    expect(screen.getByText('ESC')).toBeTruthy();
  });

  it('그 버튼은 퀵바 **왼쪽에 고정**된다 — 키를 옆으로 밀어도 안 사라진다', () => {
    const { container } = render(
      <MobileToolbar
        language="en"
        keys={[{ id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' }]}
        onOpenCommandInput={vi.fn()}
      />
    );
    // 스크롤 영역보다 앞(DOM 순서상 먼저)에 있어야 왼쪽 고정이다.
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons[0]).toBe(screen.getByTitle('Quick Input'));
  });

  it('누르면 입력창을 연다', () => {
    const onOpen = vi.fn();
    render(<MobileToolbar language="en" keys={[]} onOpenCommandInput={onOpen} />);
    fireEvent.click(screen.getByTitle('Quick Input'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('작은 화면에서도 24px 키와 우측 overflow 힌트를 제공한다', () => {
    const { container } = render(
      <MobileToolbar
        language="en"
        keys={[{ id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' }]}
      />
    );

    const key = screen.getByText('ESC').closest('button');
    expect(key.style.height).toBe('24px');
    expect(container.querySelector('style').textContent).toContain('mask-image: linear-gradient');
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
