import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { VncDisplayPicker } from './EmptyPane';

// authHeaders mock — 실제 토큰 로직 없이 헤더 객체만 반환
vi.mock('../../utils/auth', () => ({
  authHeaders: () => ({ Authorization: 'Bearer test' }),
}));

// tokens mock — VncDisplayPicker 가 color/fontSize/fontWeight/font 를 사용
vi.mock('../../styles/tokens', () => ({
  tokens: {
    color: {
      surface0: '#1a1b26', surface1: '#24283b', border: '#3b4261',
      text: '#c0caf5', subtext: '#565f89', accent: '#7aa2f7',
      success: '#9ece6a', warning: '#e0af68', danger: '#f7768e',
    },
    font: { sans: 'sans-serif' },
    fontSize: { '10': '10px', '11': '11px', '12': '12px', '13': '13px' },
    fontWeight: { medium: 500, semibold: 600 },
  },
}));

// HomeDashboard mock — VncDisplayPicker 테스트에 불필요한 의존성 차단
vi.mock('../HomeDashboard', () => ({
  default: () => null,
  HostRow: () => null,
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
});
