import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

/**
 * 닫기 흐름의 배선 테스트.
 *
 * PaneGrid 는 각 Pane 에게 "이 pane 을 닫아라" 콜백을 넘긴다. 그 콜백이 **자기 pane 의
 * id 로** 부모를 부르는지가 세션 종료·탭 종료의 시작점이다.
 *
 * ⚠️ 이 테스트가 없어서 사고가 났다. memo 최적화로 이 콜백들을 id 별로 캐시하도록 바꿨는데,
 *    소스 스캔 가드(인라인이냐)와 단위 테스트 1,500여 개가 전부 통과했다 — 아무도 **실제로
 *    닫아 보지 않았기 때문**이다. 구조를 검사하는 테스트는 동작을 대신하지 못한다.
 *
 * 그래서 여기서는 Pane 을 목으로 두고 **콜백을 실제로 호출**한다. 다시 렌더한 뒤에도
 * 호출한다 — 캐시가 낡거나 엉뚱한 pane 을 잡는 회귀는 그때만 드러난다.
 */
const { seen } = vi.hoisted(() => ({ seen: [] }));

vi.mock('./panegrid/Pane', () => ({
  default: (props) => { seen.push(props); return null; },
}));

const PaneGrid = (await import('./PaneGrid')).default;

const TAB = {
  id: 'tab-1',
  layout: 'single',
  panes: [
    { id: 'pane-a', sessionId: 'sess-a' },
    { id: 'pane-b', sessionId: 'sess-b' },
  ],
};

const propsFor = (paneId) => seen.filter((p) => p.pane?.id === paneId).at(-1);

describe('PaneGrid → Pane 닫기 배선', () => {
  let onClosePane; let onFocusPane; let onActivatePane;

  const renderGrid = () => {
    onClosePane = vi.fn();
    onFocusPane = vi.fn();
    onActivatePane = vi.fn();
    return render(
      <PaneGrid
        tab={TAB}
        settings={{ theme: 'catppuccin', fontSize: 12 }}
        onClosePane={onClosePane}
        onFocusPane={onFocusPane}
        onActivatePane={onActivatePane}
        t={(k) => k}
      />,
    );
  };

  beforeEach(() => { seen.length = 0; });

  it('각 pane 의 onClose 가 자기 id 로 부모를 부른다', () => {
    renderGrid();
    expect(seen.length, 'Pane 이 하나도 안 그려졌다 — 테스트가 낡았다').toBeGreaterThan(0);

    act(() => { propsFor('pane-a').onClose(); });
    expect(onClosePane).toHaveBeenCalledWith('tab-1', 'pane-a');

    act(() => { propsFor('pane-b').onClose(); });
    expect(onClosePane).toHaveBeenCalledWith('tab-1', 'pane-b');
  });

  it('다시 렌더한 뒤에도 여전히 자기 id 로 부른다', () => {
    const { rerender } = renderGrid();
    act(() => {
      rerender(
        <PaneGrid
          tab={TAB}
          settings={{ theme: 'catppuccin', fontSize: 12 }}
          onClosePane={onClosePane}
          onFocusPane={onFocusPane}
          onActivatePane={onActivatePane}
          t={(k) => k}
        />,
      );
    });
    act(() => { propsFor('pane-b').onClose(); });
    expect(onClosePane).toHaveBeenCalledWith('tab-1', 'pane-b');
  });

  it('포커스·활성화도 같은 pane 을 가리킨다', () => {
    renderGrid();
    act(() => { propsFor('pane-b').onFocus(); });
    expect(onFocusPane).toHaveBeenCalledWith('tab-1', 'pane-b');

    act(() => { propsFor('pane-a').onActivate({ type: 'local' }); });
    expect(onActivatePane).toHaveBeenCalledWith('tab-1', 'pane-a', { type: 'local' });
  });
});
