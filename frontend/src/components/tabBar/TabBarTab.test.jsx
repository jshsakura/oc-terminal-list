import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Tab } from './TabBarTab';
import { TAB_TIP_DELAY_MS } from './TabTooltip';

const tab = { id: 'tab-1', name: 'Shell', type: 'local', panes: [] };

const hoverTab = () => {
  fireEvent.mouseEnter(screen.getByRole('tab'));
  act(() => { vi.advanceTimersByTime(TAB_TIP_DELAY_MS); });
};

afterEach(() => { vi.useRealTimers(); });

describe('TabBarTab keyboard navigation', () => {
  it('exposes tab semantics and selects with Enter or Space', () => {
    const onSelect = vi.fn();
    render(<Tab tab={tab} index={0} isActive onSelect={onSelect} t={(key) => key} />);

    const element = screen.getByRole('tab');
    expect(element).toHaveAttribute('aria-selected', 'true');
    expect(element).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(element, { key: 'Enter' });
    fireEvent.keyDown(element, { key: ' ' });

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith('tab-1');
  });

  it('removes inactive tabs from the roving tab stop', () => {
    render(<Tab tab={tab} index={0} isActive={false} t={(key) => key} />);
    expect(screen.getByRole('tab')).toHaveAttribute('tabindex', '-1');
  });

  it('shows the stable address while keeping the positional shortcut', () => {
    vi.useFakeTimers();
    render(<Tab tab={tab} addressNumber={7} shortcutPosition={2} isActive t={(key) => key} />);

    expect(screen.getByText('7')).toBeInTheDocument();
    hoverTab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('switchToTab (Ctrl+2)');
  });
});

describe('TabBarTab hover tooltip', () => {
  const longName = 'a-very-long-host-name-that-the-chip-truncates';

  it('shows the full name anywhere on the tab after a short delay', () => {
    vi.useFakeTimers();
    render(<Tab tab={{ ...tab, name: longName }} index={0} isActive={false} t={(key) => key} />);

    fireEvent.mouseEnter(screen.getByRole('tab'));
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => { vi.advanceTimersByTime(TAB_TIP_DELAY_MS); });
    expect(screen.getByRole('tooltip')).toHaveTextContent(longName);
  });

  it('lists the other pane names and every name only once', () => {
    vi.useFakeTimers();
    const mixed = {
      ...tab,
      paneLabels: ['Shell', 'gpu-box', 'gpu-box'],
      secondaryIdentities: [{ kind: 'host', name: 'gpu-box' }, { kind: 'host', name: 'rpi5' }],
    };
    render(<Tab tab={mixed} index={0} isActive={false} t={(key) => key} />);

    hoverTab();
    const lines = within(screen.getByRole('tooltip')).getAllByTestId('tab-tip-name');
    expect(lines.map((el) => el.textContent)).toEqual(['Shell', 'gpu-box', 'rpi5']);
  });

  it('leaves no native titles that would stack a second tooltip on top', () => {
    const mixed = { ...tab, secondaryIdentities: [{ kind: 'host', name: 'gpu-box' }] };
    render(<Tab tab={mixed} addressNumber={1} shortcutPosition={1} isActive={false} t={(key) => key} />);

    expect(screen.getByText('Shell')).not.toHaveAttribute('title');
    expect(screen.getByText('1')).not.toHaveAttribute('title');
  });

  it.each([
    ['the pointer leaves', (el) => fireEvent.mouseLeave(el)],
    ['the tab is pressed', (el) => fireEvent.mouseDown(el)],
    ['a drag starts', (el) => fireEvent.dragStart(el)],
    ['the strip scrolls', (el) => fireEvent.wheel(el, { deltaY: 40 })],
  ])('hides when %s', (_name, act_) => {
    vi.useFakeTimers();
    render(<Tab tab={tab} index={0} isActive={false} t={(key) => key} />);

    hoverTab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    act_(screen.getByRole('tab'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not fire a pending tooltip after the pointer has left', () => {
    vi.useFakeTimers();
    render(<Tab tab={tab} index={0} isActive={false} t={(key) => key} />);

    const element = screen.getByRole('tab');
    fireEvent.mouseEnter(element);
    fireEvent.mouseLeave(element);
    act(() => { vi.advanceTimersByTime(TAB_TIP_DELAY_MS); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('stays out of the way on touch screens and during the inline close confirm', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Tab tab={tab} isMobile index={0} isActive={false} t={(key) => key} />);
    hoverTab();
    expect(screen.queryByRole('tooltip')).toBeNull();

    rerender(<Tab tab={tab} isPendingClose index={0} isActive={false} t={(key) => key} />);
    hoverTab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
