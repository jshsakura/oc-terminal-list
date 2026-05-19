// 터미널별 명령 히스토리 — terminalKey (= sessionId 또는 pane.id) 로 키잉.
// 한 터미널에 대해 최근 ~10 개만 보존. UI 는 작은 popover 로 노출.
//
// "명령어" 판정 기준은 호출 측이 결정 (pushCommand). 일반적으로:
//  - Quick Input 으로 전송한 텍스트
//  - paste / IME 조합 등 길이 ≥ 2 인 입력
//  - 단일 키스트로크나 escape sequence 는 제외
//
// 저장은 localStorage, 변경은 'iterm:commandHistory:updated' 이벤트로 broadcast (cross-component).

const STORAGE_KEY = 'iterm:commandHistory:v2';
const MAX_PER_TERMINAL = 10;
const MAX_LENGTH = 500;
const EVENT = 'iterm:commandHistory:updated';

const safeReadAll = () => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch { return {}; }
};

const safeWriteAll = (obj) => {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }
  catch { /* quota / 비공개 모드 무시 */ }
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* noop */ }
  }
};

// 컨트롤 문자만 있거나 흔한 escape sequence (ESC 시작) 같은 입력은 필터.
const looksLikeCommand = (text) => {
  if (!text) return false;
  if (text.length > MAX_LENGTH) return false;
  if (!/\S/.test(text)) return false;
  if (text.charCodeAt(0) === 0x1b) return false;
  let printable = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0x20 && c !== 0x7f) printable += 1;
  }
  return printable / text.length >= 0.5;
};

export const pushCommand = (terminalKey, raw) => {
  if (!terminalKey || typeof raw !== 'string') return;
  const cleaned = raw.replace(/[\r\n]+$/g, '').trim();
  if (!looksLikeCommand(cleaned)) return;

  const all = safeReadAll();
  const list = Array.isArray(all[terminalKey]) ? all[terminalKey] : [];
  const top = list[0];
  if (top && top.text === cleaned) {
    list[0] = { text: cleaned, ts: Date.now() };
  } else {
    const dedup = list.filter((e) => e.text !== cleaned);
    dedup.unshift({ text: cleaned, ts: Date.now() });
    all[terminalKey] = dedup.slice(0, MAX_PER_TERMINAL);
    safeWriteAll(all);
    return;
  }
  all[terminalKey] = list.slice(0, MAX_PER_TERMINAL);
  safeWriteAll(all);
};

export const getCommands = (terminalKey) => {
  if (!terminalKey) return [];
  const all = safeReadAll();
  const list = all[terminalKey];
  return Array.isArray(list) ? list : [];
};

export const removeCommand = (terminalKey, text) => {
  if (!terminalKey) return;
  const all = safeReadAll();
  const list = all[terminalKey];
  if (!Array.isArray(list)) return;
  all[terminalKey] = list.filter((e) => e.text !== text);
  safeWriteAll(all);
};

export const clearCommandsFor = (terminalKey) => {
  if (!terminalKey) return;
  const all = safeReadAll();
  delete all[terminalKey];
  safeWriteAll(all);
};

export const COMMAND_HISTORY_EVENT = EVENT;
