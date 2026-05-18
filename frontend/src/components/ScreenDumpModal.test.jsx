import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScreenDumpModal from './ScreenDumpModal';

describe('ScreenDumpModal', () => {
  it('uses the shared glass modal sizing and treatment', () => {
    render(<ScreenDumpModal text="hello\nworld" onClose={vi.fn()} t={(key) => key} />);

    expect(screen.getByTestId('glass-modal-overlay')).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({ maxWidth: '780px', height: '88vh' });
    expect(dialog.style.backdropFilter).toMatch(/blur\(.*20px\)/);
  });

  it('does not render without text', () => {
    const { container } = render(<ScreenDumpModal text="" onClose={vi.fn()} t={(key) => key} />);
    expect(container.firstChild).toBeNull();
  });
});
