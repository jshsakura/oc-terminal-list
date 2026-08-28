import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import MobileToolbar from './MobileToolbar';

describe('MobileToolbar quick input', () => {
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
