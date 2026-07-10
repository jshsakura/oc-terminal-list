// 터미널별 명령 히스토리 — 서버(SQLite)에 영속, 디바이스 간 공유.
// 네트워크 절체/오프라인 복구용으로 클라이언트 localStorage 에도 최근 5개만 작게 보관한다.
// 서버의 30일 retention 은 백엔드 startup cleanup 이 담당한다.
//
// 동작:
//  - pushCommand: localStorage 저장 후 비동기 fire-and-forget POST.
//  - pushLocalCommand: 서버에는 보내지 않고 로컬 복구 슬롯에만 저장.
//  - fetchPage: 첫 페이지는 로컬 5개 + 서버 GET 결과 병합, 이후 페이지는 서버 cursor 페이징.
//  - removeCommand / clearCommandsFor: localStorage + 서버 DELETE.
//
// 호출 측이 인증 토큰(localStorage.auth_token)을 자동으로 Authorization 헤더에 실어야 한다 — authFetch.

const EVENT = 'iterm:commandHistory:updated';
const MAX_LENGTH = 500;
const PAGE_SIZE = 20;
const LOCAL_STORAGE_PREFIX = 'iterm:commandHistory:local:v1:';
const LOCAL_LIMIT = 5;
const LOCAL_MAX_LENGTH = 32768;

const cleanCommandText = (raw) => {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/^\x1b\[200~/, '')
    .replace(/\x1b\[201~$/, '')
    .replace(/[\r\n]+$/g, '')
    .trim();
};

// — 텍스트 필터 (push 직전 1차 방어). 백엔드가 다시 검증한다.
const looksLikeCommand = (text) => {
  if (!text) return false;
  if (text.length > MAX_LENGTH) return false;
  return looksLikeLocalCommand(text);
};

const looksLikeLocalCommand = (text) => {
  if (!text) return false;
  if (text.length > LOCAL_MAX_LENGTH) return false;
  if (!/\S/.test(text)) return false;
  if (text.charCodeAt(0) === 0x1b) return false; // ANSI escape
  let printable = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0x20 && c !== 0x7f) printable += 1;
  }
  return printable / text.length >= 0.5;
};

const localStorageKey = (terminalKey) => `${LOCAL_STORAGE_PREFIX}${encodeURIComponent(terminalKey)}`;

const readLocalCommands = (terminalKey) => {
  if (!terminalKey || typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(localStorageKey(terminalKey)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.text === 'string' && Number.isFinite(Number(item.ts)))
      .map((item) => ({ text: item.text, ts: Number(item.ts), source: 'local' }))
      .filter((item) => looksLikeLocalCommand(item.text))
      .slice(0, LOCAL_LIMIT);
  } catch {
    return [];
  }
};

const writeLocalCommands = (terminalKey, items) => {
  if (!terminalKey || typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(
      localStorageKey(terminalKey),
      JSON.stringify(items.slice(0, LOCAL_LIMIT).map(({ text, ts }) => ({ text, ts }))),
    );
    return true;
  } catch {
    return false;
  }
};

const saveLocalCommand = (terminalKey, raw) => {
  const cleaned = cleanCommandText(raw);
  if (!terminalKey || !looksLikeLocalCommand(cleaned)) return false;
  const now = Date.now();
  const rest = readLocalCommands(terminalKey).filter((item) => item.text !== cleaned);
  return writeLocalCommands(terminalKey, [{ text: cleaned, ts: now, source: 'local' }, ...rest]);
};

const removeLocalCommand = (terminalKey, text) => {
  if (!terminalKey || !text) return false;
  const cleaned = cleanCommandText(text);
  const next = readLocalCommands(terminalKey).filter((item) => item.text !== cleaned);
  return writeLocalCommands(terminalKey, next);
};

const clearLocalCommands = (terminalKey) => {
  if (!terminalKey || typeof localStorage === 'undefined') return false;
  try {
    localStorage.removeItem(localStorageKey(terminalKey));
    return true;
  } catch {
    return false;
  }
};

const mergeLocalFirstPage = (serverItems, localItems) => {
  const merged = new Map();
  for (const item of [...serverItems, ...localItems]) {
    if (!item?.text) continue;
    const ts = Number(item.ts) || 0;
    const prev = merged.get(item.text);
    if (!prev || ts > prev.ts) merged.set(item.text, { text: item.text, ts, source: item.source });
  }
  return [...merged.values()].sort((a, b) => b.ts - a.ts);
};

const authHeaders = () => {
  if (typeof localStorage === 'undefined') return {};
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const dispatchUpdate = (terminalKey) => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { terminalKey } }));
  } catch { /* noop */ }
};

