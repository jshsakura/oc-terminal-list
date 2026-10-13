import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileKeysEditor from './MobileKeysEditor';

const keys = [
  { id: 'cmd', kind: 'cmdInput', tone: 'accent' },
  { id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' },
  { id: 'sep1', kind: 'sep' },
];

describe('MobileKeysEditor 위치 고정', () => {
  it('키마다 위치를 골라 pin 으로 저장하고, 빠른입력과 구분자에는 고르는 칸이 없다', () => {
    const onChange = vi.fn();
    render(<MobileKeysEditor keys={keys} onChange={onChange} />);
    const selects = screen.getAllByLabelText('Position');
    expect(selects).toHaveLength(1);
    fireEvent.change(selects[0], { target: { value: 'right' } });
    expect(onChange).toHaveBeenLastCalledWith([keys[0], { ...keys[1], pin: 'right' }, keys[2]]);
  });

  it('스크롤로 되돌리면 pin 을 지운다', () => {
    const onChange = vi.fn();
    render(<MobileKeysEditor keys={[keys[0], { ...keys[1], pin: 'left' }]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '' } });
    expect(onChange.mock.calls.at(-1)[0][1].pin).toBeUndefined();
  });
});
