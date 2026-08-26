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

describe('퀵바 좌측 슬롯의 여백', () => {
  afterEach(cleanup);

  it('여백은 CSS 클래스가 갖는다 — 인라인이면 비었을 때 되돌릴 수 없다', () => {
    /* 슬롯 내용은 도크가 **포탈로** 넣는다. React 는 그 자식을 모르므로 "비었으면 여백 0"
       을 조건부 스타일로 쓸 수 없고, `:empty` 만이 안다. 그래서 인라인 padding 으로
       옮기면 그 규칙이 조용히 무력화되고(인라인이 이긴다) 도크가 없는 탭에서도 슬롯이
       빈 자리를 먹는다 — jsdom 은 레이아웃을 안 재므로 폭으로는 잡히지 않는다. */
    const { container } = render(<MobileToolbar language="en" />);
    const slot = container.querySelector('#iterm-dock-slot');
    expect(slot.className).toContain('mt-dock-slot');
    expect(slot.style.paddingLeft).toBe('');
    expect(slot.style.padding).toBe('');

    const css = [...container.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(css).toMatch(/\.mt-dock-slot\s*\{[^}]*padding-left:\s*6px/);
    expect(css).toMatch(/\.mt-dock-slot:empty\s*\{[^}]*padding:\s*0/);
  });
});
