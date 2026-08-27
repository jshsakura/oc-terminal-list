import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HostRow } from '../HomeDashboard';

const base = { name: 'rpi5', subtitle: 'pi@100.90.58.69', accentColor: '#89b4fa' };

describe('호스트 카드의 리모트 표시', () => {
  /* ⚠️ 아이콘만으로는 무엇인지 알 수 없어 아무도 안 누른다 — 라벨이 있어야 한다. */
  test('안 깔렸으면 이유가 붙은 라벨을 보여준다', () => {
    render(<HostRow {...base} remoteState="off" onInstallRemote={vi.fn()}
      remoteOffLabel="리모트 미설치" remoteOffTitle="깔면 알림이 오고 명령을 보낼 수 있습니다" />);
    const chip = screen.getByTitle(/알림이 오고 명령을 보낼 수 있습니다/);
    expect(chip).toHaveTextContent('리모트 미설치');
  });

  test('누르면 바로 설치한다 — 설정 창을 거치지 않는다', () => {
    const install = vi.fn();
    render(<HostRow {...base} remoteState="off" onInstallRemote={install} remoteOffLabel="리모트 미설치" />);
    fireEvent.click(screen.getByText('리모트 미설치'));
    expect(install).toHaveBeenCalled();
  });

  /* ⚠️ 설치는 수십 초 걸린다. 표시가 없으면 다시 눌러 같은 설치가 겹쳐 돈다. */
  test('설치 중에는 다시 눌리지 않는다', () => {
    const install = vi.fn();
    render(<HostRow {...base} remoteState="off" onInstallRemote={install}
      remoteBusy remoteBusyLabel="설치 중…" remoteOffLabel="리모트 미설치" />);
    fireEvent.click(screen.getByText('설치 중…'));
    expect(install).not.toHaveBeenCalled();
  });

  test('설치되면 라벨이 사라지고 연결 표시만 남는다', () => {
    render(<HostRow {...base} remoteState="on" remoteOnTitle="리모트 연결됨"
      remoteOffLabel="리모트 미설치" onInstallRemote={vi.fn()} />);
    expect(screen.queryByText('리모트 미설치')).toBeNull();
    expect(screen.getByTitle('리모트 연결됨')).toBeTruthy();
  });

  /* 실패를 조용히 되돌리면 눌렀는지도 모른다. */
  test('실패는 카드에 남는다', () => {
    render(<HostRow {...base} remoteState="off" onInstallRemote={vi.fn()}
      remoteFailed remoteFailedLabel="설치 실패" remoteOffLabel="리모트 미설치" />);
    expect(screen.getByText('설치 실패')).toBeTruthy();
  });

  /* ⚠️ **버튼처럼 보이면 안 된다.** 카드가 알려주는 사실이고 누를 수 있다는 건 부수적이다.
     테두리·면을 주면 우상단에 버튼이 하나 더 생긴 것처럼 읽히고, 카드가 좁아 답답해진다. */
  test('정보성이다 — 테두리도 면도 없다', () => {
    const { container } = render(
      <HostRow {...base} remoteState="off" onInstallRemote={vi.fn()} remoteOffLabel="리모트 미설치" />,
    );
    const chip = container.querySelector('button');
    // jsdom 은 `border: none` 을 border-style 로 정규화한다 — 읽히는 쪽으로 잰다.
    expect(chip.style.borderStyle).toBe('none');
    expect(chip.style.background).toBe('transparent');
  });

  test('우상단에 고정된다 — 액션 버튼과 같은 줄에 서지 않는다', () => {
    const { container } = render(
      <HostRow {...base} remoteState="on" remoteOnTitle="연결됨" onEdit={vi.fn()} editTitle="설정" />,
    );
    const badge = container.querySelector('[title="연결됨"]');
    expect(badge.style.position).toBe('absolute');
    expect(badge.style.top).toBeTruthy();
    expect(badge.style.right).toBeTruthy();
  });
});
