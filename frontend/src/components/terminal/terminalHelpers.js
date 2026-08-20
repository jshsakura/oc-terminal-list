/**
 * Terminal 순수 헬퍼 — 입력 분류, 이미지 압축, 클립보드 복사, ws-ticket 발급.
 * 컴포넌트 상태에 의존하지 않는 함수만(테스트·재사용 용이). 로직 변경 없이 Terminal.jsx 에서 추출.
 */
import { authHeaders } from '../../utils/auth';
import { copyToClipboard } from '../../utils/clipboard';
import { createWsTicketBatcher } from '../../utils/wsTicketBatch';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// onData / sendData 가 통과한 데이터 중 어떤 것이 "히스토리에 기록할 만한 명령" 인지 판정.
// 단일 키스트로크와 escape sequence 를 거르고, multi-char 입력만 통과 — paste / Quick Input / IME 조합.
export const looksLikeBulkCommand = (data) => {
  if (typeof data !== 'string') return false;
  if (data.length < 2) return false;
  if (data.charCodeAt(0) === 0x1b) return false; // ANSI escape
  // 한 글자라도 가시문자가 있어야 함
  let hasPrintable = false;
  for (let i = 0; i < data.length; i += 1) {
    const c = data.charCodeAt(i);
    if (c >= 0x20 && c !== 0x7f) { hasPrintable = true; break; }
  }
  return hasPrintable;
};

export const looksLikeRecoverableBulkInput = (data) => {
  if (typeof data !== 'string' || data.length < 16) return false;
  const cleaned = data
    .replace(/^\x1b\[200~/, '')
    .replace(/\x1b\[201~$/, '')
    .replace(/[\r\n]+$/g, '')
    .trim();
  return looksLikeBulkCommand(cleaned);
};

// 붙여넣은 이미지를 업로드 전에 다운스케일/재인코딩. 스크린샷 PNG 는 수 MB 라 공유 터널로
// 그대로 올리면 느려서 "업로드 중" 이 한참 돈다. 긴 변 2048px 로 줄이고 WebP(q0.85)로 재인코딩하면
// 보통 수백 KB 로 떨어져 즉시 올라간다. 작은 이미지·재인코딩 불가 포맷(gif/svg)·실패 시 원본 그대로.
const MAX_PASTE_IMAGE_DIM = 2048;
const PASTE_IMAGE_COMPRESS_OVER_BYTES = 768 * 1024;
export const compressPastedImage = async (blob) => {
  try {
    if (!/^image\/(png|jpe?g|webp|bmp)$/.test(blob.type || '')) return blob;
    if (typeof createImageBitmap !== 'function') return blob;
    const bmp = await createImageBitmap(blob);
    const longest = Math.max(bmp.width, bmp.height);
    const scale = Math.min(1, MAX_PASTE_IMAGE_DIM / longest);
    if (scale === 1 && blob.size < PASTE_IMAGE_COMPRESS_OVER_BYTES) { bmp.close?.(); return blob; }
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close?.(); return blob; }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const out = await new Promise((resolve) => {
      try { canvas.toBlob(resolve, 'image/webp', 0.85); } catch { resolve(null); }
    });
    if (!out || out.size >= blob.size) return blob; // 외려 커지면 원본
    return out;
  } catch {
    return blob;
  }
};

/**
 * 클라이언트에서만 아는 실패를 **살아있는 WebSocket 으로** 서버에 알린다.
 *
 * HTTP 로 보내면 안 된다 — 알려야 할 상황이 바로 그 HTTP 가 막힌 때다. 실제로
 * 2026-08-20 의 업로드 실패는 서버·터널 어디에도 흔적이 없어(요청이 나가질 못했다)
 * 원인을 추정으로만 좁혀야 했다. WS 는 매번 새 TCP 라 그때도 살아 있었다.
 *
 * 실패해도 조용히 넘어간다 — 이건 **관측**이지 기능이 아니다.
 */
export const reportClientError = (getSocket, { scope, kind, detail = '' }) => {
  try {
    const ws = getSocket?.();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'client-error',
      scope: String(scope || '').slice(0, 32),
      kind: String(kind || '').slice(0, 32),
      detail: String(detail || '').slice(0, 200),
    }));
  } catch { /* 관측이 기능을 망가뜨리면 안 된다 */ }
};

