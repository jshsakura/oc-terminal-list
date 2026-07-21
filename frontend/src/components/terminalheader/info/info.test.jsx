import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { formatBytes, formatRate, formatUptime } from './infoFormat';
import { InfoSection, InfoRow, MemoryStackBar, StatBar } from './InfoParts';
import ProcessList from './ProcessList';
import InfoPanel from '../InfoPanel';

// InfoPanel 은 902줄이면서 테스트가 0개였다. 갈라내면서 최소한의 그물을 친다 —
// 프론트엔드엔 ESLint 가 없어서, import 가 끊기면 렌더할 때에야 터진다.

describe('formatBytes', () => {
  it('단위를 올려가며 표기한다', () => {
    expect(formatBytes(0)).toMatch(/^0/);
    expect(formatBytes(1024)).toMatch(/KB|K/);
    expect(formatBytes(1024 ** 2)).toMatch(/MB|M/);
    expect(formatBytes(1024 ** 3)).toMatch(/GB|G/);
  });

  it('숫자가 아니면 터지지 않는다', () => {
    expect(() => formatBytes(null)).not.toThrow();
    expect(() => formatBytes(undefined)).not.toThrow();
  });
});

describe('formatRate', () => {
  it('바이트 표기에 /s 를 붙인다', () => {
    expect(formatRate(1024)).toMatch(/\/s$/);
  });
});

describe('formatUptime', () => {
  const t = (k) => k;
  it('초를 사람이 읽는 단위로 접는다', () => {
    expect(formatUptime(30, t)).toBeTruthy();
    expect(formatUptime(3600, t)).toBeTruthy();
    expect(formatUptime(86400 * 3, t)).toBeTruthy();
  });

  it('빈 값에 터지지 않는다', () => {
    expect(() => formatUptime(0, t)).not.toThrow();
    expect(() => formatUptime(null, t)).not.toThrow();
  });
});

describe('표시 조각 렌더 스모크', () => {
  it('InfoSection / InfoRow', () => {
    render(<InfoSection title="제목"><InfoRow label="키" value="값" /></InfoSection>);
    expect(screen.getByText('제목')).toBeTruthy();
    expect(screen.getByText('값')).toBeTruthy();
  });

  it('StatBar 는 퍼센트를 받아 그린다', () => {
    const { container } = render(<StatBar label="CPU" percent={42} right="42%" />);
    expect(container.firstChild).toBeTruthy();
  });

  it('MemoryStackBar 가 메모리/스왑 통계를 그린다', () => {
    // stats 는 InfoPanel 이 `stats &&` 로 가드한 뒤에만 넘긴다 — null 계약은 없다.
    expect(() => render(<MemoryStackBar stats={{
      memory: 40, mem_total: 8 * 1024 ** 3, mem_used: 3 * 1024 ** 3,
      swap: 0, swap_total: 0, swap_used: 0,
    }} />)).not.toThrow();
  });
});

describe('ProcessList', () => {
  it('프로세스를 나열한다', () => {
    render(<ProcessList
      processes={[{ pid: 1234, name: 'node', rss_bytes: 1024 ** 2 * 50, cpu_percent: 3.2 }]}
      onRefresh={vi.fn()}
    />);
    expect(screen.getByText(/node/)).toBeTruthy();
  });

  it('빈 목록에서도 터지지 않는다', () => {
    // 호출부는 length>0 일 때만 렌더하지만, 빈 배열 정도는 견뎌야 한다.
    expect(() => render(<ProcessList processes={[]} onRefresh={vi.fn()} />)).not.toThrow();
  });
});

describe('InfoPanel 통합 렌더', () => {
  beforeEach(() => {
    // useSystemStats 가 마운트 즉시 폴링한다 — 네트워크를 막아 둔다.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('세션 정보를 받아 그린다', () => {
    const { container } = render(<InfoPanel
      info={{ paneId: 'p1', sessionId: 's1', tabType: 'local', cwd: '/home/ubuntu' }}
      paneThemeId={null} globalThemeId="catppuccin" t={(k) => k}
    />);
    expect(container.firstChild).toBeTruthy();
  });

  it('info 가 없어도 터지지 않는다', () => {
    expect(() => render(<InfoPanel info={null} paneThemeId={null} globalThemeId="catppuccin" t={(k) => k} />)).not.toThrow();
  });
});
