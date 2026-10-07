import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ko } from '../../i18n/locales/ko';
import KeyCombinationInput from './KeyCombinationInput';

const setup = () => {
  const onSend = vi.fn();
  const view = render(<KeyCombinationInput t={(key) => ko[key]} onSend={onSend} />);
  return { ...view, onSend, input: screen.getByLabelText('나머지 키'),
    send: screen.getByRole('button', { name: '조합키 전송' }) };
};

it('provides every special, navigation and function key as buttons without sending on selection', () => {
  const onAddShortcut = vi.fn(() => true);
  render(<KeyCombinationInput t={key => ko[key]} showKeyButtons onAddShortcut={onAddShortcut} />);
  fireEvent.click(screen.getByRole('button', { name: '특수키', exact: true }));
  for (const key of ['Escape', 'Tab', 'Enter', 'Space', 'Backspace', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]) {
    expect(screen.getByRole('button', { name: key, exact: true })).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Shift', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'ArrowLeft', exact: true }));
  expect(screen.getByRole('status')).toHaveTextContent('Shift + ←');
  expect(onAddShortcut).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '현재 퀵바 세트에 추가' }));
  expect(onAddShortcut).toHaveBeenCalledExactlyOnceWith({ label: 'Shift + ArrowLeft', payload: '\x1b[1;2D' });
});

it('builds Ctrl+C on the screen keyboard without opening a text input or sending on selection', () => {
  const onSend = vi.fn();
  render(<KeyCombinationInput t={key => ko[key]} showKeyButtons onSend={onSend} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ctrl', exact: true }));
  expect(screen.getByRole('status')).toHaveTextContent('Ctrl + …');
  fireEvent.click(screen.getByRole('button', { name: 'c', exact: true }));
  expect(screen.getByRole('status')).toHaveTextContent('Ctrl + C');
  expect(onSend).not.toHaveBeenCalled();
  const send = screen.getByRole('button', { name: '조합키 전송' });
  expect(send.querySelector('.lucide-send')).toBeInTheDocument();
  fireEvent.click(send);
  expect(onSend).toHaveBeenCalledExactlyOnceWith('\x03');
  fireEvent.click(screen.getByRole('button', { name: '특수키', exact: true }));
  expect(screen.getByRole('status')).toHaveTextContent('Ctrl + C');
  fireEvent.click(screen.getByRole('button', { name: '조합 초기화' }));
  expect(screen.getByRole('button', { name: 'Ctrl', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(send).toBeDisabled();
});

it('opens direct input only on request and preserves it when switching key pages', () => {
  const onSend = vi.fn();
  render(<KeyCombinationInput t={key => ko[key]} showKeyButtons onSend={onSend} />);
  const toggle = screen.getByRole('button', { name: '직접 입력' });
  fireEvent.click(toggle);
  const input = screen.getByLabelText('키 또는 조합키');
  expect(input).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Ctrl', exact: true }));
  fireEvent.change(input, { target: { value: '@' } });
  fireEvent.click(screen.getByRole('button', { name: '특수키', exact: true }));
  expect(input).toHaveValue('@');
  expect(screen.getByRole('status')).toHaveTextContent('Ctrl + @');
  fireEvent.click(toggle);
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '조합키 전송' }));
  expect(onSend).toHaveBeenCalledExactlyOnceWith('\x00');
});

it('previews modifiers and sends only when requested', () => {
  const { onSend, input, send } = setup();
  expect(input).toHaveFocus();
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Ctrl' }));
  fireEvent.click(screen.getByRole('button', { name: 'Alt' }));
  fireEvent.change(input, { target: { value: 'x' } });
  expect(screen.getByRole('status')).toHaveTextContent('Ctrl + Alt + X');
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(send);
  expect(onSend).toHaveBeenCalledExactlyOnceWith('\x1b\x18');
  expect(input.value).toBe('x');
});

it('accepts a whole combination as text while preserving partial input', () => {
  const onSend = vi.fn();
  render(<KeyCombinationInput t={key => ko[key]} showKeyButtons onSend={onSend} />);
  fireEvent.click(screen.getByRole('button', { name: '직접 입력' }));
  const input = screen.getByLabelText('키 또는 조합키');
  fireEvent.change(input, { target: { value: 'Ctrl+' } });
  expect(input).toHaveValue('Ctrl+');
  expect(screen.getByRole('button', { name: '조합키 전송' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'Ctrl+Shift+←' } });
  expect(input).toHaveValue('Ctrl+Shift+←');
  expect(screen.getByRole('status')).toHaveTextContent('Ctrl + Shift + ←');
  expect(screen.getByRole('button', { name: 'Ctrl', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Shift', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '조합키 전송' }));
  expect(onSend).toHaveBeenCalledExactlyOnceWith('\x1b[1;6D');
});

it('records an actual shortcut without invoking browser actions or sending it early', () => {
  const onSend = vi.fn();
  render(<KeyCombinationInput t={key => ko[key]} showKeyButtons onSend={onSend} />);
  fireEvent.click(screen.getByRole('button', { name: '직접 입력' }));
  const input = screen.getByLabelText('키 또는 조합키');
  expect(fireEvent.keyDown(input, { key: 'c', ctrlKey: true })).toBe(false);
  expect(input).toHaveValue('Ctrl + C');
  expect(screen.getByRole('status')).toHaveTextContent('Ctrl + C');
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '조합키 전송' }));
  expect(onSend).toHaveBeenLastCalledWith('\x03');
  expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(false);
  expect(screen.getByRole('button', { name: 'Ctrl', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('status')).toHaveTextContent('Shift + Tab');
  expect(onSend).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '조합키 전송' }));
  expect(onSend).toHaveBeenLastCalledWith('\x1b[Z');
});

