import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import TerminalLaunchOptions from './TerminalLaunchOptions';

describe('TerminalLaunchOptions', () => {
  afterEach(cleanup);

  it('기본 선택지에 지금 설정값을 적는다 — "기본" 만으론 그게 뭔지 모른다', () => {
    render(<TerminalLaunchOptions defaultMultiplexer="none" defaultShell="zsh" onChange={vi.fn()} />);
    expect(screen.getByText('기본 (none)')).toBeTruthy();
    expect(screen.getByText('기본 (zsh)')).toBeTruthy();
  });

  it('설정이 auto 면 셸 기본을 "자동" 으로 읽어 준다', () => {
    render(<TerminalLaunchOptions defaultMultiplexer="tmux" defaultShell="auto" onChange={vi.fn()} />);
    expect(screen.getByText('기본 (자동)')).toBeTruthy();
  });

  it('고르면 두 값을 함께 돌려준다', () => {
    const onChange = vi.fn();
    render(<TerminalLaunchOptions multiplexer="" shell="zsh" defaultMultiplexer="tmux" onChange={onChange} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'none' } });
    expect(onChange).toHaveBeenCalledWith({ multiplexer: 'none', shell: 'zsh' });
  });

  /* ⚠️ 원격 pane 의 WS 는 `shell` 을 아예 안 싣는다. 안 먹는 칸을 내밀면 조용한 실패다. */
  it('원격에는 셸 칸을 그리지 않는다', () => {
    render(<TerminalLaunchOptions defaultMultiplexer="tmux" showShell={false} onChange={vi.fn()} />);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.queryByText('셸')).toBeNull();
  });

  it('멀티플렉서 선택지는 tmux 와 none 뿐이다', () => {
    render(<TerminalLaunchOptions defaultMultiplexer="tmux" onChange={vi.fn()} />);
    ['tmux', 'none'].forEach((v) => expect(screen.getByText(v)).toBeTruthy());
    expect(screen.queryByText('herdr')).toBeNull();
  });

  it('셸 칸은 어느 선택에서도 살아 있다', () => {
    render(<TerminalLaunchOptions multiplexer="none" defaultMultiplexer="tmux" onChange={vi.fn()} />);
    expect(screen.getAllByRole('combobox')[1].disabled).toBe(false);
  });
});
