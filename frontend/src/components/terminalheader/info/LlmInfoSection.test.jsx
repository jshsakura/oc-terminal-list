import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LlmInfoSection from './LlmInfoSection';
import { ko } from '../../../i18n/locales/ko';

const info = { sessionId: 'terminal-a', tabType: 'local' };
const t = (key) => ko[key] || key;
const threadId = '11111111-2222-3333-4444-555555555555';
const ready = {
  status: 'ready', agent: 'Codex', process_id: 20, match: 'process',
  usage: {
    thread_id: threadId, model: 'gpt-test-with-a-very-long-model-name', effort: 'xhigh',
    input_tokens: 283000, output_tokens: 0, context_tokens: 38000, context_window: 200000,
    updated_at: '2026-11-05T01:00:00Z', limits_updated_at: '2026-11-05T01:00:01Z',
    limits: [{ window_minutes: 10080, remaining_percent: 65, resets_at: 1800000000 }],
  },
};
const response = (data) => ({ ok: true, json: async () => data });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Info LLM section', () => {
  it('renders full values with shared wrapping rows and identifies weekly by duration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(ready)));
    render(<LlmInfoSection info={info} isVisible t={t} />);
    const model = await screen.findByText(ready.usage.model);
    expect(model.style.whiteSpace).toBe('normal');
    expect(screen.getByText('65% 남음')).toBeTruthy();
    expect(screen.getByText('주간 한도')).toBeTruthy();
    expect(screen.queryByText('5시간 한도')).toBeNull();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('19% (38,000 / 200,000)')).toBeTruthy();
  });

  it('requests a selected session with the observed process identity', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({
      status: 'select_session', agent: 'Codex', process_id: 20,
      sessions: [{ id: threadId, model: 'gpt-test', updated_at: 1800000000 }],
    })).mockResolvedValue(response({ ...ready, match: 'selected' }));
    vi.stubGlobal('fetch', fetcher);
    render(<LlmInfoSection info={info} isVisible t={t} />);
    fireEvent.click(await screen.findByRole('button', { name: /gpt-test/ }));
    await screen.findByText(ready.usage.model);
    expect(fetcher.mock.calls[1][0]).toContain(`thread_id=${threadId}`);
    expect(fetcher.mock.calls[1][0]).toContain('process_id=20');
    expect(screen.getByText(ko.infoLlmSelected)).toBeTruthy();
  });

  it('does not fetch while hidden and aborts when hidden during a request', async () => {
    const fetcher = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<LlmInfoSection info={info} isVisible={false} t={t} />);
    expect(fetcher).not.toHaveBeenCalled();
    view.rerender(<LlmInfoSection info={info} isVisible t={t} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const signal = fetcher.mock.calls[0][1].signal;
    view.rerender(<LlmInfoSection info={info} isVisible={false} t={t} />);
    expect(signal.aborted).toBe(true);
  });

  it('does not show a response from a previous terminal', async () => {
    let finish;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue(response({ status: 'no_agent' }));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<LlmInfoSection info={info} isVisible t={t} />);
    view.rerender(<LlmInfoSection info={{ ...info, sessionId: 'terminal-b' }} isVisible t={t} />);
    await screen.findByText(ko.infoLlmNoAgent);
    await act(async () => { finish(response(ready)); });
    expect(screen.queryByText(ready.usage.model)).toBeNull();
  });

  it('reports network failures and retries with the refresh button', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response(ready));
    vi.stubGlobal('fetch', fetcher);
    render(<LlmInfoSection info={info} isVisible t={t} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    fireEvent.click(screen.getByRole('button', { name: ko.refresh }));
    await screen.findByText(ready.usage.model);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stops polling when the panel closes', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(response(ready));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<LlmInfoSection info={info} isVisible t={t} />);
    await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses the remote host and exact tmux session', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ status: 'no_agent' }));
    vi.stubGlobal('fetch', fetcher);
    render(<LlmInfoSection info={{ ...info, tabType: 'host', host: { id: 'host-a' }, effectiveTmuxSession: 'mobile_2' }} isVisible t={t} />);
    await screen.findByText(ko.infoLlmNoAgent);
    expect(fetcher.mock.calls[0][0]).toContain('host_id=host-a');
    expect(fetcher.mock.calls[0][0]).toContain('tmux_session=mobile_2');
  });

  it('omits the section when the integration is off', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 'disabled' })));
    const view = render(<LlmInfoSection info={info} isVisible t={t} />);
    await waitFor(() => expect(view.container.innerHTML).toBe(''));
  });
});