it('saves the composed bytes as a shortcut without sending them', () => {
  const onSend = vi.fn();
  const onAddShortcut = vi.fn(() => true);
  render(<KeyCombinationInput t={key => ko[key]} onSend={onSend} onAddShortcut={onAddShortcut} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ctrl' }));
  fireEvent.click(screen.getByRole('button', { name: 'Alt' }));
  fireEvent.change(screen.getByLabelText('나머지 키'), { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: '현재 퀵바 세트에 추가' }));
  expect(onAddShortcut).toHaveBeenCalledExactlyOnceWith({ label: 'Ctrl + Alt + X', payload: '\x1b\x18' });
  expect(onSend).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '추가됨' })).toBeDisabled();
});

it('supports Shift+Tab and toggling a modifier back off', () => {
  const { input, onSend } = setup();
  const shift = screen.getByRole('button', { name: 'Shift' });
  fireEvent.click(shift);
  fireEvent.change(input, { target: { value: 'Tab' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSend).toHaveBeenLastCalledWith('\x1b[Z');
  fireEvent.click(shift);
  expect(shift).toHaveAttribute('aria-pressed', 'false');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSend).toHaveBeenLastCalledWith('\t');
});

it.each([true, false])('allows sending a selected screen key after unfinished direct input (hidden: %s)', hideInput => {
  const onSend = vi.fn();
  render(<KeyCombinationInput t={key => ko[key]} showKeyButtons onSend={onSend} />);
  fireEvent.click(screen.getByRole('button', { name: '직접 입력' }));
  const input = screen.getByLabelText('키 또는 조합키');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'ㅎ' } });
  expect(screen.getByRole('button', { name: '조합키 전송' })).toBeDisabled();
  if (hideInput) fireEvent.click(screen.getByRole('button', { name: '직접 입력' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ctrl', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'c', exact: true }));
  expect(screen.getByRole('status')).toHaveTextContent('Ctrl + C');
  const send = screen.getByRole('button', { name: '조합키 전송' });
  expect(send).toBeEnabled();
  fireEvent.click(send);
  expect(onSend).toHaveBeenCalledExactlyOnceWith('\x03');
  if (!hideInput) expect(input).not.toHaveFocus();
});

it('blocks empty, unsupported and composing input', () => {
  const { input, send, onSend } = setup();
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.change(input, { target: { value: 'Ctrl+Hello' } });
  expect(send).toBeDisabled();
  fireEvent.click(send);
  fireEvent.change(input, { target: { value: 'c' } });
  fireEvent.compositionStart(input);
  expect(send).toBeDisabled();
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(onSend).not.toHaveBeenCalled();
  act(() => fireEvent.compositionEnd(input));
  expect(send).not.toBeDisabled();
});
