import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { KeyStats } from './LlmTiles';

/* 파생 지표 다섯 줄. 숫자만 있고 그림이 없으면 좁은 화면에서 라벨을 읽어야만 구분되는데,
   그러라고 있는 줄이 아니다. 아이콘은 **서로도, 대시보드의 다른 글리프와도** 겹치면 안 된다 —
   같은 그림이 다른 숫자를 가리키면 안 붙인 것만 못하다. */

const totals = { cost: 100, tokens: 5_000_000, output: 250_000, sessions: 4, days: 3 };
const sessions = [{ cost: 1 }, { cost: 5 }, { cost: 40 }];
const money = (v) => `₩${Math.round(v)}`;

const iconClasses = (container) =>
  Array.from(container.querySelectorAll('svg'))
    .flatMap((svg) => Array.from(svg.classList))
    .filter((c) => c.startsWith('lucide-') && c !== 'lucide');

describe('KeyStats', () => {
  it('다섯 줄에 각각 아이콘이 붙는다', () => {
    const { container } = render(<KeyStats totals={totals} sessions={sessions} money={money} />);
    expect(container.querySelectorAll('svg')).toHaveLength(5);
  });

  it('아이콘이 서로 겹치지 않는다', () => {
    const { container } = render(<KeyStats totals={totals} sessions={sessions} money={money} />);
    const classes = iconClasses(container);
    expect(classes).toHaveLength(5);
    expect(new Set(classes).size).toBe(5);
  });

  /* 위 타일(Wallet/Hash/MessagesSquare/DatabaseZap)과 아래 막대·헤더(Bot/Server/Cpu/
     FolderGit2/TrendingUp/History/Clock/Layers/CalendarDays/RefreshCw/Trash2)에서 이미
     쓰는 글리프는 재사용 금지. 새 아이콘을 고를 때 이 목록을 먼저 볼 것. */
  it('대시보드의 다른 글리프를 재사용하지 않는다', () => {
    const taken = [
      'lucide-wallet', 'lucide-hash', 'lucide-messages-square', 'lucide-database-zap',
      'lucide-bot', 'lucide-server', 'lucide-cpu', 'lucide-folder-git-2',
      'lucide-trending-up', 'lucide-history', 'lucide-clock', 'lucide-layers',
      'lucide-calendar-days', 'lucide-refresh-cw', 'lucide-trash-2',
    ];
    const { container } = render(<KeyStats totals={totals} sessions={sessions} money={money} />);
    expect(iconClasses(container).filter((c) => taken.includes(c))).toEqual([]);
  });

  it('세션이 없어도 0 으로 그린다 (빈 배열에 터지지 않는다)', () => {
    const { container } = render(
      <KeyStats totals={{ cost: 0, tokens: 0, output: 0, sessions: 0 }} sessions={[]} money={money} />
    );
    expect(container.querySelectorAll('svg')).toHaveLength(5);
  });
});
