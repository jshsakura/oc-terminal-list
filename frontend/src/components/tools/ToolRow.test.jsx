import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ToolRow from './ToolRow';

/* A push-installed tool (itl) is a file the backend places. The row must show the path,
   not a command, and offer install/remove instead of "type into a terminal" / "copy". */
const PUSH_TOOL = {
  id: 'itl', name: 'itl', builtin: true, install_kind: 'push',
  install_path: '~/.local/bin/itl', install_command: '', description: 'd',
};
const TYPED_TOOL = {
  id: 'herdr', name: 'herdr', builtin: true,
  install_command: 'curl -fsSL https://herdr.dev/install.sh | sh',
};

describe('ToolRow — push-installed tools', () => {
  afterEach(cleanup);

  it('shows the path and an install button when the file is missing', () => {
    const onPush = vi.fn();
    render(<ToolRow tool={PUSH_TOOL} state={{ installed: false }} onPush={onPush} onUnpush={vi.fn()} />);
    expect(screen.getByText('~/.local/bin/itl')).toBeTruthy();
    fireEvent.click(screen.getByText('설치'));
    expect(onPush).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('제거')).toBeNull();
    expect(screen.queryByText('명령 복사')).toBeNull();
    expect(screen.queryByText('터미널에서 설치')).toBeNull();
  });

  it('offers remove when the file is there — removal is one click, like installing', () => {
    const onUnpush = vi.fn();
    render(<ToolRow tool={PUSH_TOOL} state={{ installed: true }} onPush={vi.fn()} onUnpush={onUnpush} />);
    fireEvent.click(screen.getByText('제거'));
    expect(onUnpush).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('설치')).toBeNull();
  });

  it('offers both when the check could not run — either is safe to repeat', () => {
    render(<ToolRow tool={PUSH_TOOL} state={{ installed: null }} onPush={vi.fn()} onUnpush={vi.fn()} />);
    expect(screen.getByText('설치')).toBeTruthy();
    expect(screen.getByText('제거')).toBeTruthy();
  });

  it('disables the actions while one is running', () => {
    render(<ToolRow tool={PUSH_TOOL} state={{ installed: false }} busy onPush={vi.fn()} onUnpush={vi.fn()} />);
    const btn = screen.getByText('설치 중…').closest('button');
    expect(btn.disabled).toBe(true);
  });

  it('typed tools keep the terminal flow', () => {
    const onInstall = vi.fn();
    render(<ToolRow tool={TYPED_TOOL} state={{ installed: false }} onInstall={onInstall} onCopy={vi.fn()} />);
    expect(screen.getByText(TYPED_TOOL.install_command)).toBeTruthy();
    fireEvent.click(screen.getByText('터미널에서 설치'));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(screen.getByText('명령 복사')).toBeTruthy();
  });
});
