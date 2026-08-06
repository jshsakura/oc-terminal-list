import { describe, it, expect } from 'vitest';
import { buildHostRows } from './TerminalTiles.jsx';

/**
 * 호스트별 막대가 통째로 사라졌던 자리 — 응답 필드는 `by_target` 이다.
 * 이름을 틀리면 빈 배열이 되고 화면은 "데이터 없음" 이라고만 말한다(에러 없음).
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
    // 옛 오타 필드는 더 이상 읽지 않는다 — 읽히면 그게 회귀다.
    expect(buildHostRows({ targets: [{ target_id: 'h1', total_seconds: 1 }] }, hosts, {}, null)).toEqual([]);
  });
});

describe('buildDayBars', () => {
  it('scales heights against the busiest day and marks empty days', async () => {
    const { buildDayBars } = await import('./DayBars.jsx');
    const bars = buildDayBars([
      { day: '2026-08-01', seconds: 0 },
      { day: '2026-08-02', seconds: 3600 },
      { day: '2026-08-03', seconds: 1800 },
    ]);
    expect(bars[0].isEmpty).toBe(true);
    expect(bars[1].height).toBeGreaterThan(bars[2].height);
    // 쉰 날도 바닥선은 남는다 — 0px 이면 그 날이 화면에서 사라진다.
    expect(bars[0].height).toBeGreaterThan(0);
  });

  it('does not divide by zero when nothing was used', async () => {
    const { buildDayBars } = await import('./DayBars.jsx');
    const bars = buildDayBars([{ day: '2026-08-01', seconds: 0 }, { day: '2026-08-02', seconds: 0 }]);
    expect(bars.every((b) => b.height > 0 && b.isEmpty)).toBe(true);
  });
});
