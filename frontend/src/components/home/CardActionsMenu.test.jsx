import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Package } from 'lucide-react';
import CardActionsMenu from './CardActionsMenu';

const items = (onTools = vi.fn(), onEdit = vi.fn()) => [
  { key: 'tools', icon: Package, label: '도구 설치', onClick: onTools },
  { key: 'edit', icon: Package, label: '설정', onClick: onEdit },
];

describe('CardActionsMenu', () => {
  afterEach(cleanup);

  it('renders nothing when every action is absent', () => {
    const { container } = render(<CardActionsMenu items={[null, false]} title="더보기" />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows the actions with their names — a phone has no tooltip to read', () => {
    render(<CardActionsMenu items={items()} title="더보기" />);
    expect(screen.queryByText('도구 설치')).toBeNull();
    fireEvent.click(screen.getByTitle('더보기'));
    expect(screen.getByText('도구 설치')).toBeTruthy();
    expect(screen.getByText('설정')).toBeTruthy();
  });

  it('runs the action and closes', () => {
    const onTools = vi.fn();
    render(<CardActionsMenu items={items(onTools)} title="더보기" />);
    fireEvent.click(screen.getByTitle('더보기'));
    fireEvent.click(screen.getByText('도구 설치'));
    expect(onTools).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('도구 설치')).toBeNull();
  });

  /* ⚠️ 바깥 감지는 이 버튼을 일부러 무시한다(누르자마자 다시 열리는 것을 막으려고).
     그래서 버튼이 스스로 닫지 않으면 **그 버튼으로는 영영 못 닫는다** — 이 저장소가
     폰에서 실제로 밟았던 버그다. */
  it('closes when the toggle is pressed again', () => {
    render(<CardActionsMenu items={items()} title="더보기" />);
    const toggle = screen.getByTitle('더보기');
    fireEvent.click(toggle);
    expect(screen.getByText('설정')).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText('설정')).toBeNull();
  });

  it('does not let the press reach the card underneath', () => {
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <CardActionsMenu items={items()} title="더보기" />
      </div>
    );
    fireEvent.click(screen.getByTitle('더보기'));
    fireEvent.click(screen.getByText('설정'));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
