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
  }, 10000);
});
