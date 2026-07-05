import { describe, it, expect } from 'vitest';
import { deriveTabPrimaryIdentity, deriveTabSecondaryIdentities, paneIdentityKey } from './tabModel';

const HOSTS = [
  { id: 'h-argon', name: 'ArgonEON', icon: null, color_index: 36 },
  { id: 'h-pve', name: 'Proxmox VE', icon: 'Atom', color_index: 44 },
  { id: 'h-nas', name: 'TrueNAS Scale', icon: 'PieChart', color_index: 13 },
];

describe('paneIdentityKey', () => {
  it('groups host panes by hostId and local panes as one identity', () => {
    expect(paneIdentityKey({ hostId: 'h-pve' })).toBe('host:h-pve');
    expect(paneIdentityKey({ sessionId: 's1' })).toBe('local');
    expect(paneIdentityKey({})).toBeNull();
  });
});

describe('deriveTabSecondaryIdentities', () => {
  it('returns empty for a single-pane tab', () => {
    const tab = { panes: [{ id: 'p1', hostId: 'h-pve' }], activePaneId: 'p1' };
    expect(deriveTabSecondaryIdentities(tab, HOSTS)).toEqual([]);
  });

  it('returns empty when all panes share the same host', () => {
    const tab = {
      panes: [{ id: 'p1', hostId: 'h-pve' }, { id: 'p2', hostId: 'h-pve' }],
      activePaneId: 'p1',
    };
    expect(deriveTabSecondaryIdentities(tab, HOSTS)).toEqual([]);
  });

  it('returns the non-active host meta when two hosts are mixed', () => {
    const tab = {
      panes: [{ id: 'p1', hostId: 'h-argon' }, { id: 'p2', hostId: 'h-pve' }],
      activePaneId: 'p2',
    };
    expect(deriveTabSecondaryIdentities(tab, HOSTS)).toEqual([
      { kind: 'host', name: 'ArgonEON', icon: '', colorIndex: 36 },
    ]);
  });

  it('returns every distinct non-active identity in pane order, deduped', () => {
    const tab = {
      panes: [
        { id: 'p1', hostId: 'h-pve' },
        { id: 'p2', hostId: 'h-argon' },
        { id: 'p3', hostId: 'h-nas' },
        { id: 'p4', hostId: 'h-argon' }, // 중복 — 한 번만
      ],
      activePaneId: 'p1',
    };
    expect(deriveTabSecondaryIdentities(tab, HOSTS).map((s) => s.name)).toEqual([
      'ArgonEON', 'TrueNAS Scale',
    ]);
  });

  it('returns local meta when a host pane mixes with a local pane', () => {
    const tab = {
      panes: [{ id: 'p1', hostId: 'h-pve' }, { id: 'p2', sessionId: 's1' }],
      activePaneId: 'p1',
    };
    const settings = { localName: 'dev-box', localIcon: 'Monitor', localColorIndex: 24 };
    expect(deriveTabSecondaryIdentities(tab, HOSTS, settings)).toEqual([
      { kind: 'local', name: 'dev-box', icon: 'Monitor', colorIndex: 24 },
    ]);
  });

  it('ignores empty panes (no session, no host)', () => {
    const tab = {
      panes: [{ id: 'p1', hostId: 'h-pve' }, { id: 'p2' }],
      activePaneId: 'p1',
    };
    expect(deriveTabSecondaryIdentities(tab, HOSTS)).toEqual([]);
  });
});

describe('deriveTabPrimaryIdentity', () => {
  it('follows the active host pane', () => {
    const tab = {
      panes: [{ id: 'p1', hostId: 'h-argon' }, { id: 'p2', hostId: 'h-pve' }],
      activePaneId: 'p2',
    };
    expect(deriveTabPrimaryIdentity(tab, HOSTS)).toEqual(
      { kind: 'host', name: 'Proxmox VE', icon: 'Atom', colorIndex: 44 },
    );
  });

  it('follows the active local pane even inside a host tab (no host duplicate)', () => {
    // 버그 재현: 호스트 탭에서 활성 pane 이 로컬이면 주 타일이 탭 호스트로 폴백해
    // secondaries(호스트 포함)와 같은 아이콘이 두 번 보였다. 주 정체성은 로컬이어야 한다.
    const tab = {
      type: 'host', hostId: 'h-argon',
      panes: [{ id: 'p1', hostId: 'h-argon' }, { id: 'p2', sessionId: 's1' }, { id: 'p3', hostId: 'h-nas' }],
      activePaneId: 'p2',
    };
    const settings = { localName: 'dev-box', localIcon: 'Monitor', localColorIndex: 24 };
    expect(deriveTabPrimaryIdentity(tab, HOSTS, settings)).toEqual(
      { kind: 'local', name: 'dev-box', icon: 'Monitor', colorIndex: 24 },
    );
    // 그때 secondaries 는 로컬을 빼고 두 호스트만 — 합치면 세 정체성이 정확히 한 번씩.
    expect(deriveTabSecondaryIdentities(tab, HOSTS, settings).map((s) => s.name)).toEqual(
      ['ArgonEON', 'TrueNAS Scale'],
    );
  });

  it('returns null when the active host is not in the hosts list', () => {
    const tab = { panes: [{ id: 'p1', hostId: 'h-gone' }], activePaneId: 'p1' };
    expect(deriveTabPrimaryIdentity(tab, HOSTS)).toBeNull();
  });

  it('returns null for an empty pane', () => {
    const tab = { panes: [{ id: 'p1' }], activePaneId: 'p1' };
    expect(deriveTabPrimaryIdentity(tab, HOSTS)).toBeNull();
  });
});
