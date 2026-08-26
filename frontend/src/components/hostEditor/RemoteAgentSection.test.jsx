import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import RemoteAgentSection from './RemoteAgentSection';

const authHeaders = () => ({ Authorization: 'Bearer t' });
const t = (k) => null;   // 기본 한국어 문구를 그대로 쓰게 한다

const reply = (body, ok = true) => ({
  ok, status: ok ? 200 : 500, json: async () => body,
});

describe('RemoteAgentSection', () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('붙어 있으면 연결됨으로 보인다', async () => {
    fetch.mockResolvedValue(reply({ installed: true, connected: true, reachable: true, facts: {} }));
    render(<RemoteAgentSection hostId="h1" authHeaders={authHeaders} t={t} />);
    expect(await screen.findByText(/연결됨/)).toBeInTheDocument();
  });

  /* ⚠️ 설치는 선택이다. "미설치" 를 결함처럼 적으면 강요할 생각이 없는데도 강요가 된다. */
  test('설치 안 한 상태는 결함이 아니라 대안으로 적힌다', async () => {
    fetch.mockResolvedValue(reply({ installed: false, connected: false, reachable: true, facts: {} }));
    render(<RemoteAgentSection hostId="h1" authHeaders={authHeaders} t={t} />);
    expect(await screen.findByText(/SSH 로 살펴보는 중/)).toBeInTheDocument();
  });

  /* ⚠️ 못 닿은 것과 안 깔린 것은 다른 사건이다 — 섞으면 설치 버튼을 누르게 되고 그것도 실패한다. */
  test('호스트에 못 닿으면 설치 버튼을 내밀지 않는다', async () => {
    fetch.mockResolvedValue(reply({ installed: null, connected: false, reachable: false, facts: {} }));
    render(<RemoteAgentSection hostId="h1" authHeaders={authHeaders} t={t} />);
    expect(await screen.findByText(/닿지 못해/)).toBeInTheDocument();
    expect(screen.queryByText(/리모트 설치/)).not.toBeInTheDocument();
  });

  test('제거는 한 번 되묻는다 — 자격증명까지 폐기되므로', async () => {
    fetch.mockResolvedValue(reply({ installed: true, connected: true, reachable: true, facts: {} }));
    render(<RemoteAgentSection hostId="h1" authHeaders={authHeaders} t={t} />);
    const remove = await screen.findByText('제거');
    fireEvent.click(remove);
    expect(await screen.findByText(/정말 제거/)).toBeInTheDocument();
    // 아직 요청은 나가지 않았다
    expect(fetch.mock.calls.filter(([u]) => u.includes('uninstall'))).toHaveLength(0);
  });

  test('되물음에 답해야 제거가 나간다', async () => {
    fetch.mockResolvedValue(reply({ installed: true, connected: true, reachable: true, facts: {} }));
    render(<RemoteAgentSection hostId="h1" authHeaders={authHeaders} t={t} />);
    fireEvent.click(await screen.findByText('제거'));
    fireEvent.click(await screen.findByText(/정말 제거/));
    await waitFor(() => {
      expect(fetch.mock.calls.some(([u]) => u.includes('remote-uninstall'))).toBe(true);
    });
  });

  test('호스트가 보고한 사실을 보여준다', async () => {
    fetch.mockResolvedValue(reply({
      installed: true, connected: true, reachable: true,
      facts: { os: 'Linux 6.17', gpu: 'RTX 4090' },
    }));
    render(<RemoteAgentSection hostId="h1" authHeaders={authHeaders} t={t} />);
    expect(await screen.findByText('RTX 4090')).toBeInTheDocument();
  });

  test('낡은 설치는 알린다', async () => {
    fetch.mockResolvedValue(reply({
      installed: true, connected: true, reachable: true, outdated: true, facts: {},
    }));
    render(<RemoteAgentSection hostId="h1" authHeaders={authHeaders} t={t} />);
    expect(await screen.findByText(/낡았습니다/)).toBeInTheDocument();
  });
});
