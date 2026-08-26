/**
 * 모바일 하단 툴바 키 정의 + 디폴트.
 *
 * 데이터 모델: { id, kind, icon?, label?, payload?, modifier?, tone? }
 *  - kind: 'send' | 'mod' | 'cmdInput' | 'paste' | 'copy' | 'copyAll' | 'sep'
 *  - icon: HOST_ICON_OPTIONS key (lucide) 또는 emoji. 비어있으면 kind 별 기본 아이콘 사용.
 *  - label: 화면 표시 텍스트. icon 과 같이 쓸 수 있음 (둘 다 가능, 택일 X).
 *  - payload: kind=send 일 때 PTY 로 보낼 raw bytes/string
 *  - modifier: kind=mod 일 때 'ctrl' | 'alt' (모디파이어 토글, 다음 send 키에 적용)
 *  - tone: 'danger' | 'muted' | 'accent' (시각 강조)
 *
 * 사용자가 Settings 에서 자유롭게 추가/삭제/순서 변경. 항상 최소 1개 이상 유지.
 */
export const DEFAULT_MOBILE_KEYS = [
   /* 'cmdInput'(빠른입력 열기)은 뺐다 — 모바일에서 입력창이 **하단에 상시 도크**로
      깔리므로 그걸 여는 버튼은 할 일이 없다. kind 자체는 남겨둔다: 예전 설정을 그대로
      들고 있는 사용자의 배열이 통째로 무효가 되면 안 되고, 지우는 것은 sanitize 가 한다. */
   { id: 'left',  kind: 'send', label: '←', payload: '\x1b[D' },
   { id: 'up',    kind: 'send', label: '↑', payload: '\x1b[A' },
   { id: 'down',  kind: 'send', label: '↓', payload: '\x1b[B' },
   { id: 'right', kind: 'send', label: '→', payload: '\x1b[C' },
   { id: 'sep2',  kind: 'sep' },
   { id: 'esc',   kind: 'send', label: 'ESC', payload: '\x1b' },
   { id: 'tab',   kind: 'send', label: 'TAB', payload: '\t' },
   // ^C 는 터미널 작업 중단(SIGINT) 의 표준 단축키 — CTRL 토글 + 'c' 입력은 모바일에 별도
   // 알파벳 키가 없어 실제로 못 보내므로 디폴트 툴바에 직접 박아 둔다.
    { id: 'ctrlc', kind: 'send', label: '^C', payload: '\x03', tone: 'danger' },
    // 줄 편집 — bash readline 단축키. 모바일에서 커서 옮기기/지우기가 손이 많이 가므로
    // 기본 툴바에 둔다. payload/tone 은 KEY_PRESETS 의 값을 그대로 쓴다.
    { id: 'sep_line', kind: 'sep' },
    { id: 'ctrla', kind: 'send', label: '^A', payload: '\x01', tone: 'muted' },  // 줄 시작
    { id: 'ctrle', kind: 'send', label: '^E', payload: '\x05', tone: 'muted' },  // 줄 끝
    { id: 'ctrlu', kind: 'send', label: '^U', payload: '\x15', tone: 'muted' },  // 줄 전체 삭제
    { id: 'ctrlw', kind: 'send', label: '^W', payload: '\x17', tone: 'muted' },  // 단어 삭제
    // 세션 / 히스토리
    { id: 'sep_ses', kind: 'sep' },
    { id: 'ctrlr', kind: 'send', label: '^R', payload: '\x12', tone: 'muted' },  // 히스토리 검색
    { id: 'ctrll', kind: 'send', label: '^L', payload: '\x0c', tone: 'muted' },  // clear
    { id: 'ctrld', kind: 'send', label: '^D', payload: '\x04', tone: 'muted' },  // EOF
    { id: 'ctrlz', kind: 'send', label: '^Z', payload: '\x1a', tone: 'muted' },  // SIGTSTP
    { id: 'sep_pg', kind: 'sep' },
   { id: 'pgup',  kind: 'send', label: 'PgUp', payload: '\x1b[5~' },
   { id: 'pgdn',  kind: 'send', label: 'PgDn', payload: '\x1b[6~' },
   { id: 'sep3',  kind: 'sep' },
   { id: 'ctrl',  kind: 'mod',  label: 'CTRL', modifier: 'ctrl' },
   { id: 'alt',   kind: 'mod',  label: 'ALT',  modifier: 'alt' },
   { id: 'sep4',  kind: 'sep' },
   { id: 'copy',  kind: 'copy', tone: 'accent' },
   { id: 'paste', kind: 'paste' },
];

