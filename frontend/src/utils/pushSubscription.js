/**
 * 웹 푸시 구독 — 브라우저 구독 생성/해제와 서버 등록.
 *
 * 실패 사유를 절대 뭉개지 않는다. 푸시는 조건이 여러 개(보안 컨텍스트, 서비스워커,
 * 알림 권한)라 그냥 "실패"라고만 하면 사용자가 뭘 고쳐야 할지 알 수 없다.
 * 특히 `http://<사설IP>:38822` 로 접속하면 **브라우저가 API 자체를 노출하지 않는다** —
 * 이건 설정 문제가 아니라 접속 주소 문제라, 그렇게 말해줘야 한다.
 * (localhost 와 https 는 secure context 라 정상 동작한다.)
 */
import { authHeaders } from './auth';

/** 'ok' | 'insecure' | 'unsupported' | 'denied' | 'default' */
export const pushCapability = () => {
  if (typeof window === 'undefined') return 'unsupported';
  // localhost 는 http 여도 secure context 로 취급된다.
  if (!window.isSecureContext) return 'insecure';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' ? 'ok' : 'default';
};

/** VAPID 공개키(base64url) → Uint8Array. 브라우저가 요구하는 형식. */
export const urlBase64ToUint8Array = (base64) => {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
};

const keyToBase64 = (key) => {
  const bytes = new Uint8Array(key);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * 구독 생성 + 서버 등록.
 * 반환: { ok: true } | { ok: false, reason }
 *   reason: 'insecure' | 'unsupported' | 'denied' | 'failed'
 */
export const subscribeToPush = async () => {
  const cap = pushCapability();
  if (cap === 'insecure' || cap === 'unsupported' || cap === 'denied') {
    return { ok: false, reason: cap };
  }

  if (Notification.permission !== 'granted') {
    const granted = await Notification.requestPermission();
    if (granted !== 'granted') return { ok: false, reason: 'denied' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const res = await fetch('/api/push/public-key', { headers: authHeaders() });
    if (!res.ok) return { ok: false, reason: 'failed' };
    const { publicKey } = await res.json();

    // 이미 구독이 있으면 그대로 재사용한다 — 새로 만들면 endpoint 가 바뀌어
    // 서버에 죽은 행이 남는다.
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const json = subscription.toJSON();
    const saved = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh || keyToBase64(subscription.getKey('p256dh')),
        auth: json.keys?.auth || keyToBase64(subscription.getKey('auth')),
      }),
    });
    return saved.ok ? { ok: true } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
};

/** 브라우저 구독 해제 + 서버에서 제거. */
export const unsubscribeFromPush = async () => {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return { ok: true };
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ endpoint }),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
};

/** 이 기기가 지금 구독 중인가. */
export const isSubscribed = async () => {
  if (pushCapability() === 'unsupported' || pushCapability() === 'insecure') return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    return !!(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
};
