import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import useSettings, { DEFAULT_SETTINGS } from './useSettings';
import { DEFAULT_FONT_SIZE_MOBILE } from '../utils/terminalFonts';
import { MOBILE_KEY_SET_PRESETS, resolveMobileKeySets, activeMobileKeySet } from '../utils/mobileKeySets';

const TestSettings = () => {
  const { settings } = useSettings(true);
  return <div data-testid="mobile-font-size">{settings.fontSizeMobile}</div>;
};

describe('useSettings', () => {
  it('remembers the selected quick bar set across remounts', () => {
    const KeySets = () => {
      const { settings, updateSettings } = useSettings(false);
      return <button onClick={() => updateSettings({ mobileKeySets: [...resolveMobileKeySets(settings),
        { ...MOBILE_KEY_SET_PRESETS[2], id: 'my-control' }], activeMobileKeySetId: 'my-control' })}>
        {activeMobileKeySet(settings).id}
      </button>;
    };
    const first = render(<KeySets />);
    fireEvent.click(screen.getByRole('button', { name: 'basic' }));
    first.unmount();
    render(<KeySets />);
    expect(screen.getByRole('button', { name: 'my-control' })).toBeInTheDocument();
  });
  it('keeps the terminal scrollbar opt-in by default', () => {
    expect(DEFAULT_SETTINGS.showTerminalScrollbar).toBe(false);
  });

  it('remembers opting into input preview independently of the scrollbar', () => {
    expect(DEFAULT_SETTINGS.showInputOnScroll).toBe(false);
    const PreviewSetting = () => {
      const { settings, updateSettings } = useSettings(false);
      return <button onClick={() => updateSettings({ showInputOnScroll: true, showTerminalScrollbar: false })}>
        {settings.showInputOnScroll ? 'enabled' : 'disabled'}
      </button>;
    };
    const first = render(<PreviewSetting />);
    fireEvent.click(screen.getByRole('button', { name: 'disabled' }));
    expect(JSON.parse(localStorage.getItem('terminal_settings'))).toMatchObject({
      showInputOnScroll: true, showTerminalScrollbar: false,
    });
    first.unmount();
    render(<PreviewSetting />);
    expect(screen.getByRole('button', { name: 'enabled' })).toBeInTheDocument();
  });
  it('persists an explicit scrollbar opt-in across remounts', () => {
    const ScrollbarSetting = () => {
      const { settings, updateSettings } = useSettings(false);
      return <button onClick={() => updateSettings({ showTerminalScrollbar: true })}>
        {settings.showTerminalScrollbar ? 'shown' : 'hidden'}
      </button>;
    };
    const first = render(<ScrollbarSetting />);
    fireEvent.click(screen.getByRole('button', { name: 'hidden' }));
    expect(JSON.parse(localStorage.getItem('terminal_settings')).showTerminalScrollbar).toBe(true);
    first.unmount();
    render(<ScrollbarSetting />);
    expect(screen.getByRole('button', { name: 'shown' })).toBeInTheDocument();
  });
  it('defaults the mobile font size to a readable 11px', () => {
    expect(DEFAULT_FONT_SIZE_MOBILE).toBe(11);
    expect(DEFAULT_SETTINGS.fontSizeMobile).toBe(DEFAULT_FONT_SIZE_MOBILE);
  });

  it('keeps a stored mobile font size instead of the new default', () => {
    localStorage.setItem('terminal_settings', JSON.stringify({ fontSizeMobile: 13 }));
    global.fetch = vi.fn(() => new Promise(() => {}));

    render(<TestSettings />);

    expect(screen.getByTestId('mobile-font-size')).toHaveTextContent('13');
  });

  it('does not overwrite a dirty local mobile font size with stale remote settings', async () => {
    localStorage.setItem('auth_token', 'token');
    localStorage.setItem('terminal_settings_dirty', '1');
    localStorage.setItem('terminal_settings', JSON.stringify({ fontSizeMobile: 16 }));

    global.fetch = vi.fn((url, options = {}) => {
      if (options.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200 });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ settings: { fontSizeMobile: 13 } }),
      });
    });

    render(<TestSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('mobile-font-size')).toHaveTextContent('16');
    });
    await waitFor(() => {
      const putCall = global.fetch.mock.calls.find(([, options = {}]) => options.method === 'PUT');
      expect(JSON.parse(putCall[1].body).settings.fontSizeMobile).toBe(16);
    });
  });
});
