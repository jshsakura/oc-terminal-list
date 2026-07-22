/**
 * Terminal 순수 헬퍼 — 입력 분류, 이미지 압축, 클립보드 복사, ws-ticket 발급.
 * 컴포넌트 상태에 의존하지 않는 함수만(테스트·재사용 용이). 로직 변경 없이 Terminal.jsx 에서 추출.
 */
import { authHeaders } from '../../utils/auth';

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

// 붙여넣기/첨부 이미지를 서버에 업로드. timeout 으로 무한 대기 차단(대기중 터미널은 공유 HTTP 연결이
// wedge 돼 fetch 가 영영 매달리던 게 "업로드 중" 무한 회전의 원인 — 새로고침하면 됐던 이유).
// timeout/네트워크 오류 시 한 번은 새 연결로 재시도(=새로고침 효과).
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
    if (attempt < 1) return postPasteImage(sendBlob, hostId, attempt + 1);
    throw err;
  }
};

// 이미지 blob → 압축 → 업로드 → 저장 경로 메타({ path, size, scope }). 실패 시 throw.
// PTY 는 텍스트만 전달하므로 이미지 자체는 못 보냄 → 경로로 우회.
// 데스크톱(Terminal 클립보드 붙여넣기)·모바일(빠른입력창 첨부/붙여넣기) 공용.
export const uploadImageAndGetPath = async (blob, hostId = null) => {
  const sendBlob = await compressPastedImage(blob);
  const res = await postPasteImage(sendBlob, hostId);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || `${res.status}`);
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
    if (attempt < 1) return postPasteFile(file, hostId, attempt + 1);
    throw err;
  }
};

export const uploadFileAndGetPath = async (file, hostId = null) => {
  const res = await postPasteFile(file, hostId);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || `${res.status}`);
  return data;
};

const execCommandCopy = (text) => {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch { /* noop */ }
  document.body.removeChild(ta);
};

// clipboard.writeText 가 없거나 비-HTTPS 컨텍스트에서 실패할 경우 textarea 폴백.
export const copyTextToClipboard = (text) => {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(() => execCommandCopy(text));
  }
  execCommandCopy(text);
  return Promise.resolve();
};

export const issueWsTicket = async (path) => {
  try {
    const res = await fetch('/api/ws-ticket', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(7000)
        : undefined,
    });
    if (res.status === 401 || res.status === 403) {
      window.dispatchEvent(new CustomEvent('auth:session-expired'));
      return { ticket: null, authExpired: true };
    }
    if (!res.ok) return { ticket: null, authExpired: false };
    const data = await res.json();
    return { ticket: data?.ticket || null, authExpired: false };
  } catch {
    return { ticket: null, authExpired: false };
  }
};
