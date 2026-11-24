import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TerminalHeader from '../TerminalHeader';
import UsageModal from './UsageModal';
import { ko } from '../../i18n/locales/ko';

const t = (key) => ko[key] || key;
const thread = '11111111-2222-3333-4444-555555555555';
const ready = {
  status: 'ready', match: 'title', agent: 'Codex', process_id: 20,
  usage: { model: 'gpt-test-model', effort: 'high', thread_id: thread, input_tokens: 283000, output_tokens: 0,
    context_tokens: 38000, context_window: 200000, limits: [{ window_minutes: 10080, remaining_percent: 65, resets_at: 1800000000 }] },
};
const choosing = { status: 'select_session', agent: 'Codex', process_id: 20,
  sessions: [{ id: thread, model: 'Choose this model', updated_at: 1800000000 }] };
const response = (data) => ({ ok: true, json: async () => data });
const info = (id) => ({ sessionId: id, paneId: id, tabType: 'local', paneName: `Pane ${id}` });
const modal = (id, extra = {}) => <UsageModal info={info(id)} isOpen onClose={vi.fn()} t={t} {...extra} />;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('session usage', () => {
  it('places session usage immediately after recent commands and keeps the Info panel open after Escape', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => response(String(url).includes('/llm-usage/pane') ? ready : {})));
    const view = render(<TerminalHeader settings={{ theme: 'default' }} t={t} paneInfo={info('header-a')} terminalKey="header-a" />);
    const historyButton = screen.getByRole('button', { name: '최근 명령 보기', exact: true });
    const usageButton = screen.getByRole('button', { name: '사용량', exact: true });
    expect(historyButton.parentElement.nextElementSibling).toBe(usageButton);
    expect(usageButton).toHaveTextContent('');
    expect(usageButton.querySelector('svg circle')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('more') }));
    fireEvent.click(screen.getByText(t('paneInfoTitle')).closest('button'));
    await screen.findByText('사용 중인 LLM');
    fireEvent.click(usageButton);
    const dialog = await screen.findByRole('dialog', { name: '세션 사용량' });
    expect(await within(dialog).findByText('gpt-test-model')).toBeTruthy();
    expect(within(dialog).getByText(/Pane header-a/)).toBeTruthy();
    expect(within(dialog).getByRole('meter', { name: '주간 한도 · 남음' })).toHaveAttribute('aria-valuenow', '65');
    expect(within(dialog).getByText('0')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(view.container.querySelector('[tabindex="-1"]')).toBeTruthy();
    expect(usageButton).toHaveFocus();
  });

  it('loads current usage immediately and scopes requests to the terminal and host', async () => {
    const fetcher = vi.fn(async () => response(ready));
    vi.stubGlobal('fetch', fetcher);
    const first = render(modal('current-a'));
    await screen.findByText('gpt-test-model');
    expect(fetcher.mock.calls[0][0]).toContain('session_id=current-a');
    expect(fetcher.mock.calls[0][0]).toContain('current_only=true');
    expect(fetcher.mock.calls[0][0]).not.toContain('thread_id=');
    expect(screen.queryByRole('button', { name: '세션 변경' })).toBeNull();
    first.unmount();
    render(modal('current-a', { info: { ...info('current-a'), tabType: 'host', host: { id: 'remote' }, effectiveTmuxSession: 'work' } }));
    await screen.findByText('gpt-test-model');
    expect(fetcher.mock.calls.at(-1)[0]).toContain('host_id=remote');
    expect(fetcher.mock.calls.at(-1)[0]).toContain('tmux_session=work');
    expect(fetcher.mock.calls.at(-1)[0]).toContain('current_only=true');
    expect(fetcher.mock.calls.at(-1)[0]).not.toContain('thread_id=');
  });

  it('reopening follows a changed thread even when the process stays the same', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(ready)).mockResolvedValue(response({
      ...ready, usage: { ...ready.usage, model: 'new-current-model', thread_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    }));
    vi.stubGlobal('fetch', fetcher);
    const first = render(modal('switch-a'));
    await screen.findByText('gpt-test-model');
    first.unmount();
    render(modal('switch-a'));
    await screen.findByText('new-current-model');
    expect(screen.queryByText('gpt-test-model')).toBeNull();
    expect(fetcher.mock.calls.at(-1)[0]).not.toContain('thread_id=');
  });

  it('clears old usage when reopening cannot identify the current session', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(ready)).mockResolvedValue(response({
      ...choosing, status: 'session_unmatched',
    }));
    vi.stubGlobal('fetch', fetcher);
    const view = render(modal('unmatched-a'));
    await screen.findByText('gpt-test-model');
    view.rerender(modal('unmatched-a', { isOpen: false }));
    view.rerender(modal('unmatched-a'));
    await screen.findByText(ko.paneUsageUnmatched);
    expect(screen.queryByText('gpt-test-model')).toBeNull();
    expect(screen.queryByRole('button', { name: /Choose this model/ })).toBeNull();
  });

  it('closes and aborts its request when the terminal tab becomes hidden', async () => {
    let signal;
    const fetcher = vi.fn((url, options) => {
      if (String(url).includes('/llm-usage/pane')) {
        signal = options.signal;
        return new Promise(() => {});
      }
      return Promise.resolve(response({}));
    });
    vi.stubGlobal('fetch', fetcher);
    const props = { settings: { theme: 'default' }, t, paneInfo: info('hide-a') };
    const view = render(<TerminalHeader {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '사용량', exact: true }));
    await waitFor(() => expect(signal).toBeTruthy());
    view.rerender(<TerminalHeader {...props} isPaneVisible={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(signal.aborted).toBe(true);
  });

  it('uses the clicked pane when two headers share a page', async () => {
    const fetcher = vi.fn(async (url) => response(String(url).includes('/llm-usage/pane') ? ready : {}));
    vi.stubGlobal('fetch', fetcher);
    render(<><TerminalHeader settings={{ theme: 'default' }} t={t} paneInfo={info('split-a')} />
      <TerminalHeader settings={{ theme: 'default' }} t={t} paneInfo={info('split-b')} /></>);
    fireEvent.click(screen.getAllByRole('button', { name: '사용량', exact: true })[1]);
    await screen.findByText('gpt-test-model');
    expect(fetcher.mock.calls.find(([url]) => String(url).includes('/llm-usage/pane'))[0]).toContain('session_id=split-b');
    expect(screen.getByText(/Pane split-b/)).toBeTruthy();
  });

  it('shows the opt-in explanation and can retry a failed request', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response({ status: 'disabled' }));
    vi.stubGlobal('fetch', fetcher);
    const view = render(modal('error-a'));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(screen.queryByRole('button', { name: '새로고침', exact: true })).toBeNull();
    view.rerender(modal('error-a', { isOpen: false }));
    view.rerender(modal('error-a'));
    await screen.findByText(ko.llmUsageOff);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('loads once while open and does not poll after closing', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(response(ready));
    vi.stubGlobal('fetch', fetcher);
    const view = render(modal('poll-a'));
    await act(async () => {});
    const calls = fetcher.mock.calls.length;
    expect(calls).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    expect(fetcher).toHaveBeenCalledTimes(calls);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
});
