import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaneAddressLabel from './PaneAddressLabel';

describe('PaneAddressLabel', () => {
  it('pane 번호를 그린다 — 이게 `itl send 3` 의 주소다', () => {
    render(<PaneAddressLabel paneNumber={3} fullAddress="2.3" />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('tooltip 에 다른 탭에서 부를 전체 주소를 담는다', () => {
    render(<PaneAddressLabel paneNumber={3} fullAddress="2.3" />);
    expect(screen.getByText('3').getAttribute('title')).toBe('itl send 2.3');
  });

  it('전체 주소를 모르면 tooltip 을 붙이지 않는다', () => {
    render(<PaneAddressLabel paneNumber={1} fullAddress={null} />);
    expect(screen.getByText('1').getAttribute('title')).toBe(null);
  });

  it('평소엔 옅고 포커스/호버 시 진해진다 — 터미널 내용과 경쟁하면 안 된다', () => {
    const { rerender } = render(<PaneAddressLabel paneNumber={2} />);
    const dim = Number(screen.getByText('2').style.opacity);
    rerender(<PaneAddressLabel paneNumber={2} isProminent />);
    expect(Number(screen.getByText('2').style.opacity)).toBeGreaterThan(dim);
  });

  it('클릭을 가로채지 않는다 — 터미널 글자 위에 얹혀 있다', () => {
    render(<PaneAddressLabel paneNumber={2} />);
    expect(screen.getByText('2').style.pointerEvents).toBe('none');
  });

  it('스크린리더에서 숨긴다 — 시각적 보조 표시일 뿐이다', () => {
    render(<PaneAddressLabel paneNumber={2} />);
    expect(screen.getByText('2').getAttribute('aria-hidden')).toBe('true');
  });
});
