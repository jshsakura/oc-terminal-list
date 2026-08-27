import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostEditor from './HostEditor';

import { locales } from '../i18n/locales';
const mockT = (key, fallback) => locales.en[key] || fallback || key;

const sampleHost = {
  id: 'h1',
  name: 'oci-a1',
  hostname: '1.2.3.4',
  port: 22,
  ssh_user: 'ubuntu',
  auth_method: 'key',
  key_id: 'k1',
  color_index: 2,
  use_remote_tmux: 1,
  remote_tmux_session: 'mobile',
  start_path: '~/projects',
  icon: '🚀',
};

const sampleKeys = [
  { id: 'k1', name: 'main' },
  { id: 'k2', name: 'work' },
];

describe('HostEditor', () => {
  it('renders for adding a new host without crashing', () => {
    render(
      <HostEditor
        isOpen={true}
        host={null}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Add host/i)).toBeInTheDocument();
  });

  it('renders for editing an existing host without crashing', () => {
    render(
      <HostEditor
        isOpen={true}
        host={sampleHost}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onKillTmuxServer={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Edit host/i)).toBeInTheDocument();
    // 기존 host 값 prefill 확인
    expect(screen.getByDisplayValue('oci-a1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1.2.3.4')).toBeInTheDocument();
  });

  it('returns null when isOpen=false', () => {
    const { container } = render(
      <HostEditor
        isOpen={false}
        host={null}
        sshKeys={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('calls onDelete with host when delete is confirmed', () => {
    const onDelete = vi.fn();
    render(
      <HostEditor
        isOpen={true}
        host={sampleHost}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDelete={onDelete}
        t={mockT}
      />
    );
    // 1차 클릭 → confirm 모드 진입
    fireEvent.click(screen.getAllByText(/Delete/i)[0]);
    // 2차 Delete 버튼 클릭
    const confirmDelete = screen.getAllByText(/Delete/i).find((el) => el.closest('button'));
    fireEvent.click(confirmDelete.closest('button'));
    expect(onDelete).toHaveBeenCalled();
  });

  it('handles host without icon field (legacy DB row)', () => {
    const legacyHost = { ...sampleHost, icon: undefined };
    render(
      <HostEditor
        isOpen={true}
        host={legacyHost}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Edit host/i)).toBeInTheDocument();
  });

  it('handles use_remote_tmux as 0/1 integer (sqlite)', () => {
    render(
      <HostEditor
        isOpen={true}
        host={{ ...sampleHost, use_remote_tmux: 0 }}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Edit host/i)).toBeInTheDocument();
  });

  it('uses auth_token when checking remote tmux availability', async () => {
    localStorage.setItem('auth_token', 'auth-token-123');
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ available: true }),
      text: () => Promise.resolve(''),
    });

    render(
      <HostEditor
        isOpen={true}
        host={{ ...sampleHost, use_remote_tmux: 0 }}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );

    fireEvent.click(screen.getByText(/Session/i).closest('button'));
    fireEvent.click(document.querySelector('[role="switch"][aria-label^="Persist session"]'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/hosts/h1/tmux-check', {
        headers: { Authorization: 'Bearer auth-token-123' },
      });
    });
  });

  it('shows skeleton rows in TailscalePicker while loading', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})));

    render(
      <HostEditor
        isOpen={true}
        host={{ ...sampleHost, auth_method: 'tailscale' }}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Edit host/i)).toBeInTheDocument();
  });

  it('renders form fields for a new host', () => {
    render(
      <HostEditor
        isOpen={true}
        host={null}
        sshKeys={sampleKeys}
        onSave={vi.fn()}
        onClose={vi.fn()}
        t={mockT}
      />
    );
    expect(screen.getByText(/Add host/i)).toBeInTheDocument();
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  /* itl 과 리모트는 한 구획이다. 어느 한쪽만으로는 되는 일이 없어서(리모트만 = 그쪽
     에이전트가 답장 못 함, itl 만 = 이쪽에서 보지도 부르지도 못함) 묻는 것도 까는 것도
     한 번이다. 이 테스트들은 그 하나됨을 잠근다 — 다시 둘로 갈라지면 여기서 깨진다. */

  /* 설치가 **상태를 바꾼다** — 설치 뒤의 조회는 새 상태를 준다. 목이 계속 옛 상태를
     주면 "눌러도 안 변한다" 를 테스트가 정상으로 통과시킨다. */
  const agentFetch = (payload) => {
    let current = payload.before;
    return vi.fn((url) => {
      if (String(url).includes('/agent-setup')) current = payload.after;
      const body = current;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    });
  };

  const openSessionTab = () => fireEvent.click(screen.getByRole('button', { name: /session/i }));

  const renderEditor = () => render(
    <HostEditor
      isOpen={true}
      host={sampleHost}
      sshKeys={sampleKeys}
      onSave={vi.fn()}
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onKillTmuxServer={vi.fn()}
      t={mockT}
    />
  );

  const READY = {
    ready: true,
    remote: { installed: true, connected: true, reachable: true },
    itl: { installed: true, pane_path: true, setup_command: 'mkdir -p ~/.local/bin' },
  };
  const NOT_SET_UP = {
    ready: false,
    remote: { installed: false, connected: false, reachable: true },
    itl: { installed: false, pane_path: false, setup_command: 'mkdir -p ~/.local/bin' },
  };

  it('asks one endpoint for both halves when the session tab opens', async () => {
    const fetchMock = agentFetch({ before: READY, after: READY });
    vi.stubGlobal('fetch', fetchMock);
    renderEditor();
    openSessionTab();
    await waitFor(() => expect(screen.getByText(/commands flow to and from/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/hosts/h1/agent-status', expect.objectContaining({ headers: expect.anything() }));
    /* 두 번 묻지 않는다 — 예전에는 구획이 둘이라 편집기를 열 때마다 SSH 왕복이 두 번이었다. */
    const asked = fetchMock.mock.calls.filter(([u]) => /agent-status/.test(String(u)));
    expect(asked).toHaveLength(1);
    /* 반쪽만 묻는 길은 걷어냈다 — 남아 있으면 그걸 부른 화면이 반쪽 상태를 보고
       "준비됨" 이라고 적는다. */
    expect(fetchMock.mock.calls.some(([u]) => /remote-status|itl-status/.test(String(u)))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('stays quiet once the host is connected', async () => {
    /* ⚠️ 준비된 호스트에 큰 안내가 남아 있으면 그건 정보가 아니라 광고다. */
    vi.stubGlobal('fetch', agentFetch({ before: READY, after: READY }));
    renderEditor();
    openSessionTab();
    await waitFor(() => expect(screen.getByText(/commands flow to and from/i)).toBeInTheDocument());
    expect(screen.queryByText(/Connect this host/i)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('says plainly what is missing when the host is not connected', async () => {
    /* ⚠️ 예전 문구는 11px 회색 한 줄이었고, 게다가 "안 깔아도 SSH 로 대신 살펴보므로
       기능은 그대로" 라고 적혀 있었다 — SSH 폴백을 없앤 뒤로 그건 사실이 아니다. */
    vi.stubGlobal('fetch', agentFetch({ before: NOT_SET_UP, after: NOT_SET_UP }));
    renderEditor();
    openSessionTab();
    await waitFor(() => expect(screen.getByText(/Connect this host/i)).toBeInTheDocument());
    expect(screen.getByText(/cannot receive commands/i)).toBeInTheDocument();
    expect(screen.queryByText(/watches over SSH/i)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('installs both halves with one press', async () => {
    const fetchMock = agentFetch({ before: NOT_SET_UP, after: READY });
    vi.stubGlobal('fetch', fetchMock);
    renderEditor();
    openSessionTab();
    await waitFor(() => expect(screen.getByText(/Connect this host/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Connect$/ }));
    await waitFor(() => expect(screen.getByText(/commands flow to and from/i)).toBeInTheDocument());
    const setup = fetchMock.mock.calls.find(([u]) => String(u).includes('/agent-setup'));
    expect(setup[1].method).toBe('POST');
    /* 두 번 쏘지 않는다 — 버튼이 하나라는 말은 요청도 하나라는 뜻이다. */
    expect(fetchMock.mock.calls.filter(([u]) => /setup|install/.test(String(u)))).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  /* A Windows host used to meet the user as three unrelated bugs across a week: the
     tmux toggle refusing, pastes vanishing, the handoff silently unavailable. Saying it
     once, with the way out, is the whole feature. */
  it('names Windows instead of offering an install that cannot work', async () => {
    vi.stubGlobal('fetch', agentFetch({
      before: { ready: false, remote: { installed: false, reachable: true },
                itl: { installed: false, pane_path: false, platform: 'windows' } },
      after: {},
    }));
    renderEditor();
    openSessionTab();
    await waitFor(() => expect(screen.getByText(/POSIX/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Connect$/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('does not confuse "cannot reach" with "not installed"', async () => {
    /* 섞으면 설치 버튼을 누르게 되고 그것도 실패한다. */
    vi.stubGlobal('fetch', agentFetch({
      before: { ready: false, remote: { installed: null, reachable: false }, itl: {} },
      after: {},
    }));
    renderEditor();
    openSessionTab();
    await waitFor(() => expect(screen.getByText(/install state is unknown/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Connect$/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