/**
 * 업로드 실패의 **종류**. 호출부가 사용자에게 무엇을 말할지, 재시도할지를 이걸로 정한다.
 *
 *  - `blocked` : 요청이 서버에 **도착조차 못 했다.** 이 배포의 단골 고장 — 공유 HTTP/2
 *                연결이 막히면 평범한 fetch 는 죽는데 WebSocket 은 매번 새 TCP 라 멀쩡히
 *                살아 있다. 그래서 "터미널은 되는데 업로드만 안 되는" 조합이 나오고,
 *                새로고침(=새 연결 풀)하면 즉시 낫는다.
 *  - `offline` : 브라우저가 오프라인이라고 말한다. 기다리면 된다.
 *  - `server`  : 서버가 답은 했는데 거절했다(용량·형식·원격 /tmp 등). detail 이 있다.
 */
export class UploadError extends Error {
  constructor(kind, message, detail = '') {
    super(message);
    this.name = 'UploadError';
    this.kind = kind;
    this.detail = detail;
  }
}

const HEALTH_PROBE_MS = 3000;

/**
 * HTTP 경로가 살아 있나? 업로드가 네트워크 단에서 죽었을 때만 부른다.
 *
 * 이 한 번의 값싼 왕복이 **40초를 아낀다**: 예전에는 실패하면 곧장 같은 fetch 를 다시
 * 쏘았는데, 막힌 것은 연결 자체라 두 번째도 똑같이 20초를 태우고 죽었다. 프로브가
 * 실패하면 재시도해봐야 소용없다는 뜻이므로 즉시 정직하게 실패한다.
 */
const isHttpPathAlive = async () => {
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
        ? AbortSignal.timeout(HEALTH_PROBE_MS) : undefined,
    });
    return res.ok;
  } catch {
    return false;
  }
};

// 붙여넣기/첨부 이미지를 서버에 업로드. timeout 으로 무한 대기 차단(대기중 터미널은 공유 HTTP 연결이
// wedge 돼 fetch 가 영영 매달리던 게 "업로드 중" 무한 회전의 원인 — 새로고침하면 됐던 이유).
const postPasteImage = async (sendBlob, hostId, attempt = 0) => {
  const fd = new FormData();
  const ext = (sendBlob.type.split('/')[1] || 'png').replace('+xml', '');
  fd.append('file', sendBlob, `pasted.${ext}`);
  // 원격 pane 이면 그 호스트에 올려야 한다 — 로컬에 올리면 상대 셸이 못 여는
  // 경로가 삽입되고, 붙여넣기는 성공한 것처럼 보인다.
  if (hostId) fd.append('host_id', hostId);
  try {
    return await fetch('/api/terminal/paste-image', {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(20000) : undefined,
    });
  } catch (err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new UploadError('offline', 'offline');
    }
    // 값싼 프로브로 "이 fetch 만 실패했나 / HTTP 경로 자체가 막혔나" 를 가른다.
    if (!(await isHttpPathAlive())) {
      throw new UploadError('blocked', 'http path is wedged', String(err?.name || err));
    }
    if (attempt < 1) return postPasteImage(sendBlob, hostId, attempt + 1);
    throw new UploadError('server', String(err?.message || err));
  }
};

// 이미지 blob → 압축 → 업로드 → 저장 경로 메타({ path, size, scope }). 실패 시 UploadError.
// PTY 는 텍스트만 전달하므로 이미지 자체는 못 보냄 → 경로로 우회.
// 데스크톱(Terminal 클립보드 붙여넣기)·모바일(빠른입력창 첨부/붙여넣기) 공용.
export const uploadImageAndGetPath = async (blob, hostId = null) => {
  const sendBlob = await compressPastedImage(blob);
  const res = await postPasteImage(sendBlob, hostId);
  const data = await res.json().catch(() => null);
  // 서버가 답을 했다 = 도착은 했다. 거절 사유는 그대로 올린다(원격 /tmp 가 찼다 같은 것).
  if (!res.ok) throw new UploadError('server', data?.detail || `${res.status}`, `${res.status}`);
  return data;
};

