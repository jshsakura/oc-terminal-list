import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// VncPane: WS 티켓 라이프사이클 + RFB 연결 + Phase 4/5 (리사이즈 추적·슬립).
// 진짜 createVncClient/issueWsTicket 를 부르면 백엔드·noVNC 가 끌려들어와 느리고
// 취약하다. 여기서는 VncPane 이 "언제 티켓을 발급하고 언제 클라이언트를 만드는가"
// "언제 일시정지 오버레이를 띄우는가" 만 검증한다.

// createVncClient mock — 호출 기록 + 즉시 resolved 가짜 클라이언트 반환.
const createVncClientMock = vi.fn();
let lastClientOpts;
// 가짜 RFB — createVncClient 가 반환하는 client.rfb. sendCredentials 호출 추적.
const fakeClient = {
  rfb: {
    resizeSession: false,
    scaleViewport: false,
    qualityLevel: 0,
    compressionLevel: 0,
    disconnect: vi.fn(),
    sendCredentials: vi.fn(),
  },
  destroy: vi.fn(),
};
vi.mock('./createVncClient', () => ({
  default: (opts) => {
    lastClientOpts = opts;
    createVncClientMock(opts);
    return Promise.resolve(fakeClient);
  },
}));

// issueWsTicket mock — 기본 성공 티켓. spy 로 호출 여부만 본다.
const issueWsTicketMock = vi.fn();
vi.mock('../terminal/terminalHelpers', () => ({
  issueWsTicket: (path) => {
    issueWsTicketMock(path);
    return Promise.resolve({ ticket: 'TICKET', authExpired: false });
  },
}));

// 모듈 로드는 mock 설정 후여야 한다.
import VncPane from './VncPane';
import { emitVncControl, getVncState } from './vncControlBus';

// jsdom gives every element a 0x0 rect, and 0x0 means "too small to be a desktop".
// Tests that care about the resize policy set a real size first.
const sizeContainer = (width, height) => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
    toJSON: () => ({}),
  });
};

