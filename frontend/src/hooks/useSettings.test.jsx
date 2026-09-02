import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import useSettings, { DEFAULT_SETTINGS } from './useSettings';
import { DEFAULT_FONT_SIZE_MOBILE } from '../utils/terminalFonts';

const TestSettings = () => {
  const { settings } = useSettings(true);
  return <div data-testid="mobile-font-size">{settings.fontSizeMobile}</div>;
};

describe('useSettings', () => {
  it('defaults the mobile font size to 10 (the desktop size reads oversized on a phone)', () => {
    expect(DEFAULT_FONT_SIZE_MOBILE).toBe(10);
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
