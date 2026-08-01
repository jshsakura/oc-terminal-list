import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// VncPane: WS 티켓 라이프사이클 + RFB 연결 + Phase 4/5 (리사이즈 추적·슬립).
// 진짜 createVncClient/issueWsTicket 를 부르면 백엔드·noVNC 가 끌려들어와 느리고
// 취약하다. 여기서는 VncPane 이 "언제 티켓을 발급하고 언제 클라이언트를 만드는가"
// "언제 일시정지 오버레이를 띄우는가" 만 검증한다.

// createVncClient mock — 호출 기록 + 즉시 resolved 가짜 클라이언트 반환.
const createVncClientMock = vi.fn();
let lastClientOpts;
const fakeClient = {
  rfb: { resizeSession: false, scaleViewport: false, disconnect: vi.fn() },
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
});

// act 를 인라인으로 쓰기 위한 헬퍼 import (react testing-library act).
import { act } from '@testing-library/react';