// 같은 텍스트를 짧은 시간에 여러 번 push 하면 서버에 의미 없는 요청이 쌓이므로
// 가장 최근 push 만 기억해서 중복 차단. 키는 (terminalKey, text).
// (서버는 어차피 UPSERT 라 결과 동일하지만 네트워크 절약.)
const recentPushes = new Map();
const recentPushKey = (terminalKey, text) => `${terminalKey}\u0000${text}`;
const RECENT_PUSH_WINDOW_MS = 1500;

export const pushCommand = (terminalKey, raw) => {
  if (!terminalKey || typeof raw !== 'string') return;
  const cleaned = cleanCommandText(raw);
  const savedLocal = saveLocalCommand(terminalKey, cleaned);
  if (savedLocal) dispatchUpdate(terminalKey);
  if (!looksLikeCommand(cleaned)) return;

  const dedupKey = recentPushKey(terminalKey, cleaned);
  const now = Date.now();
  const last = recentPushes.get(dedupKey) || 0;
  if (now - last < RECENT_PUSH_WINDOW_MS) return;
  recentPushes.set(dedupKey, now);
  // 메모리 누수 방지 — 100개 넘어가면 오래된 절반 정리.
  if (recentPushes.size > 100) {
    const cutoff = now - RECENT_PUSH_WINDOW_MS;
    for (const [k, ts] of recentPushes) {
      if (ts < cutoff) recentPushes.delete(k);
    }
  }

  fetch('/api/command-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ terminal_key: terminalKey, text: cleaned }),
  }).then((res) => {
    if (res.ok) dispatchUpdate(terminalKey);
  }).catch(() => { /* 네트워크 실패해도 입력은 진행 */ });
};

export const pushLocalCommand = (terminalKey, raw) => {
  if (saveLocalCommand(terminalKey, raw)) dispatchUpdate(terminalKey);
};

export const fetchPage = async (terminalKey, { before = null, limit = PAGE_SIZE } = {}) => {
  if (!terminalKey) return { items: [], hasMore: false };
  const localItems = before == null ? readLocalCommands(terminalKey) : [];
  const params = new URLSearchParams();
  params.set('terminal', terminalKey);
  params.set('limit', String(limit));
  if (before != null) params.set('before', String(before));
  try {
    const res = await fetch(`/api/command-history?${params.toString()}`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) {
      return { items: localItems, hasMore: false };
    }
    const data = await res.json();
    const serverItems = Array.isArray(data?.items) ? data.items : [];
    return {
      items: before == null ? mergeLocalFirstPage(serverItems, localItems) : serverItems,
      hasMore: !!data?.hasMore,
    };
  } catch {
    return { items: localItems, hasMore: false };
  }
};

export const removeCommand = async (terminalKey, text) => {
  if (!terminalKey || !text) return;
  removeLocalCommand(terminalKey, text);
  const params = new URLSearchParams();
  params.set('terminal', terminalKey);
  params.set('text', text);
  try {
    await fetch(`/api/command-history?${params.toString()}`, {
      method: 'DELETE',
      headers: { ...authHeaders() },
    });
  } catch { /* noop */ }
  dispatchUpdate(terminalKey);
};

export const clearCommandsFor = async (terminalKey) => {
  if (!terminalKey) return;
  clearLocalCommands(terminalKey);
  const params = new URLSearchParams();
  params.set('terminal', terminalKey);
  try {
    await fetch(`/api/command-history?${params.toString()}`, {
      method: 'DELETE',
      headers: { ...authHeaders() },
    });
  } catch { /* noop */ }
  dispatchUpdate(terminalKey);
};

/**
 * 이 기기에 남은 모든 터미널의 로컬 복구 슬롯을 지운다 (서버 이력은 건드리지 않는다).
 *
 * 명시적 로그아웃 전용 — 명령에는 비밀번호가 섞일 수 있는데, 공용 PC 에서 로그아웃해도
 * 다음 사용자가 localStorage 에서 그대로 읽을 수 있었다.
 * 세션 만료(auth:session-expired)에는 부르지 않는다. 자리를 비웠다 돌아와 재로그인하는
 * 흐름에서 작업 맥락까지 날리지 않기 위해서다.
 */
export const clearAllLocalCommands = () => {
  if (typeof localStorage === 'undefined') return;
  try {
    // 순회 중 removeItem 하면 인덱스가 밀리므로 키를 먼저 모은다.
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(LOCAL_STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch { /* private mode — 지울 게 없다 */ }
};

export const COMMAND_HISTORY_EVENT = EVENT;
export const COMMAND_HISTORY_PAGE_SIZE = PAGE_SIZE;
