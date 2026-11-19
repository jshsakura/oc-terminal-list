import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import LlmDashboard from './LlmDashboard';

const SUMMARY = {
  enabled: true,
  days: 7,
  totals: { cost: 1, tokens: 100, sessions: 1, days: 1 },
  by_day: [], by_agent: [], by_model: [], by_project: [], by_host: [], sessions: [],
  fx: {},
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('LlmDashboard loading', () => {
  it('shows the loading cards when it joins a request another mount already started', async () => {
    // Arrange: a summary request that stays pending until we release it
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => pending));
    const first = render(<LlmDashboard days={7} />);
    first.unmount();   // leave the home while the request is still in flight

    // Act: come back before it finishes
    const second = render(<LlmDashboard days={7} />);

    // Assert: something says "loading" instead of an empty space
    expect(second.container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => { release({ ok: true, json: async () => SUMMARY }); await pending; });
    expect(second.container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe('LlmDashboard empty and failed states', () => {
  it('keeps the section when sources exist but the window has no usage', async () => {
    // Arrange: collection stalled, so the last 30 days are all zero
    const quiet = {
      ...SUMMARY, days: 30,
      totals: { cost: 0, tokens: 0, sessions: 0, days: 0 },
      by_host: [{ source_id: 'local', name: 'local', ok: true, cost: 0, tokens: 0, sessions: 0 }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => quiet })));

    // Act
    const view = render(<LlmDashboard days={30} />);
    await act(async () => {});

    // Assert: something is drawn instead of an empty space
    expect(view.container.firstChild).not.toBeNull();
  });

  it('says why when the summary request fails', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 })));

    // Act
    const view = render(<LlmDashboard days={90} />);
    await act(async () => {});

    // Assert
    expect(view.container.textContent).toContain('HTTP 502');
  });
});
