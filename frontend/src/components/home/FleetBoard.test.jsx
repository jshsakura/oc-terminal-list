import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FleetBoard, { sortForBoard } from './FleetBoard';
import { ko } from '../../i18n/locales/ko';

const t = (key) => ko[key] || key;

const target = (over = {}) => ({
  addr: '1.1', tabIndex: 1, paneIndex: 1, tabName: 'work', paneId: 'p1',
  kind: 'local', sessionId: 's1', hostId: null, tmuxSession: null,
  command: 'bash', status: 'idle', statusUnknown: false, title: '', ...over,
});

describe('FleetBoard', () => {
  it('물어보지 못한 원격은 "유휴" 가 아니라 "모름" 이다', () => {
    render(<FleetBoard targets={[target({ kind: 'host', hostId: 'h1', statusUnknown: true, status: null })]} t={t} />);
    expect(screen.getByText(ko.fleetUnknown)).toBeTruthy();
    expect(screen.queryByText(ko.fleetIdle)).toBeNull();
  });

  it('손이 필요한 줄이 맨 위에 온다 — 주소순이면 다 읽어야 찾는다', () => {
    const rows = sortForBoard([
      target({ addr: '1.1', status: 'idle' }),
      target({ addr: '2.1', tabIndex: 2, status: 'permission' }),
      target({ addr: '1.2', paneIndex: 2, status: 'working' }),
    ]);
    expect(rows.map((r) => r.addr)).toEqual(['2.1', '1.2', '1.1']);
  });

  it('행을 누르면 그 pane 으로 간다', () => {
    const onOpen = vi.fn();
    render(<FleetBoard targets={[target({ title: 'building' })]} onOpen={onOpen} t={t} />);
    fireEvent.click(screen.getByText('building'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ paneId: 'p1', tabIndex: 1 }));
  });

  it('에이전트가 쓴 제목이 첫 줄, 프로세스 이름은 곁줄', () => {
    render(<FleetBoard targets={[target({ command: 'node', title: '테스트 고치는 중' })]} t={t} />);
    const title = screen.getByText('테스트 고치는 중');
    const cmd = screen.getByText('node');
    // 제목이 위, 명령은 아래 곁줄 — 무엇을 하는 중인지가 어떤 프로그램인지보다 먼저다.
    expect(title.compareDocumentPosition(cmd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('제목이 없으면 명령이 그 자리를 대신한다 — 빈 줄을 두지 않는다', () => {
    render(<FleetBoard targets={[target({ command: 'bash', title: '' })]} t={t} />);
    expect(screen.getByText('bash')).toBeTruthy();
  });

  it('며칠째 도는 중인지 보여준다', () => {
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86400;
    render(<FleetBoard targets={[target({ startedAt: threeDaysAgo })]} t={t} />);
    expect(screen.getByText(`3${ko.unitDay}`)).toBeTruthy();
  });

  it('시작 시각을 모르면 아무 말도 하지 않는다 — 0일이라고 쓰지 않는다', () => {
    render(<FleetBoard targets={[target({ startedAt: null })]} t={t} />);
    expect(screen.queryByText(new RegExp(`^\\d+${ko.unitDay}$`))).toBeNull();
  });

  it('기계 카드는 못 닿은 호스트에 수치를 그리지 않는다 — 0% 는 측정한 것처럼 보인다', () => {
    render(
      <FleetBoard
        targets={[]}
        machines={[{ id: 'h1', reachable: false, paneCount: 2, memUsed: null, memTotal: null }]}
        hosts={[{ id: 'h1', name: 'rpi' }]}
        t={t}
      />,
    );
    expect(screen.getByText('rpi')).toBeTruthy();
    expect(screen.getByText(ko.fleetUnreachable)).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('닿은 기계는 램 비율과 가동 시간을 보여준다', () => {
    render(
      <FleetBoard
        targets={[]}
        machines={[{
          id: 'local', reachable: true, paneCount: 4,
          memUsed: 8 * 1024 ** 3, memTotal: 16 * 1024 ** 3, uptimeSeconds: 5 * 86400,
        }]}
        t={t}
      />,
    );
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText(`5${ko.unitDay}`)).toBeTruthy();
  });

  it('갱신 실패가 화면을 비우지 않는다', () => {
    render(<FleetBoard targets={[target({ title: 'still here' })]} error="boom" t={t} />);
    expect(screen.getByText('still here')).toBeTruthy();
    expect(screen.getByText(ko.fleetStale)).toBeTruthy();
  });

  it('빈 상태도 말을 한다', () => {
    render(<FleetBoard targets={[]} t={t} />);
    expect(screen.getByText(ko.fleetEmpty)).toBeTruthy();
  });
});
