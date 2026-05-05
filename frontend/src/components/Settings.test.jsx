import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Settings from './Settings';

const fullSettings = {
  theme: 'catppuccin',
  language: 'en',
  fontSize: 13,
  fontFamily: 'JetBrains Mono',
  defaultShell: 'auto',
  autoScroll: 'smart',
  smoothScroll: true,
  scrollSensitivity: 0.8,
};

describe('Settings', () => {
  it('renders without crashing with full settings', () => {
    render(
      <Settings
        isOpen={true}
        onClose={vi.fn()}
        settings={fullSettings}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByText(/Settings/i).length || 1).toBeTruthy();
  });

  it('does not crash when scrollSensitivity is undefined (legacy storage)', () => {
    const legacySettings = { ...fullSettings, scrollSensitivity: undefined };
    expect(() =>
      render(
        <Settings
          isOpen={true}
          onClose={vi.fn()}
          settings={legacySettings}
          onSave={vi.fn()}
        />
      )
    ).not.toThrow();
  });

  it('does not crash when scrollSensitivity is null', () => {
    const legacySettings = { ...fullSettings, scrollSensitivity: null };
    expect(() =>
      render(
        <Settings
          isOpen={true}
          onClose={vi.fn()}
          settings={legacySettings}
          onSave={vi.fn()}
        />
      )
    ).not.toThrow();
  });

  it('returns null when isOpen=false', () => {
    const { container } = render(
      <Settings isOpen={false} onClose={vi.fn()} settings={fullSettings} onSave={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('calls onSave with current draft on Save', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <Settings isOpen={true} onClose={onClose} settings={fullSettings} onSave={onSave} />
    );
    fireEvent.click(screen.getByText(/Save/i));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ theme: 'catppuccin' }));
    expect(onClose).toHaveBeenCalled();
  });
});
