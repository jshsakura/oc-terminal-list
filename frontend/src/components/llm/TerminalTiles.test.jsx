import { describe, it, expect } from 'vitest';
import { buildHostRows } from './TerminalTiles.jsx';

/**
 * Where the per-host bars vanished entirely — the response field is `by_target`.
 * Get the name wrong and you get an empty array: the screen just says "no data",
 * and nothing errors.
 */
describe('buildHostRows', () => {
  const hosts = [
    { id: 'h1', name: 'rpi', color_index: 1 },
    { id: 'h2', name: 'ubuntu-ai', color_index: 2 },
  ];

  it('reads by_target and sorts by seconds desc', () => {
    const rows = buildHostRows(
      {
        by_target: [
          { target_type: 'host', target_id: 'h1', total_seconds: 100 },
          { target_type: 'host', target_id: 'h2', total_seconds: 900 },
        ],
      },
      hosts,
      {},
      null,
    );
    expect(rows.map((r) => [r.name, r.cost])).toEqual([['ubuntu-ai', 900], ['rpi', 100]]);
  });

  it('names the local target from settings', () => {
    const rows = buildHostRows(
      { by_target: [{ target_type: 'local', target_id: 'local', total_seconds: 42 }] },
      hosts,
      { localName: '내 서버' },
      null,
    );
    expect(rows[0].name).toBe('내 서버');
  });

  it('drops targets whose host no longer exists', () => {
    const rows = buildHostRows(
      {
        by_target: [
          { target_type: 'host', target_id: 'gone', total_seconds: 500 },
          { target_type: 'host', target_id: 'h1', total_seconds: 10 },
        ],
      },
      hosts,
      {},
      null,
    );
    expect(rows.map((r) => r.name)).toEqual(['rpi']);
  });

  it('returns [] when the payload is missing or empty', () => {
    expect(buildHostRows(null, hosts, {}, null)).toEqual([]);
    expect(buildHostRows({}, hosts, {}, null)).toEqual([]);
    // The old typo field must not be read any more — reading it would be the regression.
    expect(buildHostRows({ targets: [{ target_id: 'h1', total_seconds: 1 }] }, hosts, {}, null)).toEqual([]);
  });
});

