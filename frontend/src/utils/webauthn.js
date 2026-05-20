// WebAuthn (passkey) 브라우저 ↔ JSON 인코딩 헬퍼.
// py_webauthn 백엔드는 base64url 문자열 형식을 받고, 브라우저는 ArrayBuffer 를 다룬다.
// 양방향 변환 + 등록/인증 흐름을 짧게 노출.

export const isPasskeySupported = () => {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential === 'function'
    && typeof navigator !== 'undefined'
    && !!navigator.credentials
    && typeof navigator.credentials.create === 'function'
    && typeof navigator.credentials.get === 'function';
};

// ── base64url helpers ──
const b64uToBytes = (b64u) => {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const b64 = (b64u + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};
const bytesToB64u = (buf) => {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

// 백엔드(py_webauthn options_to_json)는 challenge/user.id/excludeCredentials[].id/allowCredentials[].id
// 를 모두 base64url 문자열로 직렬화한다. 브라우저 navigator.credentials.* 는 ArrayBuffer 만 받는다.
// → 등록/인증 옵션을 받자마자 해당 필드들을 ArrayBuffer 로 디코딩.
const decodeRegistrationOptions = (opts) => {
  const out = { ...opts };
  out.challenge = b64uToBytes(opts.challenge);
  out.user = { ...opts.user, id: b64uToBytes(opts.user.id) };
  if (Array.isArray(opts.excludeCredentials)) {
    out.excludeCredentials = opts.excludeCredentials.map((c) => ({ ...c, id: b64uToBytes(c.id) }));
  }
  return out;
};
const decodeAuthenticationOptions = (opts) => {
  const out = { ...opts };
  out.challenge = b64uToBytes(opts.challenge);
  if (Array.isArray(opts.allowCredentials)) {
    out.allowCredentials = opts.allowCredentials.map((c) => ({ ...c, id: b64uToBytes(c.id) }));
  }
  return out;
};

// PublicKeyCredential → 백엔드가 받는 JSON 모양 (py_webauthn 의 RegistrationCredential 스키마와 동일).
const encodeRegistrationCredential = (cred) => ({
  id: cred.id,
  rawId: bytesToB64u(cred.rawId),
  type: cred.type,
  authenticatorAttachment: cred.authenticatorAttachment || null,
  clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
  response: {
    clientDataJSON: bytesToB64u(cred.response.clientDataJSON),
    attestationObject: bytesToB64u(cred.response.attestationObject),
    transports: typeof cred.response.getTransports === 'function' ? cred.response.getTransports() : [],
  },
});
const encodeAuthenticationCredential = (cred) => ({
  id: cred.id,
  rawId: bytesToB64u(cred.rawId),
  type: cred.type,
  authenticatorAttachment: cred.authenticatorAttachment || null,
  clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
  response: {
    clientDataJSON: bytesToB64u(cred.response.clientDataJSON),
    authenticatorData: bytesToB64u(cred.response.authenticatorData),
    signature: bytesToB64u(cred.response.signature),
    userHandle: cred.response.userHandle ? bytesToB64u(cred.response.userHandle) : null,
  },
});

// ── 고수준 API ──
// authFetch: 호출자가 토큰을 직접 헤더에 넣어 호출.

const authHeaders = () => {
  if (typeof localStorage === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** 등록 흐름: begin → 브라우저 create → complete. label 은 사용자 메모. */
export const registerPasskey = async (label) => {
  if (!isPasskeySupported()) throw new Error('이 브라우저는 패스키를 지원하지 않습니다');
  const beginRes = await fetch('/api/auth/passkey/register/begin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ label: label || null }),
  });
  if (!beginRes.ok) {
    const text = await beginRes.text();
    throw new Error(`등록 시작 실패: ${text || beginRes.status}`);
  }
  const { options } = await beginRes.json();
  const publicKey = decodeRegistrationOptions(options);
  const cred = await navigator.credentials.create({ publicKey });
  if (!cred) throw new Error('패스키 생성이 취소되었습니다');
  const completeRes = await fetch('/api/auth/passkey/register/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ label: label || null, response: encodeRegistrationCredential(cred) }),
  });
  if (!completeRes.ok) {
    const text = await completeRes.text();
    throw new Error(`등록 검증 실패: ${text || completeRes.status}`);
  }
  return completeRes.json();
};

/** 로그인 흐름: begin → 브라우저 get → complete → {access_token, username}. */
export const loginWithPasskey = async () => {
  if (!isPasskeySupported()) throw new Error('이 브라우저는 패스키를 지원하지 않습니다');
  const beginRes = await fetch('/api/auth/passkey/login/begin', { method: 'POST' });
  if (!beginRes.ok) {
    const text = await beginRes.text();
    throw new Error(text || '패스키 로그인을 시작할 수 없습니다');
  }
  const { options, challenge_id: challengeId } = await beginRes.json();
  const publicKey = decodeAuthenticationOptions(options);
  const cred = await navigator.credentials.get({ publicKey });
  if (!cred) throw new Error('패스키 인증이 취소되었습니다');
  const completeRes = await fetch('/api/auth/passkey/login/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge_id: challengeId,
      response: encodeAuthenticationCredential(cred),
    }),
  });
  if (!completeRes.ok) {
    const text = await completeRes.text();
    throw new Error(text || '패스키 인증 실패');
  }
  return completeRes.json();
};

export const listPasskeys = async () => {
  const res = await fetch('/api/auth/passkey/list', { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error('패스키 목록을 불러올 수 없습니다');
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
};

export const renamePasskey = async (rowId, label) => {
  const res = await fetch(`/api/auth/passkey/${rowId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error('이름 변경 실패');
};

export const deletePasskey = async (rowId) => {
  const res = await fetch(`/api/auth/passkey/${rowId}`, {
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error('삭제 실패');
};
