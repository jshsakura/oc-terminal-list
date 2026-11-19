import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../utils/terminatorApi', () => ({
  fetchTerminatorStatus: vi.fn(),
  startTerminator: vi.fn(async () => ({ running: true })),
  fetchTerminatorMessages: vi.fn(async () => ({ messages: [] })),
  sayToTerminator: vi.fn(async () => ({ ok: true })),
  showTerminatorTerminal: vi.fn(async () => ({ tabId: 'tab-term' })),
}));

import TerminatorPanel from './TerminatorPanel';
import * as api from '../../utils/terminatorApi';

const ready = { configured: true, running: true, sessionId: 'terminator-x', logins: { claude: true, codex: false, github: true } };
const t = (k) => ({ terminatorEmpty: 'EMPTY', terminatorNoKey: 'NOKEY', terminatorPlaceholder: 'SAY' }[k]);

describe('TerminatorPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('explains instead of starting anything when no connection key is set', async () => {
    api.fetchTerminatorStatus.mockResolvedValueOnce({ ...ready, configured: false, running: false });
    render(<TerminatorPanel open tabs={[]} t={t} />);
    expect(await screen.findByText('NOKEY')).toBeInTheDocument();
    expect(api.startTerminator).not.toHaveBeenCalled();
  });

  it('starts Terminator when it is not running, then shows the empty prompt', async () => {
    api.fetchTerminatorStatus.mockResolvedValueOnce({ ...ready, running: false });
    render(<TerminatorPanel open tabs={[]} t={t} />);
    expect(await screen.findByText('EMPTY')).toBeInTheDocument();
    expect(api.startTerminator).toHaveBeenCalledTimes(1);
  });

  it('sends on Enter and shows the message right away', async () => {
    api.fetchTerminatorStatus.mockResolvedValueOnce(ready);
    render(<TerminatorPanel open tabs={[]} t={t} />);
    const input = await screen.findByPlaceholderText('SAY');
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: '버튼 색 바꿔 줘' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('버튼 색 바꿔 줘')).toBeInTheDocument();
    expect(api.sayToTerminator).toHaveBeenCalledWith('버튼 색 바꿔 줘');
  });

  it('goes to the tab Terminator just opened and closes itself', async () => {
    api.fetchTerminatorStatus.mockResolvedValueOnce(ready);
    const onSelectTab = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<TerminatorPanel open tabs={[]} onSelectTab={onSelectTab} onClose={onClose} t={t} />);
    await screen.findByText('EMPTY');
    const worker = { id: 'w1', name: '개발', openedBy: 'terminator', panes: [{ sessionId: 's1' }] };
    rerender(<TerminatorPanel open tabs={[worker]} onSelectTab={onSelectTab} onClose={onClose} t={t} />);
    expect(onSelectTab).toHaveBeenCalledWith('w1');
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the real terminal behind it once its tab arrives', async () => {
    api.fetchTerminatorStatus.mockResolvedValueOnce(ready);
    const onSelectTab = vi.fn();
    const { rerender } = render(<TerminatorPanel open tabs={[]} onSelectTab={onSelectTab} onClose={() => {}} t={() => undefined} />);
    fireEvent.click(await screen.findByTitle('터미널로 보기'));
    await act(async () => {});
    rerender(<TerminatorPanel open tabs={[{ id: 'tab-term', openedBy: 'terminator-self', panes: [] }]} onSelectTab={onSelectTab} onClose={() => {}} t={() => undefined} />);
    expect(onSelectTab).toHaveBeenCalledWith('tab-term');
  });
});
