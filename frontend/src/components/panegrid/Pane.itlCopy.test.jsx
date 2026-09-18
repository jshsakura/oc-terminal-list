import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Pane from './Pane';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(async () => true),
}));

vi.mock('../TerminalHeader', () => ({
  default: ({ onCopyAddress }) => (
    <button type="button" disabled={!onCopyAddress} onClick={onCopyAddress}>
      itl copy
    </button>
  ),
}));
vi.mock('../Terminal', async () => {
  const { forwardRef } = await import('react');
  return { default: forwardRef(() => null) };
});
vi.mock('../LocalFolderPicker', () => ({ default: () => null }));
vi.mock('../RemoteFolderPicker', () => ({ default: () => null }));
vi.mock('./BroadcastBadge', () => ({ default: () => null }));
vi.mock('./EmptyPane', () => ({ default: () => null }));
vi.mock('../../hooks/useActiveTerminalCwd', () => ({
  default: () => ({ workspaceRelative: '', absolutePath: '/workspace', refresh: vi.fn() }),
}));
vi.mock('../../hooks/useAppConfig', () => ({
  default: () => ({ itl_available: false }),
}));
vi.mock('../../utils/clipboard', () => ({ copyToClipboard: mocks.copyToClipboard }));

describe('Pane itl copy handle', () => {
  it('stays clickable when itl was installed after the startup config was cached', async () => {
    // Given
    const pane = { id: 'pane-1', sessionId: 'session-1', addressNumber: 1 };
    const tab = { id: 'tab-1', type: 'local', addressNumber: 1, panes: [pane] };
    const onNotify = vi.fn();

    render(
      <Pane
        pane={pane}
        tab={tab}
        allTabs={[tab]}
        hosts={[]}
        settings={{ theme: 'catppuccin', localName: 'Windows host', defaultMultiplexer: 'tmux' }}
        updateSettings={vi.fn()}
        isActive
        isFocused
        layoutSignal="test"
        onNotify={onNotify}
        t={(key) => key}
      />,
    );

    // When
    const copyButton = screen.getByRole('button', { name: 'itl copy' });
    fireEvent.click(copyButton);

    // Then
    expect(copyButton).toBeEnabled();
    await waitFor(() => expect(mocks.copyToClipboard).toHaveBeenCalledWith(
      "itl send 1.1 'TEXT'  # Windows host · /workspace",
    ));
    expect(onNotify).toHaveBeenCalledWith('copied · 1.1 · Windows host');
  });
});
