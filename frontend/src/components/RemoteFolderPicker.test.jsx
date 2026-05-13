import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import RemoteFolderPicker from './RemoteFolderPicker';

const mockT = (key) => key;
const mockHost = { id: 'h1', name: 'test' };

describe('RemoteFolderPicker skeleton loading', () => {
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
      <RemoteFolderPicker
        isOpen={true}
        host={mockHost}
        onPick={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );

    await waitFor(() => {
      const skeletons = container.querySelectorAll('[aria-busy="true"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    resolveFetch({ ok: true, json: () => Promise.resolve({ path: '/', items: [] }) });
  });

  it('shows folder items when loaded', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ path: '/home', items: [{ name: 'projects', path: '/home/projects', type: 'directory' }] }),
      })
    );

    render(
      <RemoteFolderPicker
        isOpen={true}
        host={mockHost}
        onPick={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('projects')).toBeInTheDocument();
    });
  });

  it('has min-height on body container while loading', async () => {
    let resolveFetch;
    global.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));

    const { container } = render(
      <RemoteFolderPicker
        isOpen={true}
        host={mockHost}
        onPick={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );

    await waitFor(() => {
      const body = container.querySelector('[style*="min-height"]');
      expect(body).toBeTruthy();
    });

    resolveFetch({ ok: true, json: () => Promise.resolve({ path: '/', items: [] }) });
  });
});
