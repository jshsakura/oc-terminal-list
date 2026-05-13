import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from './Sidebar';
import { locales } from '../i18n/locales';

const makeSession = (id, name, overrides = {}) => ({
  id,
  name,
  cwd: `/home/user/${name}`,
  hostId: null,
  ...overrides,
});

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cpu: 10, ram: 20, disk: 30 }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseProps = (overrides = {}) => ({
    isOpen: true,
    onClose: vi.fn(),
    sessions: [],
    activeSessionId: null,
    onSelectSession: vi.fn(),
    onCloseSession: vi.fn(),
    onRenameSession: vi.fn(),
    onReconnectSession: vi.fn(),
    hosts: [],
    onConnectHost: vi.fn(),
    onAddHost: vi.fn(),
    onEditHost: vi.fn(),
    onDeleteHost: vi.fn(),
    onManageKeys: vi.fn(),
    language: 'en',
    t: (key) => locales.en[key] || key,
    ...overrides,
  });

  const switchToSessions = () => {
    const btn = document.querySelector('[title="Active"]') ||
      document.querySelector('[title="Terminals"]') ||
      document.querySelector('[title="Sessions"]');
    if (btn) fireEvent.click(btn);
  };

  it('renders without crashing', () => {
    const { container } = render(<Sidebar {...baseProps()} />);
    expect(container.querySelector('aside')).toBeTruthy();
  });

  it('returns null when isOpen=false', () => {
    const { container } = render(<Sidebar {...baseProps({ isOpen: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('switches to sessions tab and shows empty state', () => {
    render(<Sidebar {...baseProps()} />);
    switchToSessions();
    expect(screen.getByText(/No sessions yet/i)).toBeInTheDocument();
  });

  it('renders sessions list when switched to sessions tab', () => {
    const sessions = [
      makeSession('s1', 'project-a'),
      makeSession('s2', 'project-b'),
    ];
    render(<Sidebar {...baseProps({ sessions, activeSessionId: 's1' })} />);
    switchToSessions();
    expect(screen.getByText('project-a')).toBeInTheDocument();
    expect(screen.getByText('project-b')).toBeInTheDocument();
  });

  it('calls onSelectSession when clicking a session', () => {
    const onSelectSession = vi.fn();
    const sessions = [makeSession('s1', 'my-project')];
    render(<Sidebar {...baseProps({ sessions, onSelectSession })} />);
    switchToSessions();
    fireEvent.click(screen.getByText('my-project'));
    expect(onSelectSession).toHaveBeenCalledWith('s1');
  });

  it('renders footer stats area', () => {
    const { container } = render(<Sidebar {...baseProps()} />);
    const footer = container.querySelector('[style*="border-top"]');
    expect(footer).toBeTruthy();
  });

  it('renders host tab content', () => {
    render(<Sidebar {...baseProps()} />);
    const hostsTitle = screen.queryByText('Hosts') ||
      document.querySelector('[title="Hosts"]');
    expect(hostsTitle).toBeTruthy();
  });
});
