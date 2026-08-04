import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EmptyPane, { VncDisplayPicker } from './EmptyPane';
import { resetLocalVncProbe } from '../../hooks/useLocalVncAvailable';

// authHeaders mock — 실제 토큰 로직 없이 헤더 객체만 반환
vi.mock('../../utils/auth', () => ({
  authHeaders: () => ({ Authorization: 'Bearer test' }),
}));

// tokens mock — VncDisplayPicker 가 color/fontSize/fontWeight/font/radius/space 를 사용
vi.mock('../../styles/tokens', () => ({
  tokens: {
    color: {
      surface0: '#1a1b26', surface1: '#24283b', surface2: '#2f334d', base: '#16161e',
      border: '#3b4261', borderStrong: '#414868', text: '#c0caf5', subtext: '#565f89',
      muted: '#7f87b3', accent: '#7aa2f7', scrim: 'rgba(0,0,0,0.55)',
      success: '#9ece6a', warning: '#e0af68', danger: '#f7768e',
      faint: '#3b4261', crust: '#0f0f14',
      dotPalette: ['#7aa2f7', '#9ece6a', '#e0af68'],
    },
    font: { sans: 'sans-serif', mono: 'monospace' },
    fontSize: { '10': '10px', '11': '11px', '12': '12px', '13': '13px' },
    fontWeight: { medium: 500, semibold: 600 },
    radius: { sm: '5px', md: '7px', lg: '10px' },
    space: { '1.5': '6px', '2': '8px', '3': '12px', '4': '16px' },
  },
}));

// HomeDashboard mock — VncDisplayPicker 테스트에 불필요한 의존성 차단.
// 받은 props 는 기록해 둔다(EmptyPane 이 홈에 무엇을 넘기는지 검증용).
let lastHomeProps = null;
vi.mock('../HomeDashboard', () => ({
  default: (props) => { lastHomeProps = props; return null; },
  HostRow: () => null,
}));

// 뷰포트 판정 — 테스트마다 폰/데스크탑을 전환한다(jsdom 은 항상 데스크탑처럼 보인다).
let isPhone = false;
vi.mock('../../utils/tabModel', async (importOriginal) => ({
  ...(await importOriginal()),
  isPhoneViewport: () => isPhone,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const mockFetchResponse = (json) => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => json,
  });
};

const mockFetchError = (status = 500) => {
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status });
};

const mockFetchReject = (msg = 'network error') => {
  global.fetch = vi.fn().mockRejectedValue(new Error(msg));
};

const HOST = { id: 'host-1', name: 'test-host' };

