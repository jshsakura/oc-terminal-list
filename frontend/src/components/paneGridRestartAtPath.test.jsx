import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

/**
 * "경로 지정해 재시작" 배선 테스트.
 *
 * 이 동작은 네 조각을 지난다: 메뉴(PaneGrid) → 폴더 픽커(App 소유) → 확인 → 재시작
 * (Pane 이 등록한 액션). **중간의 어느 한 칸이 끊겨도 조용하다** — 픽커는 멀쩡히 뜨고
 * 닫히고, 아무 일도 안 일어난다. 그래서 여기서는 목이 아니라 **실제로 그 사슬을 끝까지
 * 굴린다**: 슬롯이 들고 온 `onPicked` 를 부르고, 확인을 승인하고, 재시작이 **고른 경로를
 * 인자로** 받았는지 본다.
 *
 * 같은 이유의 이웃: `paneGridClose.test.jsx`(구조 검사는 동작을 대신하지 못한다).
 */
const { seen } = vi.hoisted(() => ({ seen: [] }));

vi.mock('./panegrid/Pane', () => ({
  default: (props) => { seen.push(props); return null; },
}));

const PaneGrid = (await import('./PaneGrid')).default;

const LOCAL_PANE = { id: 'pane-a', sessionId: 'sess-a' };
const HOST_PANE = { id: 'pane-b', hostId: 'host-1' };
const TAB = { id: 'tab-1', layout: 'h', panes: [LOCAL_PANE, HOST_PANE] };
const HOSTS = [{ id: 'host-1', name: 'rpi5' }];

const propsFor = (paneId) => seen.filter((p) => p.pane?.id === paneId).at(-1);

describe('PaneGrid — 경로 지정해 재시작', () => {
  let onPickLocalPath; let onPickHostPath; let onConfirm; let onNotify; let restart;

  const renderGrid = () => {
    onPickLocalPath = vi.fn();
    onPickHostPath = vi.fn();
    onConfirm = vi.fn();
    onNotify = vi.fn();
    restart = vi.fn().mockResolvedValue({ ok: true });
    return render(
      <PaneGrid
        tab={TAB}
        hosts={HOSTS}
        settings={{ theme: 'catppuccin', fontSize: 12 }}
        onPickLocalPath={onPickLocalPath}
        onPickHostPath={onPickHostPath}
        onConfirm={onConfirm}
        onNotify={onNotify}
        t={(k) => k}
      />,
    );
  };

  /** Pane 이 마운트되면 하는 일 — 자기 재시작 액션과 픽커 맥락을 등록한다. */
  const registerPane = (paneId, ctx) => {
    act(() => {
      propsFor(paneId).registerPaneActions(paneId, { restart, restartPathContext: ctx });
    });
  };

  beforeEach(() => { seen.length = 0; });

  it('로컬 pane 은 로컬 픽커를 열고, 고른 경로로 재시작한다', async () => {
    renderGrid();
    registerPane('pane-a', { isLocal: true, hostId: null, initialPath: 'proj' });

    act(() => { propsFor('pane-a').onRestartPaneAtPath('pane-a'); });

    expect(onPickHostPath).not.toHaveBeenCalled();
    const slot = onPickLocalPath.mock.calls[0][0];
    // 픽커는 지금 있는 자리에서 시작한다 — 매번 루트로 되돌아가면 고르는 일이 일이 된다.
    expect(slot).toMatchObject({ tabId: 'tab-1', paneId: 'pane-a', initial: 'proj' });

    act(() => { slot.onPicked('proj/sub'); });
    const confirm = onConfirm.mock.calls[0][0];
    // 잘못 고른 것을 되돌릴 수 있는 마지막 지점이라, 고른 경로가 문구에 있어야 한다.
    expect(confirm.message).toContain('proj/sub');

    await act(async () => { await confirm.onConfirm(); });
    expect(restart).toHaveBeenCalledWith('proj/sub');
  });

  it('원격 pane 은 그 호스트의 픽커를 연다', () => {
    renderGrid();
    registerPane('pane-b', { isLocal: false, hostId: 'host-1', initialPath: '/home/pi/app' });

    act(() => { propsFor('pane-b').onRestartPaneAtPath('pane-b'); });

    expect(onPickLocalPath).not.toHaveBeenCalled();
    const [host, slot] = onPickHostPath.mock.calls[0];
    expect(host.id).toBe('host-1');
    expect(slot).toMatchObject({ tabId: 'tab-1', paneId: 'pane-b', initial: '/home/pi/app' });
  });

  it('로컬의 빈 경로는 워크스페이스 루트라고 말한다', () => {
    renderGrid();
    registerPane('pane-a', { isLocal: true, hostId: null, initialPath: '' });

    act(() => { propsFor('pane-a').onRestartPaneAtPath('pane-a'); });
    act(() => { onPickLocalPath.mock.calls[0][0].onPicked(''); });

    // '' 를 그대로 보여주면 아무 말도 아니다.
    expect(onConfirm.mock.calls[0][0].message).toContain('workspaceRoot');
  });

  it('확인하기 전에는 아무것도 죽지 않는다', () => {
    renderGrid();
    registerPane('pane-a', { isLocal: true, hostId: null, initialPath: '' });

    act(() => { propsFor('pane-a').onRestartPaneAtPath('pane-a'); });
    act(() => { onPickLocalPath.mock.calls[0][0].onPicked('proj'); });

    expect(restart).not.toHaveBeenCalled();
  });

  it('재시작이 실패하면 조용히 넘어가지 않는다', async () => {
    renderGrid();
    restart.mockResolvedValue({ ok: false, error: 'boom' });
    registerPane('pane-a', { isLocal: true, hostId: null, initialPath: '' });

    act(() => { propsFor('pane-a').onRestartPaneAtPath('pane-a'); });
    act(() => { onPickLocalPath.mock.calls[0][0].onPicked('proj'); });
    await act(async () => { await onConfirm.mock.calls[0][0].onConfirm(); });

    expect(onNotify).toHaveBeenCalledWith('restartSessionFailed');
  });

  it('맥락을 등록하지 않은 pane 은 픽커를 열지 않는다', () => {
    renderGrid();
    act(() => { propsFor('pane-a').onRestartPaneAtPath('pane-a'); });
    expect(onPickLocalPath).not.toHaveBeenCalled();
  });
});
