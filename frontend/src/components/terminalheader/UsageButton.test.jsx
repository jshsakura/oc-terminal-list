import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import UsageButton from './UsageButton';
import TerminalHeader from '../TerminalHeader';
import { ko } from '../../i18n/locales/ko';

const t = (key) => ko[key] || key;
const info = { sessionId: 'pane-a', tabType: 'host', host: { id: 'host-a' }, effectiveTmuxSession: 'work' };
const ready = { status: 'ready', agent: 'Codex', usage: {
  model: 'GPT-6-Astra', effort: 'high', context_tokens: 186000, context_window: 200000,
  input_tokens: 10700000, output_tokens: 42700,
  limits: [{ window_minutes: 300, remaining_percent: 80 }, { window_minutes: 10080, remaining_percent: 45 }],
} };
const response = (data) => ({ ok: true, json: async () => data });
const button = (extra = {}) => <UsageButton info={info} isPaneVisible t={t} onClick={vi.fn()} {...extra} />;
const advance = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const hover = async () => { fireEvent.mouseEnter(screen.getByRole('button', { name: '사용량' })); await advance(300); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(ready)));
  vi.stubGlobal('matchMedia', vi.fn((query) => ({ matches: query === '(hover: hover) and (pointer: fine)', addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('usage hover', () => {
  it('uses current terminal output for the gauge and all tooltip fields without fetching', async () => {
    let update;
    const stop = vi.fn();
    const live = { model: 'GPT-6.2-Astra max', context: '35%', input: '81.9M', output: '331K', remaining: 82 };
    const watchUsage = vi.fn(listener => { update = listener; listener(live); return stop; });
    const view = render(button({ watchUsage }));
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAccessibleDescription('주간 한도 18% 사용');
    await hover();
    expect(screen.getByRole('tooltip')).toHaveTextContent('GPT-6.2-Astra max · 컨텍스트 사용 35% · 입력 토큰 81.9M · 출력 토큰 331K · 주간 한도 18% 사용 (82% 남음)');
    act(() => update({ ...live, context: '36%', remaining: 81 }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('컨텍스트 사용 36%');
    expect(trigger.querySelector('circle[pathLength]')).toHaveAttribute('stroke-dasharray', '19 100');
    expect(fetch).not.toHaveBeenCalled();
    act(() => update(null));
    await advance(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tooltip')).toHaveTextContent('주간 한도 55% 사용');
    act(() => update(live));
    act(() => update(null));
    await advance(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps live output ahead of a pending API response and drops it on switching terminals', async () => {
    let update, resolveFallback;
    const watchUsage = listener => { update = listener; return vi.fn(); };
    fetch.mockImplementation(() => new Promise(resolve => { resolveFallback = resolve; }));
    const view = render(button({ watchUsage }));
    await hover();
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => update({ model: 'gpt-6', context: '0%', input: '0', output: '0', remaining: 82 }));
    await act(async () => resolveFallback(response(ready)));
    expect(screen.getByRole('tooltip')).toHaveTextContent('주간 한도 18% 사용');
    view.rerender(button({ watchUsage: () => vi.fn(), isPaneVisible: false }));
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-description', '주간 한도 18% 사용');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('uses the live value on touch while leaving the detail dialog on demand', async () => {
    window.matchMedia.mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const watchUsage = listener => { listener({ model: 'gpt-6', context: '0%', input: '0', output: '0', remaining: 100 }); return vi.fn(); };
    render(<TerminalHeader settings={{ theme: 'default' }} t={t} paneInfo={info} activeHostId={info.host.id} watchUsage={watchUsage} />);
    const trigger = screen.getByRole('button', { name: '사용량' });
    expect(trigger).toHaveAccessibleDescription('주간 한도 0% 사용');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    await advance(300);
    expect(screen.getByRole('dialog', { name: '세션 사용량' })).toBeTruthy();
    expect(fetch.mock.calls.filter(([url]) => url.includes('/llm-usage/pane'))).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAccessibleDescription('주간 한도 0% 사용');
  });

  it('does not show or fetch a tooltip on touch-only devices, but keeps the detail dialog', async () => {
    window.matchMedia.mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    render(<TerminalHeader settings={{ theme: 'default' }} t={t} paneInfo={{ sessionId: 'mobile-pane', tabType: 'local' }} />);
    const trigger = screen.getByRole('button', { name: '사용량' });
    fireEvent.mouseEnter(trigger);
    fireEvent.focus(trigger);
    await advance(1000);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(fetch.mock.calls.filter(([url]) => url.includes('/llm-usage/pane'))).toHaveLength(0);
    fireEvent.click(trigger);
    await advance(1000);
    expect(screen.getByRole('dialog', { name: '세션 사용량' })).toBeTruthy();
    expect(fetch.mock.calls.filter(([url]) => url.includes('/llm-usage/pane'))).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    await advance(1000);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(fetch.mock.calls.filter(([url]) => url.includes('/llm-usage/pane'))).toHaveLength(1);
  });

  it.each([[86, 14], [100, 0], [0, 100]])('shows weekly usage in the ring when %i percent remains', async (remaining, used) => {
    fetch.mockResolvedValue(response({ ...ready, usage: { ...ready.usage, limits: [{ window_minutes: 10080, remaining_percent: remaining }] } }));
    const props = { settings: { theme: 'default' }, t, paneInfo: info };
    const view = render(<TerminalHeader {...props} />);
    const trigger = screen.getByRole('button', { name: '사용량' });
    expect(trigger).toHaveAccessibleDescription('주간 한도 정보 없음');
    expect(trigger.querySelector('circle[pathLength]')).toBeNull();
    await hover();
    expect(trigger).toHaveAttribute('aria-description', `주간 한도 ${used}% 사용`);
    if (used > 0) {
      expect(trigger.querySelector('circle[pathLength]')).toHaveAttribute('stroke-dasharray', `${used} 100`);
    } else {
      expect(trigger.querySelector('circle[pathLength]')).toBeNull();
    }
    fireEvent.mouseLeave(trigger);
    await advance(1000);
    expect(trigger).toHaveAccessibleDescription(`주간 한도 ${used}% 사용`);
    view.rerender(<TerminalHeader {...props} paneInfo={{ ...info, sessionId: 'other-pane' }} />);
    expect(screen.getByRole('button', { name: '사용량' })).toHaveAccessibleDescription('주간 한도 정보 없음');
  });

  it('keeps the mobile ring after opening details and ignores a five-hour-only result', async () => {
    window.matchMedia.mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    render(<TerminalHeader settings={{ theme: 'default' }} t={t} paneInfo={info} />);
    const trigger = screen.getByRole('button', { name: '사용량' });
    fireEvent.click(trigger);
    await advance(50);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAccessibleDescription('주간 한도 55% 사용');
    fetch.mockResolvedValue(response({ ...ready, usage: { ...ready.usage, limits: [{ window_minutes: 300, remaining_percent: 80 }] } }));
    fireEvent.click(trigger);
    await advance(50);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAccessibleDescription('주간 한도 정보 없음');
    expect(trigger.querySelector('circle[pathLength]')).toBeNull();
    await advance(90000);
    expect(fetch.mock.calls.filter(([url]) => url.includes('/llm-usage/pane'))).toHaveLength(2);
  });

  it('closes and aborts when hover support is removed', async () => {
    const query = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    window.matchMedia.mockReturnValue(query);
    fetch.mockImplementation(() => new Promise(() => {}));
    const view = render(button());
    await hover();
    const signal = fetch.mock.calls[0][1].signal;
    const change = query.addEventListener.mock.calls.find(([name]) => name === 'change')?.[1];
    expect(change).toBeTypeOf('function');
    act(() => { query.matches = false; change({ matches: false }); });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(signal.aborted).toBe(true);
    view.unmount();
    expect(query.removeEventListener).toHaveBeenCalledWith('change', change);
  });

  it('ignores passing hovers, then shows all six fields with one current-pane request and no polling', async () => {
    render(button());
    const trigger = screen.getByRole('button', { name: '사용량' });
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.mouseEnter(trigger);
    await advance(299);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.mouseLeave(trigger);
    await advance(1000);
    expect(fetch).not.toHaveBeenCalled();
    await hover();
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('GPT-6-Astra high · 컨텍스트 사용 93% · 입력 토큰 10.7M · 출력 토큰 42.7K · 주간 한도 55% 사용 (45% 남음)');
    const colors = Array.from(tip.querySelectorAll('span'), item => item.style.color);
    expect(colors).toHaveLength(5);
    expect(colors).not.toContain('');
    expect(new Set(colors).size).toBe(5);
    expect(trigger).toHaveAttribute('aria-describedby', tip.id);
    const url = new URL(fetch.mock.calls[0][0], 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({ session_id: 'pane-a', current_only: 'true', host_id: 'host-a', tmux_session: 'work' });
    await advance(90000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('allows moving into the tooltip, then closes on leaving and refreshes on reopening', async () => {
    render(button());
    await hover();
    fireEvent.mouseLeave(screen.getByRole('button'));
    fireEvent.mouseEnter(screen.getByRole('tooltip'));
    await advance(1000);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.mouseLeave(screen.getByRole('tooltip'));
    await advance(150);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fetch.mockResolvedValue(response({ ...ready, usage: { ...ready.usage, model: 'new-model' } }));
    await hover();
    expect(screen.getByRole('tooltip')).toHaveTextContent('new-model');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('supports keyboard focus and Escape without opening the modal', async () => {
    const onClick = vi.fn();
    render(button({ onClick }));
    fireEvent.focus(screen.getByRole('button'));
    await advance(300);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-describedby');
  });

  it('cancels a pending tooltip with Escape or focus leaving before the delay', async () => {
    render(button());
    const trigger = screen.getByRole('button');
    fireEvent.focus(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    await advance(1000);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    await advance(1000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ isPaneVisible: false }, { disabled: true }, { active: true }])('aborts and stays closed when %o', async (extra) => {
    fetch.mockImplementation(() => new Promise(() => {}));
    const view = render(button());
    await hover();
    expect(screen.getByRole('tooltip')).toHaveTextContent(ko.loading);
    const signal = fetch.mock.calls[0][1].signal;
    view.rerender(button(extra));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(signal.aborted).toBe(true);
    await hover();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves zero values and distinguishes missing values from zero', async () => {
    fetch.mockResolvedValue(response({ ...ready, usage: { model: 'test', context_tokens: 0, context_window: 200000, input_tokens: 0 } }));
    render(button());
    await hover();
    expect(screen.getByRole('tooltip')).toHaveTextContent('test — · 컨텍스트 사용 0% · 입력 토큰 0 · 출력 토큰 — · 주간 한도 — 남음');
  });

  it.each(['session_unmatched', 'disabled', 'no_agent'])('explains %s without inventing usage', async (status) => {
    fetch.mockResolvedValue(response({ status }));
    render(button());
    await hover();
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('GPT-6-Astra');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('0%');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(ko.loading);
  });

  it('shows a failure and retries on the next hover', async () => {
    fetch.mockRejectedValueOnce(new Error('offline'));
    render(button());
    await hover();
    expect(screen.getByRole('tooltip')).toHaveTextContent('offline');
    fireEvent.mouseLeave(screen.getByRole('button'));
    await advance(150);
    await hover();
    expect(screen.getByRole('tooltip')).toHaveTextContent('GPT-6-Astra');
  });

  it('keeps click behavior and discards the tooltip on a pane change', async () => {
    const props = { settings: { theme: 'default' }, t, paneInfo: info };
    const view = render(<TerminalHeader {...props} />);
    await hover();
    const request = fetch.mock.calls.find(([url]) => url.includes('/api/llm-usage/pane'));
    view.rerender(<TerminalHeader {...props} paneInfo={{ ...info, sessionId: 'pane-b' }} />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(request[1].signal.aborted).toBe(true);
    await hover();
    expect(fetch.mock.calls.at(-1)[0]).toContain('session_id=pane-b');
    fireEvent.click(screen.getByRole('button', { name: '사용량' }));
    await advance(300);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('dialog', { name: '세션 사용량' })).toBeTruthy();
  });
});
