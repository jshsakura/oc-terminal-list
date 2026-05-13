import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SessionActivity from './SessionActivity';

vi.mock('../hooks/useTranslation', () => ({
  __esModule: true,
  default: () => {
    const keys = {
      activityEmpty: 'No activity recorded yet',
      timeSecondsAgo: '{n}s ago',
      timeMinutesAgo: '{n}m ago',
    };
    return (key) => keys[key] || key;
  },
}));

describe('SessionActivity', () => {
  it('renders skeleton while loading', () => {
    const { container } = render(<SessionActivity sessionId="s1" />);
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
  });

  it('uses i18n key for empty state (no hardcoded Korean)', async () => {
    const { container } = render(<SessionActivity sessionId={null} />);
    expect(container.textContent).not.toContain('아직');
  });
});
