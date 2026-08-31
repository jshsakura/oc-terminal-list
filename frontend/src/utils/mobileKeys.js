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
   /* 빠른입력(cmdInput)이 **다시 맨 앞이다.** 한때 뺐었다 — 입력창이 하단 상시 도크로
      깔리니 그걸 여는 버튼은 할 일이 없다고 봤다. 그 도크를 되돌리면서(폰에서 키보드가
      올라왔다 닫히기를 반복했다) 이 버튼이 **모바일에서 입력하는 유일한 길**로 돌아왔다.

      ⚠️ 도크를 다시 켜더라도 이 버튼을 또 빼지 말 것. 빼는 순간 도크가 안 뜨는 자리
      (빈 pane · VNC · 2FA 프롬프트)에서는 입력할 방법이 아예 사라진다. */
   { id: 'cmd',   kind: 'cmdInput', tone: 'accent' },
   { id: 'sep1',  kind: 'sep' },
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

  /* herdr (멀티플렉서) — prefix 키.
   *
   * ⚠️ **payload 가 `^B` 하나가 아니라 `^B ^B` 로 시작하는 이유**: 이 앱의 pane 은 언제나
   * tmux 클라이언트 안이고, tmux 기본 프리픽스도 `C-b` 다. 그래서 `\x02` 를 그냥 보내면
   * **바깥 tmux 가 먹고 herdr 까지 가지 않는다.** tmux 의 `bind-key -T prefix C-b
   * send-prefix`(기본값)를 태워 리터럴 `\x02` 를 안쪽으로 통과시켜야 한다.
   * 이 실수는 조용하다 — 키를 눌러도 아무 일이 안 일어날 뿐이라 herdr 설정을 의심하게 된다.
   *
   * herdr 쪽에서 prefix 를 다른 키로 바꿨다면 이 프리셋들은 안 맞는다(그때는 커스텀 키로).
   * 키 목록 출처: herdr 기본 keybindings(prefix = ctrl+b). */
  { label: 'H·c', payload: '\x02\x02c' },   // 새 탭
  { label: 'H·v', payload: '\x02\x02v' },   // 세로 분할
  { label: 'H·−', payload: '\x02\x02-' },   // 가로 분할
  { label: 'H·h', payload: '\x02\x02h', tone: 'muted' },  // pane ←
  { label: 'H·j', payload: '\x02\x02j', tone: 'muted' },  // pane ↓
  { label: 'H·k', payload: '\x02\x02k', tone: 'muted' },  // pane ↑
  { label: 'H·l', payload: '\x02\x02l', tone: 'muted' },  // pane →
  { label: 'H·p', payload: '\x02\x02p', tone: 'muted' },  // 이전 탭
  { label: 'H·n', payload: '\x02\x02n', tone: 'muted' },  // 다음 탭
  { label: 'H·z', payload: '\x02\x02z' },   // 줌 토글
  { label: 'H·w', payload: '\x02\x02w' },   // 워크스페이스
  { label: 'H·?', payload: '\x02\x02?' },   // 단축키 도움말
  { label: 'H·q', payload: '\x02\x02q', tone: 'danger' }, // detach

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
  /* ⚠️ 한때 여기서 'cmdInput' 을 **걷어냈다**(도크가 상시 노출이던 시절). 그 도크를
     되돌린 지금 그대로 두면, 그 사이에 설정이 한 번이라도 저장된 사용자는 저장된
     배열에 버튼이 없고 sanitize 가 다시 넣어 주지도 않아 **입력할 방법이 영영 없다.**
     그래서 없으면 맨 앞에 되돌려 준다.

     지우고 싶은 사용자를 막지는 않는다 — 편집기에서 지운 배열은 그대로 저장된다.
     여기서 채우는 것은 "한 번도 고른 적 없는" 자리뿐이라고 보기 어려우므로, 되살리는
     쪽을 택한다: 없어서 못 쓰는 것보다 있는데 안 쓰는 편이 낫다. */
  let cleaned = keys.filter(isValidKey);
  /* 맨 앞/끝 구분자는 **아무것도 나누지 않는다.** 저장된 설정에 그대로 남아 있으므로
     양쪽을 걷어낸다. ⚠️ **버튼을 되돌리기 전에** 해야 한다 — 뒤에 하면 되돌린 버튼이
     맨 앞을 차지해 그 뒤의 홀로 남은 선이 "가운데 구분자" 로 보여 영영 안 걷힌다. */
  while (cleaned.length && cleaned[0].kind === 'sep') cleaned = cleaned.slice(1);
  while (cleaned.length && cleaned[cleaned.length - 1].kind === 'sep') cleaned = cleaned.slice(0, -1);
  if (!cleaned.length) return DEFAULT_MOBILE_KEYS;
  if (!cleaned.some((k) => k.kind === 'cmdInput')) {
    cleaned = [{ id: 'cmd', kind: 'cmdInput', tone: 'accent' }, ...cleaned];
  }
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