// 임의 파일(사진 포함) 업로드 → 저장 경로 메타({ path, size, scope }). 압축 없음.
// 우클릭 "파일 보내기" 에서 사용. 큰 파일 대비 timeout 60s + 1회 재시도.
const postPasteFile = async (file, hostId, attempt = 0) => {
  const fd = new FormData();
  fd.append('file', file, file.name || 'file');
  if (hostId) fd.append('host_id', hostId);
  try {
    return await fetch('/api/terminal/paste-file', {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(60000) : undefined,
    });
  } catch (err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new UploadError('offline', 'offline');
    }
    if (!(await isHttpPathAlive())) {
      throw new UploadError('blocked', 'http path is wedged', String(err?.name || err));
    }
    if (attempt < 1) return postPasteFile(file, hostId, attempt + 1);
    throw new UploadError('server', String(err?.message || err));
  }
};

export const uploadFileAndGetPath = async (file, hostId = null) => {
  const res = await postPasteFile(file, hostId);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new UploadError('server', data?.detail || `${res.status}`, `${res.status}`);
  return data;
};

// 구현은 utils/clipboard 하나뿐이다 — 이 이름은 터미널 쪽 호출부 호환용 별칭.
export const copyTextToClipboard = (text) => copyToClipboard(text);

const TICKET_TIMEOUT_MS = 7000;

const postTicketBatch = async (paths) => {
  const res = await fetch('/api/ws-tickets', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ paths }),
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(TICKET_TIMEOUT_MS)
      : undefined,
  });
  if (!res.ok) return { ok: false, status: res.status, tickets: null };
  const data = await res.json().catch(() => null);
  return { ok: true, status: res.status, tickets: data?.tickets || null };
};

const ticketBatcher = createWsTicketBatcher({ postBatch: postTicketBatch });

/**
 * 한 pane 의 티켓을 얻는다 — 실제 HTTP 는 배처가 30ms 창으로 모아 한 번만 나간다.
 * 반환 계약은 예전 그대로: { ticket, authExpired }.
 */
export const issueWsTicket = async (path) => {
  const result = await ticketBatcher.request(path);
  if (result.authExpired) {
    window.dispatchEvent(new CustomEvent('auth:session-expired'));
  }
  return result;
};


/* ── 업로드한 경로를 실제로 넣기 ────────────────────────────────────────────────
 *
 * 업로드가 200 을 받아도 경로가 터미널에 안 들어가는 일이 있었다. `term.paste()` 는
 * 입력 큐를 지나는데, 그 큐는 **소켓이 닫혀 있는 동안 쌓인 입력을 4초 뒤 버린다**
 * (STALE_INPUT_MS — 몇 분 전 입력이 나중에 프롬프트로 쏟아지는 걸 막는 규칙이라 옳다).
 * 그런데 재연결은 흔히 그보다 오래 걸리고, 그동안 화면에는 초록 "완료" 가 떴다.
 * 서버 로그에는 실패가 하나도 안 남는다 — 업로드는 정말로 성공했으니까.
 *
 * 그래서 **붙여넣기 전에 소켓이 열릴 때까지 잠깐 기다린다.** 큐의 나이 규칙은 그대로 둔다
 * (그건 키 입력을 위한 것이다). 끝내 안 열리면 조용히 성공한 척하지 않고 그렇게 말한다.
 */
export const PASTE_CONNECT_WAIT_MS = 3000;
const PASTE_POLL_MS = 100;

const socketOpen = (getSocket) => {
  const ws = getSocket?.();
  return !!ws && ws.readyState === 1; // WebSocket.OPEN
};

/**
 * 소켓이 열려 있으면 즉시, 아니면 최대 `waitMs` 까지 기다렸다가 붙여넣는다.
 * @returns {Promise<boolean>} 실제로 넣었는지. false 면 호출부가 사용자에게 알려야 한다.
 */
export const pasteWhenConnected = async (term, text, getSocket, { waitMs = PASTE_CONNECT_WAIT_MS } = {}) => {
  if (!term || !text) return false;
  // getSocket 이 없는 호출부는 예전처럼 그냥 넣는다 — 판정할 근거가 없다.
  if (typeof getSocket !== 'function') {
    term.paste(text);
    return true;
  }
  const deadline = Date.now() + waitMs;
  while (!socketOpen(getSocket)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, PASTE_POLL_MS));
  }
  term.paste(text);
  return true;
};
