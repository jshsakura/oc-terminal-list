import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandInput from './CommandInput';

const t = (key) => ({
  commandInput: 'Send command',
  commandInputPlaceholder: 'Type a command',
  commandInputHint: 'Ctrl+Enter to send',
  send: 'Send',
  copy: 'Copy',
  paste: 'Paste',
  clearInput: 'Clear',
}[key] || key);

describe('CommandInput', () => {
  it('renders as a centered modal instead of sitting over the mobile hotkeys', () => {
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
    const dialog = screen.getByRole('dialog', { name: /Send command/i });

    expect(overlay).toHaveStyle({ alignItems: 'center', justifyContent: 'center' });
    expect(dialog).toHaveStyle({ maxHeight: '80dvh', maxWidth: '420px' });
  });

  it('sends the command and clears the preserved input', () => {
    const onSend = vi.fn();
    const onClose = vi.fn();
    const setCommand = vi.fn();

    render(
      <CommandInput
        isOpen={true}
        onClose={onClose}
        onSend={onSend}
        command="ls -la"
        setCommand={setCommand}
        t={t}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    expect(onSend).toHaveBeenCalledWith('ls -la');
    expect(setCommand).toHaveBeenCalledWith('');
    expect(onClose).toHaveBeenCalled();
  });
});
