import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pushCapability, urlBase64ToUint8Array, subscribeToPush } from './pushSubscription';

// 푸시는 조건이 여러 개라 "실패"로 뭉개면 사용자가 뭘 고쳐야 할지 모른다.
// 특히 http://<사설IP> 접속은 설정이 아니라 **접속 주소** 문제다.

const setEnv = ({ secure = true, sw = true, push = true, permission = 'granted' } = {}) => {
  vi.stubGlobal('window', {
    isSecureContext: secure,
    ...(push ? { PushManager: class {} } : {}),
  });
  vi.stubGlobal('navigator', sw ? { serviceWorker: {} } : {});
  if (permission === null) vi.stubGlobal('Notification', undefined);
  else vi.stubGlobal('Notification', { permission });
};

afterEach(() => vi.unstubAllGlobals());

describe('pushCapability', () => {
  it('secure context 가 아니면 insecure — http://<사설IP> 로 접속한 경우다', () => {
    setEnv({ secure: false });
    expect(pushCapability()).toBe('insecure');
  });

  it('서비스워커나 PushManager 가 없으면 unsupported', () => {
    setEnv({ sw: false });
    expect(pushCapability()).toBe('unsupported');
    setEnv({ push: false });
    expect(pushCapability()).toBe('unsupported');
    setEnv({ permission: null });
    expect(pushCapability()).toBe('unsupported');
  });

  it('사용자가 차단했으면 denied — 다시 물어봐도 소용없다', () => {
    setEnv({ permission: 'denied' });
    expect(pushCapability()).toBe('denied');
  });

  it('아직 안 물어봤으면 default, 허용됐으면 ok', () => {
    setEnv({ permission: 'default' });
    expect(pushCapability()).toBe('default');
    setEnv({ permission: 'granted' });
    expect(pushCapability()).toBe('ok');
  });

  it('insecure 가 unsupported 보다 먼저다 — 원인을 정확히 짚어야 한다', () => {
    // http 접속에서는 브라우저가 PushManager 자체를 노출하지 않는다.
    // 그때 "지원 안 함"이라고 하면 사용자는 브라우저를 탓하게 된다.
    setEnv({ secure: false, sw: false, push: false });
    expect(pushCapability()).toBe('insecure');
  });
});

describe('subscribeToPush 실패 사유', () => {
  it('불가능한 환경이면 그 사유를 그대로 돌려준다', async () => {
    setEnv({ secure: false });
    expect(await subscribeToPush()).toEqual({ ok: false, reason: 'insecure' });
    setEnv({ permission: 'denied' });
    expect(await subscribeToPush()).toEqual({ ok: false, reason: 'denied' });
    setEnv({ sw: false });
    expect(await subscribeToPush()).toEqual({ ok: false, reason: 'unsupported' });
  });
});

describe('urlBase64ToUint8Array', () => {
  it('패딩 없는 base64url 을 바이트 배열로 바꾼다', () => {
    // VAPID 공개키는 패딩 없는 base64url 로 오고, 브라우저는 Uint8Array 를 요구한다.
    const out = urlBase64ToUint8Array('AAEC');   // 0x00 0x01 0x02
    expect(Array.from(out)).toEqual([0, 1, 2]);
  });

  it('- 와 _ 를 표준 base64 문자로 되돌린다', () => {
    const out = urlBase64ToUint8Array('-_8');    // 0xFB 0xFF
    expect(Array.from(out)).toEqual([251, 255]);
  });

  it('패딩이 필요한 길이도 처리한다', () => {
    expect(() => urlBase64ToUint8Array('AA')).not.toThrow();
  });
});
