import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import LocalFolderPicker from './LocalFolderPicker';

const mockT = (key) => key;

describe('LocalFolderPicker skeleton loading', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows skeleton rows while loading', async () => {
    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    const { container } = render(
      <LocalFolderPicker
        isOpen={true}
        onPick={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );

    await waitFor(() => {
      const skeletons = container.querySelectorAll('[aria-busy="true"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    resolveFetch({ ok: true, json: () => Promise.resolve({ items: [] }) });
  });

  it('shows folder items when loaded', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items: [{ name: 'Documents', path: 'Documents', type: 'directory' }] }),
      })
    );

    render(
      <LocalFolderPicker
        isOpen={true}
        onPick={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Documents')).toBeInTheDocument();
    });
  });

  it('has min-height on body container while loading', async () => {
    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    const { container } = render(
      <LocalFolderPicker
        isOpen={true}
        onPick={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );

    await waitFor(() => {
      const body = container.querySelector('[style*="min-height"]');
      expect(body).toBeTruthy();
    });

    resolveFetch({ ok: true, json: () => Promise.resolve({ items: [] }) });
  });
});
