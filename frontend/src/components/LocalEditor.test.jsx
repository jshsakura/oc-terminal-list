import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LocalEditor from './LocalEditor';

describe('LocalEditor', () => {
  it('stores random theme profile without resolving it in the editor', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(
      <LocalEditor
        isOpen
        settings={{ theme: 'default', localTheme: '' }}
        onSave={onSave}
        onClose={onClose}
        t={(key) => key}
      />
    );

    fireEvent.click(screen.getByText('Dark (Random)'));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ localTheme: 'random-dark' }));
    expect(onClose).toHaveBeenCalled();
    // 이 한 번의 render 가 테마 피커의 59개 프리뷰를 전부 그린다. 단독 실행은 ~8s 인데
    // 전체 스위트를 병렬로 돌리면 10s 를 넘겨 간헐적으로 타임아웃났다. 로직 문제가 아니라
    // 순수 렌더 비용이라 시간만 넉넉히 준다.
  }, 30000);
});
