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

  it('에이전트가 쓴 제목이 프로세스 이름을 이긴다', () => {
    render(<FleetBoard targets={[target({ command: 'node', title: '테스트 고치는 중' })]} t={t} />);
    expect(screen.getByText('테스트 고치는 중')).toBeTruthy();
    expect(screen.queryByText('node')).toBeNull();
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
