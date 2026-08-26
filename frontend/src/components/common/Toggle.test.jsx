import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import Toggle from './Toggle';

describe('Toggle', () => {
  test('행 전체가 눌린다 — 글자를 눌러도 켜진다', () => {
    const onChange = vi.fn();
    render(<Toggle label="예측 입력" hint="긴 설명" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByText('예측 입력'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('상태를 보조기술에 알린다', () => {
    const { rerender } = render(<Toggle label="a" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    rerender(<Toggle label="a" checked onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  /* ⚠️ 이 버그의 실제 모습: 설명이 붙은 긴 라벨이 좁은 화면에서 트랙을 눌러 찌그러뜨렸다.
     손잡이는 absolute 라 안 줄어드니 트랙 밖으로 삐져나왔다. jsdom 은 레이아웃을 계산하지
     않으므로 눈으로는 못 잡는다 — 찌그러짐을 막는 **속성**이 붙어 있는지로 잠근다. */
  test('트랙은 라벨에 밀려 찌그러지지 않는다', () => {
    const { container } = render(
      <Toggle label={'아주 긴 라벨 '.repeat(8)} hint={'긴 설명 '.repeat(20)} checked={false} onChange={() => {}} />,
    );
    const track = container.querySelector('span[style*="border-radius"]');
    expect(track.style.flexShrink).toBe('0');
  });

  test('손잡이 이동 거리는 트랙 치수에서 나온다 — 밖으로 안 나간다', () => {
    const src = readFileSync(resolve(__dirname, 'Toggle.jsx'), 'utf8');
    // 이동 거리를 손으로 적으면 폭을 바꿀 때 손잡이만 남는다.
    expect(src).toMatch(/TRAVEL = TRACK_W - KNOB - PAD \* 2/);
    expect(src).not.toMatch(/translateX\(14px\)/);
  });

  test('손잡이 색은 테마에서 온다 — 흰색을 박지 않는다', () => {
    const src = readFileSync(resolve(__dirname, 'Toggle.jsx'), 'utf8');
    expect(src).not.toMatch(/background:\s*'#fff'/);
  });

  /* 예전에 이 컴포넌트가 두 벌이어서 한쪽만 고쳐졌다. 다시 갈라지는 것을 막는다. */
  test('구현은 하나뿐이다', () => {
    const root = resolve(__dirname, '..');
    for (const f of ['settings/SettingsFields.jsx', 'hostEditor/HostEditorFields.jsx']) {
      const src = readFileSync(resolve(root, f), 'utf8');
      expect(src).toContain("export { default as Toggle } from '../common/Toggle'");
    }
  });
});
