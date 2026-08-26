import { describe, it, expect, vi, afterEach } from 'vitest';
import { FOCUS_DOCK_EVENT, focusCommandDock } from './focusDock';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('focusCommandDock', () => {
  it('도크가 없으면 false — 호출부가 터미널로 폴백할 수 있어야 한다', () => {
    /* 데스크탑에는 도크가 없고, 모바일도 pane 상태에 따라 없다. 여기서 true 를 돌려주면
       터미널이 영영 포커스를 못 받는다. */
    const spy = vi.fn();
    window.addEventListener(FOCUS_DOCK_EVENT, spy);
    expect(focusCommandDock()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener(FOCUS_DOCK_EVENT, spy);
  });

  it('도크가 있으면 이벤트를 쏘고 true', () => {
    document.body.innerHTML = '<div data-testid="command-input-dock"><textarea></textarea></div>';
    const spy = vi.fn();
    window.addEventListener(FOCUS_DOCK_EVENT, spy);
    expect(focusCommandDock()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(FOCUS_DOCK_EVENT, spy);
  });

  it('도크 껍데기만 있고 입력이 없으면 false — 반쪽 상태를 성공으로 읽지 않는다', () => {
    document.body.innerHTML = '<div data-testid="command-input-dock"></div>';
    expect(focusCommandDock()).toBe(false);
  });

  it('동기다 — 탭 제스처 안에서 끝나야 iOS 키보드가 올라온다', () => {
    document.body.innerHTML = '<div data-testid="command-input-dock"><textarea></textarea></div>';
    expect(focusCommandDock()).toBe(true);   // Promise 가 아니다
  });
});
