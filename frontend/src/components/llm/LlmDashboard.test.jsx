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
