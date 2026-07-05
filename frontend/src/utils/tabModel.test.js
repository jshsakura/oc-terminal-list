import { describe, it, expect } from 'vitest';
import { deriveTabSecondaryIdentity, paneIdentityKey } from './tabModel';

const HOSTS = [
  { id: 'h-argon', name: 'ArgonEON', icon: null, color_index: 36 },
  { id: 'h-pve', name: 'Proxmox VE', icon: 'Atom', color_index: 44 },
];

describe('paneIdentityKey', () => {
  it('groups host panes by hostId and local panes as one identity', () => {
    expect(paneIdentityKey({ hostId: 'h-pve' })).toBe('host:h-pve');
    expect(paneIdentityKey({ sessionId: 's1' })).toBe('local');
    expect(paneIdentityKey({})).toBeNull();
  });
});

describe('deriveTabSecondaryIdentity', () => {
  it('returns null for a single-pane tab', () => {
    const tab = { panes: [{ id: 'p1', hostId: 'h-pve' }], activePaneId: 'p1' };
    expect(deriveTabSecondaryIdentity(tab, HOSTS)).toBeNull();
  });

  it('returns null when all panes share the same host', () => {
    const tab = {
      panes: [{ id: 'p1', hostId: 'h-pve' }, { id: 'p2', hostId: 'h-pve' }],
      activePaneId: 'p1',
    };
    expect(deriveTabSecondaryIdentity(tab, HOSTS)).toBeNull();
  });

  it('returns the non-active host meta when two hosts are mixed', () => {
    const tab = {
      panes: [{ id: 'p1', hostId: 'h-argon' }, { id: 'p2', hostId: 'h-pve' }],
      activePaneId: 'p2',
    };
    expect(deriveTabSecondaryIdentity(tab, HOSTS)).toEqual({
      kind: 'host', name: 'ArgonEON', icon: '', colorIndex: 36,
    });
  });

  it('returns local meta when a host pane mixes with a local pane', () => {
    const tab = {
      panes: [{ id: 'p1', hostId: 'h-pve' }, { id: 'p2', sessionId: 's1' }],
      activePaneId: 'p1',
    };
    const settings = { localName: 'dev-box', localIcon: 'Monitor', localColorIndex: 24 };
    expect(deriveTabSecondaryIdentity(tab, HOSTS, settings)).toEqual({
      kind: 'local', name: 'dev-box', icon: 'Monitor', colorIndex: 24,
    });
  });

  it('ignores empty panes (no session, no host)', () => {
    const tab = {
      panes: [{ id: 'p1', hostId: 'h-pve' }, { id: 'p2' }],
      activePaneId: 'p1',
    };
    expect(deriveTabSecondaryIdentity(tab, HOSTS)).toBeNull();
  });
});
