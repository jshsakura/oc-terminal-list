import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandPalette from './CommandPalette';

const COMMANDS = [
  { id: 'new-tab', label: 'New tab' },
  { id: 'settings', label: 'Settings' },
  { id: 'find', label: 'Find in terminal', keywords: ['search'] },
];

const renderPalette = (overrides = {}) => render(
  <CommandPalette
    isOpen
    query=""
    onQueryChange={vi.fn()}
    commands={COMMANDS}
    onExecute={vi.fn()}
    onClose={vi.fn()}
    {...overrides}
  />
);

describe('CommandPalette', () => {
  it('renders every command when the query is empty', () => {
    renderPalette();

    expect(screen.getByText('New tab')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Find in terminal')).toBeInTheDocument();
  });

  it('filters by label and by keyword', () => {
    renderPalette({ query: 'search' });

    expect(screen.getByText('Find in terminal')).toBeInTheDocument();
    expect(screen.queryByText('New tab')).not.toBeInTheDocument();
  });

  it('executes the clicked command by id', () => {
    const onExecute = vi.fn();
    renderPalette({ onExecute });

    fireEvent.click(screen.getByText('Settings'));

    expect(onExecute).toHaveBeenCalledWith('settings');
  });

  it('shows the empty label when nothing matches', () => {
    renderPalette({ query: 'zzzz', emptyLabel: 'No commands found' });

    expect(screen.getByText('No commands found')).toBeInTheDocument();
  });

  // 회귀 방지: AppModals 가 items/onSelect 라는 존재하지 않는 prop 을 넘겨서
  // query.trim() / commands.length 가 undefined 에서 터졌고, AppModals 를 감싼
  // LazyErrorBoundary 가 이를 삼켜 설정·확인창 등 모든 모달이 통째로 사라졌다.
  it('does not crash when commands or query are omitted', () => {
    expect(() => render(<CommandPalette isOpen onClose={vi.fn()} />)).not.toThrow();
    expect(() => render(<CommandPalette isOpen query="x" onClose={vi.fn()} />)).not.toThrow();
  });
});
