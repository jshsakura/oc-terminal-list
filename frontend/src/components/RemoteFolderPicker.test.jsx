import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

describe('RemoteFolderPicker 숨김 폴더', () => {
  const listing = {
    ok: true,
    json: () => Promise.resolve({
      path: '/home/me',
      items: [
        { name: '.ssh', path: '/home/me/.ssh', type: 'directory' },
        { name: 'workspace', path: '/home/me/workspace', type: 'directory' },
        { name: '.npm', path: '/home/me/.npm', type: 'directory' },
      ],
    }),
  };

  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    window.localStorage.clear();
    global.fetch = vi.fn(() => Promise.resolve(listing));
  });
  afterEach(() => { global.fetch = originalFetch; });

  const open = () => render(
    <RemoteFolderPicker isOpen host={mockHost} onPick={vi.fn()} onClose={vi.fn()} t={mockT} />
  );

  it('기본적으로 점 폴더를 감춘다 — 홈 디렉토리가 특히 심하다', async () => {
    open();
    await waitFor(() => expect(screen.getByText('workspace')).toBeInTheDocument());
    expect(screen.queryByText('.ssh')).toBeNull();
    expect(screen.queryByText('.npm')).toBeNull();
  });

  it('토글로 보여줄 수 있다', async () => {
    open();
    await waitFor(() => expect(screen.getByText('workspace')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle(/showHidden/));
    expect(screen.getByText('.ssh')).toBeInTheDocument();
  });

  it('로컬 픽커와 같은 선호도를 공유한다', async () => {
    // 로컬에서 켜 뒀으면 원격도 켜진 채로 열린다 — 토글이 두 개면 매번 다시 켜야 한다.
    window.localStorage.setItem('iterm.folderPicker.showHidden', '1');
    open();
    await waitFor(() => expect(screen.getByText('.ssh')).toBeInTheDocument());
  });
});