// "추가" 프리셋 — Settings 의 "Add key" 메뉴에서 빠르게 선택. 사용자는 Custom (label+payload) 도 가능.
// kind 가 'sep' 면 구분자 (payload 없음), 명시 안 하면 'send' 로 추가.
export const KEY_PRESETS = [
  // 시스템/복사
  { label: 'Copy', kind: 'copy', tone: 'accent' },
  { label: 'Copy All', kind: 'copyAll', tone: 'accent' },
  { label: 'Paste', kind: 'paste' },
  { label: '│', kind: 'sep', tone: 'muted' },

  // 이동 / 화살표
  { label: '←', payload: '\x1b[D' },
  { label: '↑', payload: '\x1b[A' },
  { label: '↓', payload: '\x1b[B' },
  { label: '→', payload: '\x1b[C' },
  { label: 'Home', payload: '\x1b[H' },
  { label: 'End',  payload: '\x1b[F' },
  { label: 'PgUp', payload: '\x1b[5~' },
  { label: 'PgDn', payload: '\x1b[6~' },
  { label: 'Ins',  payload: '\x1b[2~' },

  // 특수
  { label: 'ESC', payload: '\x1b' },
  { label: 'TAB', payload: '\t' },
  { label: 'Shift+Tab', payload: '\x1b[Z' },
  { label: 'Enter', payload: '\r' },
  { label: 'Space', payload: ' ' },
  { label: 'Shift+Enter', payload: '\n' },
  { label: 'Del',   payload: '\x1b[3~' },
  { label: '⌫',    payload: '\x7f' },
  { label: 'Ctrl+Space', payload: '\x00', tone: 'muted' },

  // Bash 라인 편집 (Ctrl)
  { label: '^A', payload: '\x01', tone: 'muted' },  // 줄 시작
  { label: '^E', payload: '\x05', tone: 'muted' },  // 줄 끝
  { label: '^B', payload: '\x02', tone: 'muted' },  // ← 한 글자
  { label: '^F', payload: '\x06', tone: 'muted' },  // → 한 글자
  { label: '^P', payload: '\x10', tone: 'muted' },  // 이전 히스토리
  { label: '^N', payload: '\x0e', tone: 'muted' },  // 다음 히스토리
  { label: '^K', payload: '\x0b', tone: 'muted' },  // 끝까지 자르기
  { label: '^Y', payload: '\x19', tone: 'muted' },  // 잘라낸 것 붙여넣기
  { label: '^T', payload: '\x14', tone: 'muted' },  // 두 글자 swap
  { label: '^C', payload: '\x03', tone: 'danger' },
  { label: '^D', payload: '\x04', tone: 'muted' },
  { label: '^L', payload: '\x0c', tone: 'muted' },  // clear
  { label: '^R', payload: '\x12', tone: 'muted' },  // history search
  { label: '^U', payload: '\x15', tone: 'muted' },  // 줄 전체 삭제
  { label: '^W', payload: '\x17', tone: 'muted' },  // 단어 삭제
  { label: '^Z', payload: '\x1a', tone: 'muted' },  // SIGTSTP
  { label: '^\\', payload: '\x1c', tone: 'danger' }, // SIGQUIT

  // Alt (단어 단위)
  { label: '⌥B', payload: '\x1bb', tone: 'muted' },   // 단어 ←
  { label: '⌥F', payload: '\x1bf', tone: 'muted' },   // 단어 →
  { label: '⌥D', payload: '\x1bd', tone: 'muted' },   // 단어 삭제
  { label: '⌥.', payload: '\x1b.', tone: 'muted' },   // 마지막 인자

  // Function (F1–F12)
  { label: 'F1', payload: '\x1bOP' },
  { label: 'F2', payload: '\x1bOQ' },
  { label: 'F3', payload: '\x1bOR' },
  { label: 'F4', payload: '\x1bOS' },
  { label: 'F5', payload: '\x1b[15~' },
  { label: 'F6', payload: '\x1b[17~' },
  { label: 'F7', payload: '\x1b[18~' },
  { label: 'F8', payload: '\x1b[19~' },
  { label: 'F9', payload: '\x1b[20~' },
  { label: 'F10', payload: '\x1b[21~' },
  { label: 'F11', payload: '\x1b[23~' },
  { label: 'F12', payload: '\x1b[24~' },

  // 자주 쓰는 텍스트 (prefix — 스페이스 포함)
  { label: 'sudo', payload: 'sudo ' },
  { label: 'cd', payload: 'cd ' },
  { label: 'git', payload: 'git ' },
  { label: 'ls -la', payload: 'ls -la\r' },
  { label: 'clear', payload: 'clear\r' },
];