const renderPicker = (overrides = {}) =>
  render(
    <VncDisplayPicker
      host={HOST}
      t={(k) => k}
      onPick={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  );

// ── Tests ───────────────────────────────────────────────────────────────────

describe('VncDisplayPicker', () => {
  beforeEach(() => {
    isPhone = false;   // 기본은 데스크탑 — 폰 케이스만 테스트에서 켠다
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Combination 1: displays + installed → normal ────────────────────────

  it('shows display list and GPU badge when installed + displays exist', async () => {
    mockFetchResponse({
      available: true,
      installed: true,
      vncserver_path: '/usr/bin/vncserver',
      flavor: 'tigervnc',
      gpu: { renderer_hint: 'gpu', nvidia: true, virtualgl: true },
      displays: [
        { display: 1, geometry: '1280x800' },
        { display: 2, geometry: '1920x1080' },
      ],
    });

    renderPicker();

    // 로딩 중
    expect(screen.getByText('loading')).toBeTruthy();

    // 디스플레이 버튼 대기
    await waitFor(() => {
      expect(screen.getByText(':1 (1280x800)')).toBeTruthy();
      expect(screen.getByText(':2 (1920x1080)')).toBeTruthy();
    });

    // GPU 배지 표시 (installed + available 일 때만)
    expect(screen.getByText('vncGpuAvailable')).toBeTruthy();
  });

  // ── Combination 2: displays + NOT installed → list visible + connect-only note ──

  it('shows display list with connect-only note when displays exist but vncserver not found', async () => {
    mockFetchResponse({
      available: true,
      installed: false,
      vncserver_path: null,
      displays: [{ display: 3, geometry: '1024x768' }],
    });

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(':3 (1024x768)')).toBeTruthy();
    });

    // 'not installed' 메시지가 나오지 않아야 함 (디스플레이가 있으므로)
    expect(screen.queryByText('vncNotInstalled')).toBeNull();

    // 'connect only' 경고가 나와야 함
    expect(screen.getByText('vncConnectOnly')).toBeTruthy();
  });

  // ── Combination 3: no displays + NOT installed → not-installed message ──

  it('shows not-installed message when no displays and vncserver not found', async () => {
    mockFetchResponse({
      available: true,
      installed: false,
      vncserver_path: null,
      displays: [],
    });

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText('vncNotInstalled')).toBeTruthy();
    });

    // 디스플레이 버튼이 없어야 함
    expect(screen.queryByText('vncConnectOnly')).toBeNull();
  });

  // ── Edge: available=false → unavailable message ─────────────────────────

  it('shows unavailable message when available is false', async () => {
    mockFetchResponse({
      available: false,
      installed: false,
      displays: [],
      error: 'SSH connection failed',
    });

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText('vncUnavailable')).toBeTruthy();
    });
  });

  // ── Edge: installed + no displays → no displays message ─────────────────

  it('shows no-displays message when installed but no active displays', async () => {
    mockFetchResponse({
      available: true,
      installed: true,
      displays: [],
    });

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText('vncNoDisplays')).toBeTruthy();
    });

    // 'not installed' 가 나오지 않아야 함
    expect(screen.queryByText('vncNotInstalled')).toBeNull();
  });

  // ── Interaction: clicking a display calls onPick ────────────────────────

  it('calls onPick with display number when a display button is clicked', async () => {
    mockFetchResponse({
      available: true,
      installed: true,
      displays: [{ display: 5, geometry: '1280x800' }],
    });

    const onPick = vi.fn();
    render(<VncDisplayPicker host={HOST} t={(k) => k} onPick={onPick} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(':5 (1280x800)')).toBeTruthy();
    });

    fireEvent.click(screen.getByText(':5 (1280x800)'));
    expect(onPick).toHaveBeenCalledWith(5);
  });

  // ── Error handling ──────────────────────────────────────────────────────

  it('shows fetch error message when request fails', async () => {
    mockFetchReject('timeout');

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(/vncFetchError/)).toBeTruthy();
    });
  });

  it('shows fetch error message when response is not ok', async () => {
    mockFetchError(500);

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(/vncFetchError/)).toBeTruthy();
    });
  });

  // ── Close interaction ───────────────────────────────────────────────────

  it('calls onClose when backdrop is clicked', async () => {
    mockFetchResponse({ available: true, installed: true, displays: [] });

    const onClose = vi.fn();
    const { container } = render(
      <VncDisplayPicker host={HOST} t={(k) => k} onPick={vi.fn()} onClose={onClose} />
    );

    await waitFor(() => {
      expect(screen.getByText('vncNoDisplays')).toBeTruthy();
    });

    // 백드롭 클릭 (첫 번째 div = fixed overlay)
    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Create session ──────────────────────────────────────────────────────

  it('sends correct body on create and auto-connects to new display', async () => {
    const GET_RESP = { available: true, installed: true, displays: [] };
    const POST_RESP = { available: true, installed: true, display: 7, port: 5907, geometry: '1280x800' };
    global.fetch = vi.fn().mockImplementation((url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => POST_RESP });
      }
      return Promise.resolve({ ok: true, json: async () => GET_RESP });
    });

    const onPick = vi.fn();
    render(<VncDisplayPicker host={HOST} t={(k) => k} onPick={onPick} onClose={vi.fn()} />);

    // 리스트 로드 대기
    await waitFor(() => {
      expect(screen.getByText('vncCreateDesktop')).toBeTruthy();
    });

    // Create 버튼 클릭
    fireEvent.click(screen.getByText('vncCreate'));

    // POST 호출 검증
    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find(
        ([url, opts]) => (opts?.method || 'GET').toUpperCase() === 'POST',
      );
      expect(postCall).toBeTruthy();
      expect(postCall[0]).toContain('/vnc/sessions');
      expect(JSON.parse(postCall[1].body)).toEqual({ geometry: '1280x800' });
    });

    // 새 디스플레이로 자동 연결
    await waitFor(() => {
      expect(onPick).toHaveBeenCalledWith(7);
    });
  });

  it('does not show create action when installed is false', async () => {
    mockFetchResponse({ available: true, installed: false, displays: [] });

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText('vncNotInstalled')).toBeTruthy();
    });

    // Create 버튼이 없어야 함
    expect(screen.queryByText('vncCreate')).toBeNull();
    expect(screen.queryByText('vncCreateDesktop')).toBeNull();
  });

  it('shows passwordless warning when has_vnc_passwd is false', async () => {
    mockFetchResponse({ available: true, installed: true, displays: [], has_vnc_passwd: false });

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText('vncCreateDesktop')).toBeTruthy();
    });

    expect(screen.getByText('vncNoPassword')).toBeTruthy();
  });

  it('does not show passwordless warning when has_vnc_passwd is true', async () => {
    mockFetchResponse({ available: true, installed: true, displays: [], has_vnc_passwd: true });

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText('vncCreateDesktop')).toBeTruthy();
    });

    expect(screen.queryByText('vncNoPassword')).toBeNull();
  });

  it('kill goes through confirmation before sending DELETE request', async () => {
    const GET_RESP = {
      available: true, installed: true,
      displays: [{ display: 2, geometry: '1280x800' }],
    };
    const DELETE_RESP = { available: true, display: 2, status: 'killed' };
    global.fetch = vi.fn().mockImplementation((url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => DELETE_RESP });
      }
      return Promise.resolve({ ok: true, json: async () => GET_RESP });
    });

    const onConfirm = vi.fn();
    render(
      <VncDisplayPicker
        host={HOST}
        t={(k) => k}
        onPick={vi.fn()}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    // 디스플레이 로드 대기
    await waitFor(() => {
      expect(screen.getByText(':2 (1280x800)')).toBeTruthy();
    });

    // Kill 버튼 클릭 (title 로 찾기)
    const killBtn = screen.getByTitle('vncKillDesktop');
    fireEvent.click(killBtn);

    // 확인 모달이 호출되어야 함
    expect(onConfirm).toHaveBeenCalledOnce();
    const confirmArg = onConfirm.mock.calls[0][0];
    expect(confirmArg.danger).toBe(true);
    expect(typeof confirmArg.onConfirm).toBe('function');

    // 확인 전에는 DELETE 가 나가지 않아야 함
    const deleteBefore = global.fetch.mock.calls.find(
      ([, opts]) => (opts?.method || 'GET').toUpperCase() === 'DELETE',
    );
    expect(deleteBefore).toBeUndefined();

    // 확인 콜백 실행 → DELETE 전송
    await confirmArg.onConfirm();

    await waitFor(() => {
      const deleteCall = global.fetch.mock.calls.find(
        ([url, opts]) => (opts?.method || 'GET').toUpperCase() === 'DELETE',
      );
      expect(deleteCall).toBeTruthy();
      expect(deleteCall[0]).toContain('/vnc/sessions/2');
    });
  });

  it('shows error banner when create fails with 409', async () => {
    const GET_RESP = { available: true, installed: true, displays: [] };
    global.fetch = vi.fn().mockImplementation((url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ detail: '사용 가능한 디스플레이 번호가 없습니다' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => GET_RESP });
    });

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText('vncCreateDesktop')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('vncCreate'));

    // 에러 배너 표시
    await waitFor(() => {
      expect(screen.getByText(/vncCreateFailed/)).toBeTruthy();
    });
  });

  // ── Primary "create and connect" action (0 displays) ────────────────────

  it('shows primary "create and connect" action when 0 displays + installed', async () => {
    mockFetchResponse({ available: true, installed: true, displays: [] });

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(/vncCreateAndConnect/)).toBeTruthy();
    });
  });

  it('primary action sends paneSize-based geometry and auto-connects', async () => {
    const GET_RESP = { available: true, installed: true, displays: [] };
    const POST_RESP = { available: true, installed: true, display: 3, port: 5903, geometry: '1920x1080' };
    global.fetch = vi.fn().mockImplementation((url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => POST_RESP });
      }
      return Promise.resolve({ ok: true, json: async () => GET_RESP });
    });

    const onPick = vi.fn();
    render(
      <VncDisplayPicker
        host={HOST} t={(k) => k} onPick={onPick} onClose={vi.fn()}
        paneSize={{ width: 1920, height: 1080 }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/vncCreateAndConnect/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/vncCreateAndConnect/));

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find(
        ([url, opts]) => (opts?.method || 'GET').toUpperCase() === 'POST',
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall[1].body)).toEqual({ geometry: '1920x1080' });
    });

    await waitFor(() => {
      expect(onPick).toHaveBeenCalledWith(3);
    });
  });

  it('primary action rounds odd paneSize to even geometry', async () => {
    const GET_RESP = { available: true, installed: true, displays: [] };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: true, installed: true, display: 1, port: 5901 }),
    });

    render(
      <VncDisplayPicker
        host={HOST} t={(k) => k} onPick={vi.fn()} onClose={vi.fn()}
        paneSize={{ width: 1023, height: 767 }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/vncCreateAndConnect/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/vncCreateAndConnect/));

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find(
        ([url, opts]) => (opts?.method || 'GET').toUpperCase() === 'POST',
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall[1].body)).toEqual({ geometry: '1024x768' });
    });
  });

  it('primary action clamps tiny paneSize to lower bound', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: true, installed: true, display: 1, port: 5901 }),
    });

    render(
      <VncDisplayPicker
        host={HOST} t={(k) => k} onPick={vi.fn()} onClose={vi.fn()}
        paneSize={{ width: 100, height: 100 }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/vncCreateAndConnect/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/vncCreateAndConnect/));

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find(
        ([url, opts]) => (opts?.method || 'GET').toUpperCase() === 'POST',
      );
      expect(JSON.parse(postCall[1].body)).toEqual({ geometry: '640x480' });
    });
  });

  // 폰에서 만드는 데스크탑은 폰 크기를 따르지 않는다 — 그 해상도로 뜨면 창이 잘리고,
  // 해상도가 세션에 남아 나중에 PC 로 봐도 잘린 채다.
  it('phone viewport ignores paneSize and creates a desktop-sized geometry', async () => {
    isPhone = true;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: true, installed: true, display: 1, port: 5901 }),
    });

    render(
      <VncDisplayPicker
        host={HOST} t={(k) => k} onPick={vi.fn()} onClose={vi.fn()}
        paneSize={{ width: 390, height: 720 }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/vncCreateAndConnect/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/vncCreateAndConnect/));

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find(
        ([url, opts]) => (opts?.method || 'GET').toUpperCase() === 'POST',
      );
      expect(JSON.parse(postCall[1].body)).toEqual({ geometry: '1280x800' });
    });
  });

  it('falls back to viewport size when paneSize is null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: true, installed: true, display: 1, port: 5901 }),
    });

    // paneSize null → computeVncGeometry(window.innerWidth, window.innerHeight)
    // jsdom default: 1024 x 768 → both even, within bounds → '1024x768'
    render(
      <VncDisplayPicker host={HOST} t={(k) => k} onPick={vi.fn()} onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/vncCreateAndConnect/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/vncCreateAndConnect/));

    await waitFor(() => {
      const postCall = global.fetch.mock.calls.find(
        ([url, opts]) => (opts?.method || 'GET').toUpperCase() === 'POST',
      );
      // jsdom 의 window 크기는 1024x768 — computeVncGeometry 가 그대로 통과시킨다.
      const geom = JSON.parse(postCall[1].body).geometry;
      expect(geom).toMatch(/^\d+x\d+$/);
    });
  });

  it('does not show primary create action when installed is false', async () => {
    mockFetchResponse({ available: true, installed: false, displays: [] });

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText('vncNotInstalled')).toBeTruthy();
    });

    expect(screen.queryByText(/vncCreateAndConnect/)).toBeNull();
  });

  // ── RemoteFolderPicker 패턴 셸 (header/body, Esc 닫기) ──────────────────────

  it('calls onClose when Escape is pressed', () => {
    mockFetchResponse({ available: true, installed: true, displays: [] });
    const onClose = vi.fn();
    render(<VncDisplayPicker host={HOST} t={(k) => k} onPick={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders header with title and host name in RemoteFolderPicker pattern', async () => {
    mockFetchResponse({ available: true, installed: true, displays: [] });
    render(<VncDisplayPicker host={HOST} t={(k) => k} onPick={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() => {
      // 헤더가 "remoteDesktop — test-host" 형태 (RemoteFolderPicker 패턴).
      expect(screen.getByText(/remoteDesktop/)).toBeTruthy();
      expect(screen.getByText(/test-host/)).toBeTruthy();
    });
  });
});

// 빈 pane 의 홈은 App 홈과 같은 카드를 그린다. 로컬 원격 데스크톱 버튼 노출 여부
// (showLocalVnc)를 여기서 빠뜨리면 "PC 홈에는 아이콘이 뜨는데 폰에서 빈 pane 으로
// 들어가면 안 뜬다" 가 된다 — 실제로 그랬다.
describe('EmptyPane — 홈에 넘기는 로컬 VNC 노출 여부', () => {
  beforeEach(() => {
    lastHomeProps = null;
    resetLocalVncProbe();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetLocalVncProbe();
  });

  const renderEmptyPane = () => render(
    <EmptyPane hosts={[]} tab={{ id: 't1', panes: [] }} allTabs={[]} settings={{}} t={(k) => k} />,
  );

  it('로컬에 VNC 가 있으면 showLocalVnc=true 로 홈에 넘긴다', async () => {
    mockFetchResponse({ available: true, installed: true, displays: [] });
    renderEmptyPane();
    await waitFor(() => expect(lastHomeProps?.showLocalVnc).toBe(true));
  });

  it('로컬에 VNC 가 없으면 노출하지 않는다 — 컨테이너 배포', async () => {
    mockFetchResponse({ available: true, installed: false, displays: [] });
    renderEmptyPane();
    await waitFor(() => expect(lastHomeProps).toBeTruthy());
    expect(lastHomeProps.showLocalVnc).toBe(false);
  });

  it('조회가 실패하면 노출하지 않는다 — 조용히 false', async () => {
    mockFetchReject('boom');
    renderEmptyPane();
    await waitFor(() => expect(lastHomeProps).toBeTruthy());
    expect(lastHomeProps.showLocalVnc).toBe(false);
  });
});
