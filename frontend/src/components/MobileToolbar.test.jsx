import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MobileToolbar from './MobileToolbar';

describe('MobileToolbar quick input', () => {
  afterEach(() => {
    cleanup();
    delete window.terminalSessions;
  });

  it('keeps quick input available when saved mobile keys omit it', () => {
    const onOpenCommandInput = vi.fn();

    render(
      <MobileToolbar
        language="en"
        keys={[{ id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' }]}
        onOpenCommandInput={onOpenCommandInput}
      />
    );

    fireEvent.click(screen.getByTitle('Quick Input'));
    expect(onOpenCommandInput).toHaveBeenCalledTimes(1);
  });

  it('opens quick input even while the terminal session registry is not ready', () => {
    const onOpenCommandInput = vi.fn();

    render(
      <MobileToolbar
        language="en"
        terminalSessionId="pending-session"
        keys={[{ id: 'cmd', kind: 'cmdInput', tone: 'accent' }]}
        onOpenCommandInput={onOpenCommandInput}
      />
    );

    fireEvent.click(screen.getByTitle('Quick Input'));
    expect(onOpenCommandInput).toHaveBeenCalledTimes(1);
  });
});
