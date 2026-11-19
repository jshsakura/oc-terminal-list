import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../utils/terminatorApi', () => ({
  fetchTerminatorStatus: vi.fn(),
  startTerminator: vi.fn(async () => ({ running: true })),
  fetchTerminatorMessages: vi.fn(async () => ({ messages: [] })),
  sayToTerminator: vi.fn(async () => ({ ok: true })),
  showTerminatorTerminal: vi.fn(async () => ({ tabId: 'tab-term' })),
}));

vi.mock('../Terminal', () => ({
  default: ({ sessionId }) => <div data-testid="embedded-terminal" data-session={sessionId} />,
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

  it('switches to the real terminal inside the panel, without opening a tab', async () => {
    api.fetchTerminatorStatus.mockResolvedValueOnce(ready);
    const onSelectTab = vi.fn();
    render(<TerminatorPanel open tabs={[]} onSelectTab={onSelectTab} onClose={() => {}} t={() => undefined} />);
    fireEvent.click(await screen.findByRole('tab', { name: '터미널' }));
    expect(await screen.findByTestId('embedded-terminal')).toHaveAttribute('data-session', 'terminator-x');
    expect(onSelectTab).not.toHaveBeenCalled();
    expect(api.showTerminatorTerminal).not.toHaveBeenCalled();
  });

  it('shows the model, effort and context in use, and each routing step with its outcome', async () => {
    api.fetchTerminatorStatus.mockResolvedValueOnce({
      ...ready, engine: { model: 'glm-5.3', effort: 'medium', contextLimit: 400000 },
    });
    api.fetchTerminatorMessages.mockResolvedValueOnce({
      contextUsed: 1637,
      messages: [
        { id: 'a', role: 'tool', text: '탭 열기 · claude', ok: true, detail: '3.1' },
        { id: 'b', role: 'tool', text: '전달 · 9.9', ok: false, detail: '그런 팬이 없다' },
      ],
    });
    render(<TerminatorPanel open tabs={[]} t={() => undefined} />);
    expect(await screen.findByText('GLM-5.3 · effort medium · 1.6k / 400k')).toBeInTheDocument();
    expect(await screen.findByText('→ 3.1')).toBeInTheDocument();
    expect(screen.getByText('그런 팬이 없다')).toBeInTheDocument();
  });
});