// 사용자 입력 payload 를 안전하게 해석 — 셸/이스케이프 표기 → 실제 바이트.
// 지원: \\n \\r \\t \\xHH \\eXXX (실제 ESC + ...) 또는 raw 텍스트 그대로.
export const decodeUserPayload = (s) => {
  if (typeof s !== 'string') return '';
  const backslashSentinel = '__ITERM_BACKSLASH__';
  return s
    .replace(/\\\\/g, backslashSentinel)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\e/g, '\x1b')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(new RegExp(backslashSentinel, 'g'), '\\');
};

export const isValidKey = (k) =>
  k && typeof k === 'object'
  && typeof k.id === 'string'
  && ['send', 'mod', 'cmdInput', 'paste', 'copy', 'copyAll', 'sep'].includes(k.kind);

export const sanitizeMobileKeys = (keys) => {
  if (!Array.isArray(keys)) return DEFAULT_MOBILE_KEYS;
  /* 'cmdInput' 은 **걷어낸다.** 예전에는 없으면 강제로 앞에 끼워 넣었는데(지울 수 없었다),
     지금은 입력창이 하단에 상시 도크로 깔려서 그 버튼이 여는 것이 이미 열려 있다.
     저장된 설정에 남아 있어도 여기서 사라지므로 사용자가 따로 지울 필요가 없다. */
  let cleaned = keys.filter(isValidKey).filter((k) => k.kind !== 'cmdInput');
  /* 맨 앞 구분자는 **아무것도 나누지 않는다.** 빠른입력 버튼이 있던 시절에는 그것과 키를
     갈랐지만, 버튼이 사라진 지금은 줄 맨 앞에 선만 하나 서 있게 된다(저장된 설정에
     그대로 남아 있다). 끝에 오는 것도 마찬가지라 양쪽을 다 걷어낸다. */
  while (cleaned.length && cleaned[0].kind === 'sep') cleaned = cleaned.slice(1);
  while (cleaned.length && cleaned[cleaned.length - 1].kind === 'sep') cleaned = cleaned.slice(0, -1);
  if (!cleaned.length) return DEFAULT_MOBILE_KEYS;
  return cleaned;
};

// 툴바를 고정 영역(pinned)과 스크롤 영역(scroll)으로 나눈다.
// 빠른입력(cmdInput)은 항상 고정. 그 바로 뒤 항목이 구분자(sep)면 그 구분자도 함께
// 고정해서 스크롤 경계를 구분자가 지키게 한다 — 키를 옆으로 밀어도 고정 버튼 옆에
// 엉뚱한 키가 붙지 않는다. pinnedKey 뒤가 sep가 아닌 구성에서는 pinnedDivider=null.
export const splitPinnedAndScroll = (list) => {
  const pinnedKey = list.find((k) => k.kind === 'cmdInput') || null;
  let pinnedDivider = null;
  let scrollKeys;
  if (pinnedKey) {
    const pinnedIdx = list.indexOf(pinnedKey);
    const next = list[pinnedIdx + 1];
    if (next && next.kind === 'sep') {
      pinnedDivider = next;
      scrollKeys = list.filter((k) => k !== pinnedKey && k !== pinnedDivider);
    } else {
      scrollKeys = list.filter((k) => k !== pinnedKey);
    }
  } else {
    scrollKeys = list;
  }
  return { pinnedKey, pinnedDivider, scrollKeys };
};
