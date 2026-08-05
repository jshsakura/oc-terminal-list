import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Settings from './Settings';

const fullSettings = {
  theme: 'catppuccin',
  language: 'en',
  fontSize: 13,
  fontSizeMobile: 15,
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

  it('uses the shared glass modal layer above portal menus', () => {
    render(
      <Settings
        isOpen={true}
        onClose={vi.fn()}
        settings={fullSettings}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByTestId('glass-modal-overlay')).toHaveStyle({ zIndex: '200001' });
    expect(screen.getByRole('dialog').style.backdropFilter).toMatch(/blur\(.*20px\)/);
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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ theme: 'catppuccin' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('saves the edited mobile font size', () => {
    const onSave = vi.fn();
    render(
      <Settings isOpen={true} onClose={vi.fn()} settings={fullSettings} onSave={onSave} />
    );

    fireEvent.click(screen.getByText(/Mobile/i));
    fireEvent.change(screen.getAllByDisplayValue('15')[0], { target: { value: '17' } });
    fireEvent.click(screen.getByText(/Save/i));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      fontSize: 13,
      fontSizeMobile: 17,
    }));
  });

  it('hosts tab add-row uses the same vertical rhythm as host rows', () => {
    const onAddHost = vi.fn();
    render(
      <Settings
        isOpen={true}
        onClose={vi.fn()}
        settings={fullSettings}
        onSave={vi.fn()}
        hosts={[]}
        onAddHost={onAddHost}
      />
    );

    // 탭 라벨 정확 일치 — 부분 일치(/Hosts/i)는 본문의 다른 설명 문구("…your hosts.")
    // 까지 잡아 "여러 개 찾음" 으로 깨진다.
    fireEvent.click(screen.getByText(/^Manage hosts$/i));

    const addBtn = screen.getByText(/Add host/i).closest('button');
    const localBtn = screen.getAllByText(/^This machine$/i)[0].closest('button');

    expect(addBtn.style.padding).toBe(localBtn.style.padding);
    expect(addBtn.style.minHeight).toBe(localBtn.style.minHeight);
    expect(addBtn.style.minHeight).toBe('44px');
    expect(addBtn.style.height).toBe('');
  });

  it('keys tab add-row uses the same vertical rhythm as key rows', () => {
    const onAddKey = vi.fn();
    render(
      <Settings
        isOpen={true}
        onClose={vi.fn()}
        settings={fullSettings}
        onSave={vi.fn()}
        sshKeys={[]}
        onAddKey={onAddKey}
      />
    );

    fireEvent.click(screen.getByText(/Keys/i));

    const addBtn = screen.getByText(/Add SSH key/i).closest('button');
    expect(addBtn.style.padding).toBe('8px 10px');
    expect(addBtn.style.minHeight).toBe('44px');
    expect(addBtn.style.height).toBe('');
  });

  it('resets mobile font size with the shared defaults', () => {
    const onSave = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => true));

    render(
      <Settings isOpen={true} onClose={vi.fn()} settings={fullSettings} onSave={onSave} />
    );

    fireEvent.click(screen.getByText(/Reset/i));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      fontSize: 12,
      fontSizeMobile: 13,
      defaultShell: 'auto',
    }));

    vi.unstubAllGlobals();
  });
});
