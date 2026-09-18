import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import useSettings, { DEFAULT_SETTINGS } from './useSettings';
import { DEFAULT_FONT_SIZE_MOBILE } from '../utils/terminalFonts';

const TestSettings = () => {
  const { settings } = useSettings(true);
  return <div data-testid="mobile-font-size">{settings.fontSizeMobile}</div>;
};

describe('useSettings', () => {
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
  it('persists an explicitly hidden scrollbar across remounts', () => {
    const ScrollbarSetting = () => {
      const { settings, updateSettings } = useSettings(false);
      return <button onClick={() => updateSettings({ showTerminalScrollbar: false })}>
        {settings.showTerminalScrollbar ? 'shown' : 'hidden'}
      </button>;
    };
    const first = render(<ScrollbarSetting />);
    fireEvent.click(screen.getByRole('button', { name: 'shown' }));
    expect(JSON.parse(localStorage.getItem('terminal_settings')).showTerminalScrollbar).toBe(false);
    first.unmount();
    render(<ScrollbarSetting />);
    expect(screen.getByRole('button', { name: 'hidden' })).toBeInTheDocument();
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
