import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import MobileToolbar from './MobileToolbar';

describe('MobileToolbar quick input', () => {
  it('keeps quick input and presets available in view mode, with settings fixed at the right', () => {
    const onOpenSettings = vi.fn();
    const onAction = vi.fn();
    const { container } = render(<MobileToolbar language="en" viewOnly onOpenSettings={onOpenSettings} onAction={onAction} />);
    expect(screen.getByTitle('Quick Input')).toBeInTheDocument();
    expect(screen.getByText('ESC')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to input mode' })).toBeNull();
    fireEvent.click(screen.getByTitle('Copy'));
    expect(onAction).toHaveBeenCalledWith('copy');
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.at(-1)).toBe(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(buttons.at(-1));
    expect(onOpenSettings).toHaveBeenCalledOnce();
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

  it('작은 화면에서도 32px 키와 우측 overflow 힌트를 제공한다', () => {
    const { container } = render(
      <MobileToolbar
        language="en"
        keys={[{ id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' }]}
      />
    );

    const key = screen.getByText('ESC').closest('button');
    expect(key.style.height).toBe('32px');
    expect(container.querySelector('style').textContent).toContain('mask-image: linear-gradient');
  });
});

it('opens a set popup without sending keys, selects a set and closes on outside presses', async () => {
  const onSelectSet = vi.fn();
  const onSendKey = vi.fn();
  render(<MobileToolbar keySets={[{ id: 'one', label: '1', name: 'First' }, { id: 'two', icon: 'Keyboard', name: 'Second' }]}
    activeSetId="one" onSelectSet={onSelectSet} onSendKey={onSendKey} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose quick bar set' }));
  expect(screen.getByRole('menuitemradio', { name: /First$/ })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Second$/ }));
  expect(onSelectSet).toHaveBeenCalledExactlyOnceWith('two');
  expect(onSendKey).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Choose quick bar set' }));
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('pastes into the composer and never sends clipboard content as terminal input', async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const onPasteToInput = vi.fn();
  const onSendKey = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => 'dangerous command\n' } });
  try {
    render(<MobileToolbar onPasteToInput={onPasteToInput} onSendKey={onSendKey} />);
    await act(async () => fireEvent.click(screen.getByTitle('Paste into input')));
    expect(onPasteToInput).toHaveBeenCalledExactlyOnceWith('dangerous command\n');
    expect(onSendKey).not.toHaveBeenCalled();
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else delete navigator.clipboard;
  }
});

describe('MobileToolbar 길게 누르기 반복', () => {
  it('stops key repeat while returning from terminal history', () => {
    vi.useFakeTimers();
    try {
      const onSendKey = vi.fn();
      const props = { onSendKey, keys: [{ id: 'bs', kind: 'send', label: 'BS', payload: '\x7f' }] };
      const view = render(<MobileToolbar {...props} />);
      fireEvent.touchStart(screen.getByText('BS'));
      view.rerender(<MobileToolbar {...props} modePending />);
      act(() => vi.advanceTimersByTime(1000));
      expect(onSendKey).toHaveBeenCalledExactlyOnceWith('\x7f');
    } finally { vi.useRealTimers(); }
  });
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
