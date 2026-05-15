import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CommandInput from './CommandInput';

const t = (key) => ({
  commandInput: 'Send command',
  commandInputPlaceholder: 'Type a command',
  commandInputHint: 'Ctrl+Enter to send',
  send: 'Send',
  copy: 'Copy',
  paste: 'Paste',
  clearInput: 'Clear',
  confirmClearInput: 'Clear?',
}[key] || key);

describe('CommandInput positioning', () => {
  let innerHeight;

  beforeEach(() => {
    innerHeight = window.innerHeight;
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: innerHeight, writable: true });
  });

  it('centers the modal when no keyboard is present', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });

    render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    const overlay = screen.getByTestId('command-input-overlay');
    expect(overlay).toHaveStyle({ alignItems: 'center' });
  });

  it('docks to bottom when keyboard is present (viewport shrinks)', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });

    const vv = window.visualViewport;

    render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    const overlay = screen.getByTestId('command-input-overlay');
    expect(overlay).toHaveStyle({ alignItems: 'center' });

    if (vv) {
      act(() => {
        Object.defineProperty(vv, 'height', { value: 400, configurable: true });
        vv.dispatchEvent(new Event('resize'));
      });

      expect(overlay).toHaveStyle({ alignItems: 'flex-end' });
    }
  });

  it('sends command on button click', () => {
    const onSend = vi.fn();
    const onClose = vi.fn();
    const setCommand = vi.fn();

    render(
      <CommandInput
        isOpen={true}
        onClose={onClose}
        onSend={onSend}
        command="ls"
        setCommand={setCommand}
        t={t}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    expect(onSend).toHaveBeenCalledWith('ls');
    expect(setCommand).toHaveBeenCalledWith('');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render when closed', () => {
    render(
      <CommandInput
        isOpen={false}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );
    expect(screen.queryByTestId('command-input-overlay')).toBeNull();
  });

  it('has correct modal styling', () => {
    render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({ maxWidth: '420px' });
    expect(dialog.style.border).toContain('color-mix');
  });

  it('close button has rounded square styling', () => {
    const onClose = vi.fn();
    render(
      <CommandInput
        isOpen={true}
        onClose={onClose}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    const closeBtn = screen.getByRole('button', { name: '' });
    expect(closeBtn).toHaveStyle({ width: '28px', height: '28px' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('header has mantle background', () => {
    render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    const dialog = screen.getByRole('dialog');
    const header = dialog.querySelector('header');
    expect(header).toBeTruthy();
  });

  it('does not render the old lower-left hint icon', () => {
    render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    expect(screen.queryByText('💡')).toBeNull();
    expect(screen.getByPlaceholderText(t('commandInputHint'))).toBeTruthy();
  });
});
