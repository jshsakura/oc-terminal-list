import { beforeEach, expect, it } from 'vitest';
import restoreLiveOutput from './restoreLiveOutput';

beforeEach(() => { fetch.mockReset(); });

it('keeps input-mode restoration separate from an explicit bottom action', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ available: true, offset: 0 }) });
  expect(await restoreLiveOutput('session', 'host')).toBe(true);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ session_id: 'session', host_id: 'host', offset: 0 });
  expect(await restoreLiveOutput('session', 'host', { toBottom: true })).toBe(true);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ session_id: 'session', host_id: 'host', action: 'bottom' });
});

it('does not report a failed or unavailable return as success', async () => {
  fetch.mockResolvedValueOnce({ ok: false });
  expect(await restoreLiveOutput('session', null, { toBottom: true })).toBe(false);
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ available: false, offset: 0 }) });
  expect(await restoreLiveOutput('session', null, { toBottom: true })).toBe(false);
  fetch.mockRejectedValueOnce(new Error('connection lost'));
  expect(await restoreLiveOutput('session', null, { toBottom: true })).toBe(false);
});
