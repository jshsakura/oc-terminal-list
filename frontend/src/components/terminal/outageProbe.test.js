import { describe, it, expect, beforeEach } from 'vitest';
import {
  probeSpacingMs,
  claimProbeLease,
  releaseProbeLease,
  _resetProbeLease,
  LEASE_STALE_MS,
  PROBE_LADDER,
} from './outageProbe';

describe('probeSpacingMs', () => {
  it('starts tight so a quick recovery is felt immediately', () => {
    expect(probeSpacingMs(0)).toBe(3000);
    expect(probeSpacingMs(29_999)).toBe(3000);
  });

  it('backs off as the outage drags on', () => {
    expect(probeSpacingMs(30_000)).toBe(10_000);
    expect(probeSpacingMs(119_999)).toBe(10_000);
    expect(probeSpacingMs(120_000)).toBe(30_000);
    expect(probeSpacingMs(60 * 60_000)).toBe(30_000);
  });

  it('never returns a spacing below the tick that drives it', () => {
    // The interval fires every 3s; a smaller spacing would just mean "every tick".
    for (const step of PROBE_LADDER) expect(step.everyMs).toBeGreaterThanOrEqual(3000);
  });

  // 5m30s outage, measured against what the flat-3s version cost on a 4-way split.
  it('cuts a long outage from hundreds of probes to a couple dozen', () => {
    const OUTAGE = 330_000;
    let t = 0, probes = 0;
    while (t < OUTAGE) { probes += 1; t += probeSpacingMs(t); }

    expect(probes).toBeLessThan(30);
    expect(330_000 / 3000 * 4).toBeGreaterThan(400);   // what it used to be
  });
});

describe('probe lease', () => {
  beforeEach(_resetProbeLease);

  it('lets the first caller in and keeps renewing it', () => {
    expect(claimProbeLease('a', 1000)).toBe(true);
    expect(claimProbeLease('a', 4000)).toBe(true);
  });

  it('locks everyone else out while the holder keeps renewing', () => {
    claimProbeLease('a', 1000);
    expect(claimProbeLease('b', 4000)).toBe(false);
    expect(claimProbeLease('c', 7000)).toBe(false);
  });

  it('hands over once the holder goes quiet', () => {
    claimProbeLease('a', 1000);
    expect(claimProbeLease('b', 1000 + LEASE_STALE_MS + 1)).toBe(true);
    // ...and now b owns it.
    expect(claimProbeLease('a', 1000 + LEASE_STALE_MS + 2)).toBe(false);
  });

  it('frees the lease on explicit release', () => {
    claimProbeLease('a', 1000);
    releaseProbeLease('a');
    expect(claimProbeLease('b', 1100)).toBe(true);
  });

  it('ignores a release from a pane that does not hold it', () => {
    claimProbeLease('a', 1000);
    releaseProbeLease('b');
    expect(claimProbeLease('b', 1100)).toBe(false);
  });
});
