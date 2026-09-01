import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('탭 번호를 모르면 pane 번호만 — 틀린 주소를 그리느니 안 그린다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={3} tabNumber={null} />);
    expect(badge(container).textContent).toBe('3');
  });

  /* 번호 말고는 아무것도 붙지 않는다. 이름·복사·접기가 달려 있던 시절의 복사는 남의
     에이전트에게 건네는 tmux attach 핸들이었고, 그 쓰임이 사라진 뒤로는 터미널 출력을
     덮기만 했다. 다시 뭔가 붙이려 할 때 이 테스트가 걸린다. */
  it('배지 안에는 버튼이 없다 — 읽는 것이지 누르는 것이 아니다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={3} tabNumber={1} fullAddress="1.3" />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
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
