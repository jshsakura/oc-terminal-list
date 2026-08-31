import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PaneAddressLabel from './PaneAddressLabel';

// 배지는 [주소 버튼][이름][복사 버튼] 으로 나뉜다. 스타일/aria 는 바깥 배지가,
// title/클릭은 각 버튼이 들고 있으므로 무엇을 보는지 구분해서 잡는다.
const badge = (container) => container.querySelector('.iterm-pane-address');
const addressBtn = (container) => container.querySelectorAll('button')[0];

describe('PaneAddressLabel', () => {
  it('pane 번호를 그린다 — 이게 이 pane 의 주소다', () => {
    render(<PaneAddressLabel paneNumber={3} fullAddress="2.3" />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('pane 이름을 함께 그린다 — 분할 화면엔 서브탭바가 없어 여기 말고 이름이 나올 자리가 없다', () => {
    render(<PaneAddressLabel paneNumber={2} paneLabel="frontend" />);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('frontend')).toBeTruthy();
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

  it('이름이 없으면 주소 블록만 — 빈 조각을 그리지 않는다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={2} />);
    expect(badge(container).childElementCount).toBe(1);
  });

  it('tooltip 에 다른 탭에서 부를 전체 주소를 담는다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={3} fullAddress="2.3" />);
    expect(addressBtn(container).getAttribute('title')).toBe('2.3');
  });

  it('전체 주소를 모르면 tooltip 을 붙이지 않는다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={1} fullAddress={null} />);
    expect(addressBtn(container).getAttribute('title')).toBe(null);
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

  it('접으면 이름과 복사 버튼이 사라지고 주소만 남는다', () => {
    const { container } = render(
      <PaneAddressLabel paneNumber={3} tabNumber={1} paneLabel="frontend" onCopy={() => {}} isExpanded={false} onToggleExpand={() => {}} />
    );
    expect(screen.queryByText('frontend')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(1);   // 주소(=접기 핸들) 하나뿐
  });

  it('주소를 누르면 접기 토글, 복사는 별도 버튼 — 읽으려 눌렀다 클립보드가 바뀌면 안 된다', () => {
    const toggle = vi.fn();
    const copy = vi.fn();
    const { container } = render(
      <PaneAddressLabel paneNumber={3} tabNumber={1} paneLabel="frontend" onCopy={copy} onToggleExpand={toggle} />
    );
    const [address, copyBtn] = container.querySelectorAll('button');
    fireEvent.click(address);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(copy).not.toHaveBeenCalled();
    fireEvent.click(copyBtn);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('스크린리더에서 숨긴다 — 시각적 보조 표시일 뿐이다', () => {
    const { container } = render(<PaneAddressLabel paneNumber={2} />);
    expect(badge(container).getAttribute('aria-hidden')).toBe('true');
  });
});
