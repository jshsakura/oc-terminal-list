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

describe('VncPane', () => {
  beforeEach(() => {
    createVncClientMock.mockClear();
    issueWsTicketMock.mockClear();
    fakeClient.destroy.mockClear();
    fakeClient.rfb.disconnect.mockClear();
    fakeClient.rfb.sendCredentials.mockClear();
    lastClientOpts = null;
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

  // ── Task 4: 화질 프리셋 ──

  it('qualityLevel/compressionLevel 이 rfb 에 적용된다 (balanced 기본)', async () => {
    render(<VncPane {...baseProps()} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    // balanced = { qualityLevel: 6, compressionLevel: 3 }
    expect(lastClientOpts.qualityLevel).toBe(6);
    expect(lastClientOpts.compressionLevel).toBe(3);
  });

  it('settings.vncQuality=sharp → qualityLevel=9, compressionLevel=0', async () => {
    render(<VncPane {...baseProps({ settings: { vncQuality: 'sharp' } })} />);
    await waitFor(() => expect(lastClientOpts).toBeTruthy());
    expect(lastClientOpts.qualityLevel).toBe(9);
    expect(lastClientOpts.compressionLevel).toBe(0);
  });

  it('화질 변경 시 updateSettings 가 불린다', async () => {
    const updateSettings = vi.fn();
    render(<VncPane {...baseProps({ updateSettings })} />);
    const select = document.querySelector('select');
    expect(select).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'light');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(updateSettings).toHaveBeenCalledWith({ vncQuality: 'light' });
  });
});

// act 를 인라인으로 쓰기 위한 헬퍼 import (react testing-library act).
import { act } from '@testing-library/react';
