import { describe, it, expect } from 'vitest';
import { deriveBusy, sameSet, BUSY_WINDOW_MS } from './busyActivity';

const tabs = [
  { id: 't1', panes: [{ id: 'p1' }, { id: 'p2' }] },
  { id: 't2', panes: [{ id: 'p3' }] },
];

describe('deriveBusy', () => {
  it('marks panes seen inside the window and the tabs holding them', () => {
    const now = 10_000;
    const r = deriveBusy({ activity: new Map([['p1', now - 100]]), tabs, now });

    expect([...r.panes]).toEqual(['p1']);
    expect([...r.tabs]).toEqual(['t1']);
    expect(r.idle).toBe(false);
  });

  it('drops entries older than the window', () => {
    const now = 10_000;
    const activity = new Map([
      ['p1', now - 100],
      ['p3', now - BUSY_WINDOW_MS - 1],
    ]);
    const r = deriveBusy({ activity, tabs, now });

    expect(r.panes.has('p3')).toBe(false);
    expect(r.tabs.has('t2')).toBe(false);
    expect([...r.activity.keys()]).toEqual(['p1']);
  });

  it('does not mutate the map it was given', () => {
    const now = 10_000;
    const activity = new Map([['p1', now - BUSY_WINDOW_MS - 1]]);
    deriveBusy({ activity, tabs, now });

    expect(activity.size).toBe(1);
  });

  // The timer is stopped on idle, so a wrong `idle` here means either a stuck
  // indicator (never restarts) or the 6.7Hz tick running forever again.
  it('reports idle only when nothing is left to expire', () => {
    const now = 10_000;
    expect(deriveBusy({ activity: new Map(), tabs, now }).idle).toBe(true);
    expect(deriveBusy({ activity: new Map([['p1', now - BUSY_WINDOW_MS - 1]]), tabs, now }).idle).toBe(true);
    expect(deriveBusy({ activity: new Map([['p1', now - 10]]), tabs, now }).idle).toBe(false);
  });

  it('ignores activity from panes that no longer belong to a tab', () => {
    const now = 10_000;
    const r = deriveBusy({ activity: new Map([['gone', now - 10]]), tabs, now });

    expect(r.panes.has('gone')).toBe(true);   // still tracked...
    expect(r.tabs.size).toBe(0);              // ...but lights up no tab
    expect(r.idle).toBe(false);
  });

  it('survives tabs with no panes', () => {
    const now = 10_000;
    const r = deriveBusy({ activity: new Map([['p1', now]]), tabs: [{ id: 'empty' }], now });
    expect(r.tabs.size).toBe(0);
  });
});

describe('sameSet', () => {
  it('compares by membership, not identity', () => {
    expect(sameSet(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameSet(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameSet(new Set(), new Set())).toBe(true);
  });
});
