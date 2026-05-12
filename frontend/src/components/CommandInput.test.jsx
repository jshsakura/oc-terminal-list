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
  it('docks the modal to the visible viewport bottom so it sits above the on-screen keyboard', () => {
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

    // overlay 는 visualViewport 좌표로 고정돼야 한다 — 키보드가 올라와도 가시 영역 안에서만 그려지고
    // 모달은 하단(키보드 위) 에 도크.
    expect(overlay).toHaveStyle({
      position: 'fixed',
      alignItems: 'flex-end',
      justifyContent: 'center',
    });
    // 모달 자체는 기존 너비 한계 유지.
    expect(dialog).toHaveStyle({ maxWidth: '420px' });
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
