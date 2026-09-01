import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PaneAddressLabel from './PaneAddressLabel';

const badge = (container) => container.querySelector('.iterm-pane-address');

describe('PaneAddressLabel', () => {
  it('pane 번호를 그린다 — 이게 이 pane 의 주소다', () => {
    render(<PaneAddressLabel paneNumber={3} fullAddress="2.3" />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('탭+pane 번호를 한 블록에 담는다 — 떼놓으면 무관한 값 두 개로 보인다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={3} tabNumber={1} fullAddress="1.3" />);
    expect(badge(container).childElementCount).toBe(1);   // 주소 블록 하나
    // 한 덩어리로 읽혀야 한다 — `1` 과 `3` 이 떨어져 있으면 무관한 값 두 개로 보인다.
    expect(badge(container).textContent).toBe('1.3');
  });

  it('탭 번호를 모르면 pane 번호만 — 틀린 주소를 그리느니 안 그린다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={3} tabNumber={null} />);
    expect(badge(container).textContent).toBe('3');
  });

  /* 복사 버튼은 **줄 수 있을 때만** 준다. 핸들이 `itl send 1.2 'TEXT'` 라, 붙여넣는 쪽에
     itl 이 없으면 `command not found` 로 끝난다 — 없는 도구를 쓰라고 내밀지 않는다. */
  it('onCopy 가 없으면 버튼도 없고 클릭도 통과시킨다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={3} tabNumber={1} fullAddress="1.3" />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(badge(container).style.pointerEvents).toBe('none');
  });

  it('onCopy 가 있으면 복사 버튼 하나가 붙고 그것만 클릭 대상이 된다', () => {
    const copy = vi.fn();
    const { container } = render(
      <PaneAddressLabel paneNumber={3} tabNumber={1} fullAddress="1.3" onCopy={copy} copyLabel="복사" />
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(badge(container).style.pointerEvents).toBe('auto');
    fireEvent.click(buttons[0]);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  /* 주소를 읽으려 눌렀을 뿐인데 클립보드가 바뀌면 안 된다 — 복사는 별도 버튼이다. */
  it('주소 숫자에는 클릭 핸들러가 없다', () => {
    const copy = vi.fn();
    const { container } = render(
      <PaneAddressLabel paneNumber={3} tabNumber={1} onCopy={copy} />
    );
    fireEvent.click(screen.getByText('3'));
    expect(copy).not.toHaveBeenCalled();
  });

  it('tooltip 에 다른 탭에서 부를 전체 주소를 담는다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={3} fullAddress="2.3" />);
    expect(badge(container).getAttribute('title')).toBe('2.3');
  });

  it('전체 주소를 모르면 tooltip 을 붙이지 않는다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={1} fullAddress={null} />);
    expect(badge(container).getAttribute('title')).toBe(null);
  });

  it('평소엔 옅고 포커스/호버 시 진해진다 — 터미널 내용과 경쟁하면 안 된다', () => {
    const { container, rerender } = render(<PaneAddressLabel paneNumber={2} />);
    const dim = Number(badge(container).style.opacity);
    rerender(<PaneAddressLabel paneNumber={2} isProminent />);
    expect(Number(badge(container).style.opacity)).toBeGreaterThan(dim);
  });

  it('클릭을 가로채지 않는다 — 터미널 글자 위에 얹혀 있다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={2} />);
    expect(badge(container).style.pointerEvents).toBe('none');
  });

  it('스크린리더에서 숨긴다 — 시각적 보조 표시일 뿐이다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={2} />);
    expect(badge(container).getAttribute('aria-hidden')).toBe('true');
  });
});
