import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import MobileToolbar from './MobileToolbar';

describe('MobileToolbar quick input', () => {
  afterEach(() => {
    cleanup();
    delete window.terminalSessions;
  });

  it('빠른입력 버튼을 만들어 내지 않는다 — 입력창은 하단 도크로 상시 열려 있다', () => {
    /* 예전에는 저장된 키셋에 없어도 툴바가 그 버튼을 끼워 넣었다. 지금은 그 버튼이 여는
       것이 이미 열려 있으므로, 없으면 없는 채로 그린다(툴바 폭은 그만큼 키에 쓴다). */
    render(
      <MobileToolbar
        language="en"
        keys={[{ id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' }]}
        onOpenCommandInput={vi.fn()}
      />
    );
    expect(screen.queryByTitle('Quick Input')).toBeNull();
    expect(screen.getByText('ESC')).toBeTruthy();
  });

  it('옛 설정이 그 버튼을 들고 있어도 그리지 않는다 — 툴바가 sanitize 를 거친다', () => {
    /* 툴바는 넘어온 키셋을 그대로 믿지 않고 sanitizeMobileKeys 를 통과시킨다. 그래서
       저장된 설정에 남아 있어도 화면에는 안 나온다 — 사용자가 지울 필요가 없다.
       (키가 통째로 사라지면 안 되므로 sanitize 는 기본 키셋으로 되돌린다.) */
    render(
      <MobileToolbar
        language="en"
        keys={[{ id: 'cmd', kind: 'cmdInput', tone: 'accent' }]}
        onOpenCommandInput={vi.fn()}
      />
    );
    expect(screen.queryByTitle('Quick Input')).toBeNull();
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
