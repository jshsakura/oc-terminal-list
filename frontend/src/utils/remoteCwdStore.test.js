import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { setRenderPaused } from './renderPause';
import {
  _resetRemoteCwd,
  applyRemoteCwdChanges,
  getRemoteCwd,
  subscribeRemoteCwd,
} from './remoteCwdStore';

beforeEach(() => _resetRemoteCwd());
afterEach(() => { _resetRemoteCwd(); setRenderPaused(false); });

it('coalesces path changes during rest including a return to the published path', () => {
  applyRemoteCwdChanges('h1', { mobile: '/original', gone: '/old' });
  const listener = vi.fn();
  subscribeRemoteCwd(listener);
  setRenderPaused(true);

  applyRemoteCwdChanges('h1', { mobile: '/temporary' });
  applyRemoteCwdChanges('h1', { mobile: '/original', gone: null });

  expect(listener).not.toHaveBeenCalled();
  expect(getRemoteCwd('h1', 'gone')).toBe('/old');
  setRenderPaused(false);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(getRemoteCwd('h1', 'mobile')).toBe('/original');
  expect(getRemoteCwd('h1', 'gone')).toBe('');
});

describe('remote cwd store', () => {
  it('separates identical tmux session names by host', () => {
    applyRemoteCwdChanges('h1', { mobile: '/srv/one' });
    applyRemoteCwdChanges('h2', { mobile: '/srv/two' });

    expect(getRemoteCwd('h1', 'mobile')).toBe('/srv/one');
    expect(getRemoteCwd('h2', 'mobile')).toBe('/srv/two');
  });

  it('does not notify subscribers for an unchanged path', () => {
    const listener = vi.fn();
    subscribeRemoteCwd(listener);

    applyRemoteCwdChanges('h1', { mobile: '/srv/app' });
    applyRemoteCwdChanges('h1', { mobile: '/srv/app' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('removes a session when the backend reports a null path', () => {
    const listener = vi.fn();
    subscribeRemoteCwd(listener);
    applyRemoteCwdChanges('h1', { mobile: '/srv/app' });

    applyRemoteCwdChanges('h1', { mobile: null });

    expect(getRemoteCwd('h1', 'mobile')).toBe('');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores malformed updates', () => {
    const listener = vi.fn();
    subscribeRemoteCwd(listener);

    applyRemoteCwdChanges('', { mobile: '/srv/app' });
    applyRemoteCwdChanges('h1', null);
    applyRemoteCwdChanges('h1', { mobile: '' });

    expect(listener).not.toHaveBeenCalled();
  });
});