describe('VncPane', () => {
  beforeEach(() => {
    createVncClientMock.mockClear();
    issueWsTicketMock.mockClear();
    fakeClient.destroy.mockClear();
    fakeClient.rfb.disconnect.mockClear();
    fakeClient.rfb.sendCredentials.mockClear();
    lastClientOpts = null;
    vi.restoreAllMocks();
    sizeContainer(1280, 800);   // a normal desktop-sized pane unless a test says otherwise
  });

  const baseProps = (over = {}) => ({
    hostId: 'host1',
    display: 0,
    isActive: true,
    isFocused: false,
    settings: {},
    t: (k) => k,   // 라벨 = 키 — 어떤 메시지가 떴는지로 판단
    onReadyChange: vi.fn(),
    ...over,
  });

  it('display 가 무효(null)면 "No VNC display selected" 만 보여주고 티켓을 발급하지 않는다', () => {
    render(<VncPane {...baseProps({ display: null })} />);
    expect(screen.getByText('vncInvalidDisplay')).toBeTruthy();
    expect(issueWsTicketMock).not.toHaveBeenCalled();
    expect(createVncClientMock).not.toHaveBeenCalled();
  });

  it('isActive=false 면 일시정지 메시지를 보여주고 티켓을 발급하지 않는다 (Phase 5)', () => {
    render(<VncPane {...baseProps({ isActive: false })} />);
    expect(screen.getByText('vncPaused')).toBeTruthy();
    expect(issueWsTicketMock).not.toHaveBeenCalled();
    expect(createVncClientMock).not.toHaveBeenCalled();
  });

  it('유효한 display + active 면 티켓을 발급하고 클라이언트를 만든다', async () => {
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(issueWsTicketMock).toHaveBeenCalledWith('/ws/vnc/host1'));
    await waitFor(() => expect(createVncClientMock).toHaveBeenCalledTimes(1));
    expect(lastClientOpts).toBeTruthy();
    expect(lastClientOpts.url).toContain('/ws/vnc/host1');
    expect(lastClientOpts.url).toContain('display=0');
    expect(lastClientOpts.url).toContain('ticket=TICKET');
  });

  it('onConnected 콜백이 발화하면 onReadyChange(true) 가 불린다', async () => {
    const onReadyChange = vi.fn();
    render(<VncPane {...baseProps({ onReadyChange })} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    // createVncClient 에 전달된 onConnected 를 직접 발화 — RFB 'connect' 이벤트 시뮬레이션.
    act(() => { lastClientOpts.onConnected(); });
    await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(true));
  });

  it('display 가 바뀌면 재연결을 위해 새 티켓을 발급한다', async () => {
    const { rerender } = render(<VncPane {...baseProps({ display: 0 })} />);
    await waitFor(() => expect(issueWsTicketMock).toHaveBeenCalledTimes(1));
    rerender(<VncPane {...baseProps({ display: 1 })} />);
    await waitFor(() => expect(issueWsTicketMock).toHaveBeenCalledTimes(2));
    expect(issueWsTicketMock).toHaveBeenLastCalledWith('/ws/vnc/host1');
  });

  // ── Task 3: 비밀번호 입력 플로우 ──

  it('credentialsrequired 이벤트 → 비밀번호 입력 폼이 뜬다', async () => {
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    act(() => { lastClientOpts.onCredentialsRequired(); });
    // 비밀번호 라벨이 보여야 함
    expect(screen.getByText('vncPassword')).toBeTruthy();
    // input[type=password] 가 있어야 함
    expect(document.querySelector('input[type="password"]')).toBeTruthy();
  });

  it('비밀번호 입력 후 제출 → rfb.sendCredentials({password}) 가 불린다', async () => {
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    act(() => { lastClientOpts.onCredentialsRequired(); });
    const input = document.querySelector('input[type="password"]');
    expect(input).toBeTruthy();
    act(() => {
      // React 의 controlled input 시뮬레이션 — native setter 로 value 변경 후 input 이벤트.
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      ).set;
      nativeInputValueSetter.call(input, 'secretpw');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = input.closest('form');
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fakeClient.rfb.sendCredentials).toHaveBeenCalledWith({ password: 'secretpw' });
  });

  it('securityfailure (틀린 비밀번호) → 재시도 폼으로 돌아간다', async () => {
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    // 먼저 credentialsrequired → 폼 표시
    act(() => { lastClientOpts.onCredentialsRequired(); });
    expect(screen.getByText('vncPassword')).toBeTruthy();
    // 틀린 비밀번호로 securityfailure
    act(() => { lastClientOpts.onSecurityFailure({ reason: 'bad password' }); });
    // 여전히 비밀번호 폼이 보여야 함 (재시도)
    expect(screen.getByText('vncPassword')).toBeTruthy();
    expect(screen.getByText('bad password')).toBeTruthy();
  });

  it('비밀번호는 state 에만 존재 — updateSettings 에 저장하지 않는다', async () => {
    const updateSettings = vi.fn();
    render(<VncPane {...baseProps({ updateSettings })} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    act(() => { lastClientOpts.onCredentialsRequired(); });
    const input = document.querySelector('input[type="password"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'mypw');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = input.closest('form');
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    // updateSettings 가 비밀번호와 함께 호출되지 않아야 함
    expect(updateSettings).not.toHaveBeenCalled();
  });

  // ── Quality presets ──

  it('qualityLevel/compressionLevel 이 rfb 에 적용된다 (balanced 기본)', async () => {
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    // balanced = { qualityLevel: 8, compressionLevel: 3 }
    // ⚠️ 8 은 취향이 아니라 TurboVNC 의 매핑에서 온 값이다 — 레벨 6 은 JPEG 79 라
    // 글자가 뭉갠다(6→79, 8→92, 9→100). 내리려면 그 표를 먼저 볼 것.
    expect(lastClientOpts.qualityLevel).toBe(8);
    expect(lastClientOpts.compressionLevel).toBe(3);
  });

  it('settings.vncQuality=sharp → qualityLevel=9, compressionLevel=0', async () => {
    render(<VncPane {...baseProps({ settings: { vncQuality: 'sharp' } })} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    expect(lastClientOpts.qualityLevel).toBe(9);
    expect(lastClientOpts.compressionLevel).toBe(0);
  });

  // ── Remote resolution policy + controls ──
  // A pane too small to be a desktop must never push SetDesktopSize: the remote
  // shrinks, its windows fall off screen, and that resolution stays in the
  // session — the desktop is still cropped when you open it on a PC later.

  it('a desktop-sized pane may drive the remote resolution', async () => {
    sizeContainer(1920, 1080);
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    expect(lastClientOpts.resizeSession).toBe(true);
  });

  it('a phone-sized pane may not — portrait', async () => {
    sizeContainer(390, 720);
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    expect(lastClientOpts.resizeSession).toBe(false);
  });

  it('a phone in landscape still may not — the rule is size, not user agent', async () => {
    sizeContainer(844, 390);
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    expect(lastClientOpts.resizeSession).toBe(false);
  });

  it('an unmeasured pane may not — never shrink a desktop on a guess', async () => {
    sizeContainer(0, 0);
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    expect(lastClientOpts.resizeSession).toBe(false);
  });

  it('connects in fit mode by default', async () => {
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    expect(lastClientOpts.viewMode).toBe('fit');
  });

  it('honours a saved pan view mode', async () => {
    render(<VncPane {...baseProps({ settings: { vncViewMode: 'pan' } })} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    expect(lastClientOpts.viewMode).toBe('pan');
  });

  // The pane draws no controls of its own: the desktop *is* the content, and the
  // old overlay rail covered it and was slow to hit on a phone.
  it('draws no control rail on the pane', async () => {
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    const titles = [...document.querySelectorAll('button')].map((b) => b.title);
    expect(titles).not.toContain('vncQuality');
  });

  it('publishes its state so the tab menu can show what is on', async () => {
    render(<VncPane {...baseProps({ paneId: 'pane-1', settings: { vncQuality: 'light' } })} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    expect(getVncState('pane-1')).toEqual({ viewMode: 'fit', quality: 'light' });
  });

  it('applies a view mode from the menu on the spot, then persists it', async () => {
    const updateSettings = vi.fn();
    render(<VncPane {...baseProps({ paneId: 'pane-1', updateSettings })} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    act(() => { lastClientOpts.onConnected(); });

    act(() => { emitVncControl('pane-1', { viewMode: 'pan' }); });

    // The RFB is already in pan mode — the picture must not wait for the PUT.
    expect(fakeClient.rfb.scaleViewport).toBe(false);
    expect(fakeClient.rfb.clipViewport).toBe(true);
    expect(fakeClient.rfb.dragViewport).toBe(true);
    expect(updateSettings).toHaveBeenCalledWith({ vncViewMode: 'pan' });
  });

  it('applies quality from the menu on the spot, then persists it', async () => {
    const updateSettings = vi.fn();
    render(<VncPane {...baseProps({ paneId: 'pane-1', updateSettings })} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    act(() => { lastClientOpts.onConnected(); });

    act(() => { emitVncControl('pane-1', { quality: 'sharp' }); });

    expect(fakeClient.rfb.qualityLevel).toBe(9);
    expect(fakeClient.rfb.compressionLevel).toBe(0);
    expect(updateSettings).toHaveBeenCalledWith({ vncQuality: 'sharp' });
  });

  it('the tab menu opens the settings modal — nothing is drawn on the desktop', async () => {
    render(<VncPane {...baseProps({ paneId: 'pane-1' })} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    expect(screen.queryByText('vncSettings')).toBeNull();

    act(() => { emitVncControl('pane-1', { openSettings: true }); });

    expect(screen.getByText('vncSettings')).toBeTruthy();
  });

  it('picking a view mode in the modal applies it and persists it', async () => {
    const updateSettings = vi.fn();
    render(<VncPane {...baseProps({ paneId: 'pane-1', updateSettings })} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    act(() => { lastClientOpts.onConnected(); });
    act(() => { emitVncControl('pane-1', { openSettings: true }); });

    const panBtn = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes('vncViewPan'));
    expect(panBtn).toBeTruthy();
    act(() => { panBtn.click(); });

    expect(fakeClient.rfb.scaleViewport).toBe(false);
    expect(fakeClient.rfb.clipViewport).toBe(true);
    expect(fakeClient.rfb.dragViewport).toBe(true);
    expect(updateSettings).toHaveBeenCalledWith({ vncViewMode: 'pan' });
  });

  it('ignores control events addressed to another pane', async () => {
    const updateSettings = vi.fn();
    render(<VncPane {...baseProps({ paneId: 'pane-1', updateSettings })} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());

    act(() => { emitVncControl('pane-2', { viewMode: 'pan' }); });

    expect(updateSettings).not.toHaveBeenCalled();
  });

  // ── 로딩 진행 표현 ──

  it('connecting 상태에서 진행 단계 표현이 렌더된다', async () => {
    render(<VncPane {...baseProps()} />);
    // 첫 연결 시도 중 — ticket 또는 negotiating 단계 텍스트가 보여야 함.
    await waitFor(() => {
      const phase = screen.queryByText('vncPhaseConnecting') || screen.queryByText('vncPhaseNegotiating');
      expect(phase).toBeTruthy();
    });
  });

  it('연결 완료 후 진행 표현이 사라진다', async () => {
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    // 연결 전에는 진행 표현이 있음
    await waitFor(() => {
      const phase = screen.queryByText('vncPhaseConnecting') || screen.queryByText('vncPhaseNegotiating');
      expect(phase).toBeTruthy();
    });
    // onConnected 발화 → connected
    act(() => { lastClientOpts.onConnected(); });
    // 진행 표현이 사라져야 함
    await waitFor(() => {
      expect(screen.queryByText('vncPhaseConnecting')).toBeNull();
      expect(screen.queryByText('vncPhaseNegotiating')).toBeNull();
    });
  });

  it('실패 시 오류 표시가 유지되고 진행 표현은 사라진다', async () => {
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    // credentials 프롬프트 없이 securityfailure → 에러
    act(() => { lastClientOpts.onSecurityFailure({ reason: 'auth failed' }); });
    // 진행 표현은 없어야 함
    expect(screen.queryByText('vncPhaseConnecting')).toBeNull();
    expect(screen.queryByText('vncPhaseNegotiating')).toBeNull();
    // 에러 메시지는 보여야 함
    expect(screen.getByText('auth failed')).toBeTruthy();
  });

  it('재부착(isActive 토글) 시에도 진행 표현이 매번 보인다 — 조용히 생략하지 않는다', async () => {
    const { rerender } = render(<VncPane {...baseProps()} />);
    // 첫 연결
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    act(() => { lastClientOpts.onConnected(); });
    // connected → 진행 표현 숨김
    await waitFor(() => {
      expect(screen.queryByText('vncPhaseConnecting')).toBeNull();
      expect(screen.queryByText('vncPhaseNegotiating')).toBeNull();
    });
    // 백그라운드 전환 — 일시정지 메시지가 뜰 때까지 대기
    rerender(<VncPane {...baseProps({ isActive: false })} />);
    await waitFor(() => expect(screen.getByText('vncPaused')).toBeTruthy());
    // 복귀 — 재부착 시작
    rerender(<VncPane {...baseProps({ isActive: true })} />);
    // 재부착 연결 시작 → 진행 표현이 다시 보여야 함
    await waitFor(() => {
      const phase = screen.queryByText('vncPhaseConnecting')
        || screen.queryByText('vncPhaseNegotiating');
      expect(phase).toBeTruthy();
    });
  });
  /* ── 모바일 조작 바 ─────────────────────────────────────────────────────────
     폰에서 VNC 는 절대 좌표 탭이라 조작이 사실상 불가능했다. 여기서 잠그는 것은 셋:
     (1) 데스크탑만 한 pane 에는 안 나온다, (2) 작은 pane + 연결됨이면 나온다,
     (3) **확대가 원격 해상도를 건드리지 않는다** — 남의 화면을 바꾸는 사고라 제일 중요하다. */
  describe('VncPane 모바일 조작 바', () => {
    let fireResize;

    beforeEach(() => {
      // 기본 스텁 RO 는 콜백을 부르지 않는다 — 크기 변화를 실제로 흘려보내는 것으로 갈아끼운다.
      const callbacks = [];
      fireResize = () => callbacks.forEach((cb) => act(() => cb()));
      global.ResizeObserver = class {
        constructor(cb) { callbacks.push(cb); }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    });

    it('데스크탑만 한 pane 에는 나오지 않는다 — 마우스가 있는 사람에게는 방해다', async () => {
      sizeContainer(1600, 900);
      render(<VncPane {...baseProps()} />);
      await waitFor(() => expect(createVncClientMock).toHaveBeenCalled());
      fireResize();
      expect(screen.queryByRole('application')).toBeNull();
    });

    it('작은 pane 이고 연결됐으면 나온다', async () => {
      sizeContainer(390, 700);
      render(<VncPane {...baseProps()} />);
      await waitFor(() => expect(createVncClientMock).toHaveBeenCalled());
      act(() => { lastClientOpts.onConnected(); });
      fireResize();
      await waitFor(() => expect(screen.getByRole('application')).toBeTruthy());
    });

    it('확대는 화면 상자를 배율만큼 키운다 — CSS transform 이면 누르는 곳이 어긋난다', async () => {
      sizeContainer(390, 700);
      render(<VncPane {...baseProps()} />);
      await waitFor(() => expect(createVncClientMock).toHaveBeenCalled());
      act(() => { lastClientOpts.onConnected(); });
      fireResize();
      await waitFor(() => expect(screen.getByRole('application')).toBeTruthy());

      expect(screen.getByTestId('vnc-screen').style.width).toBe('100%');
      act(() => { screen.getByTitle('vncZoomIn').click(); });
      // 첫 단계는 1.5배 — 390 * 1.5
      expect(screen.getByTestId('vnc-screen').style.width).toBe('585px');
    });

    it('확대해도 원격 해상도는 통보하지 않는다 — 폰 배율이 남의 데스크탑을 바꾸면 안 된다', async () => {
      sizeContainer(390, 700);
      render(<VncPane {...baseProps()} />);
      await waitFor(() => expect(createVncClientMock).toHaveBeenCalled());
      act(() => { lastClientOpts.onConnected(); });
      fireResize();
      await waitFor(() => expect(screen.getByRole('application')).toBeTruthy());

      fakeClient.rfb.resizeSession = false;
      act(() => { screen.getByTitle('vncZoomIn').click(); });
      fireResize();                       // 컨테이너가 커졌다 → RO 가 돈다
      // 확대된 컨테이너(585×1050)는 "데스크탑만 하다" 로 보이지만, 판정 기준은 래퍼(390×700)다.
      expect(fakeClient.rfb.resizeSession).toBe(false);
    });
  });
});

// act 를 인라인으로 쓰기 위한 헬퍼 import (react testing-library act).
import { act } from '@testing-library/react';
