import { HERDR, TMUX, normalize as normalizeMux } from './multiplexer';

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

/** 프리픽스는 **하나**다 — 그 팬에서 도는 멀티플렉서에게 바로 간다. */
const PREFIX = '\x02';   // ctrl+b — tmux 와 herdr 의 기본 프리픽스가 같다

/* herdr 프리픽스 키.
 *
 * ⚠️ **한때 `^B^B` 였고, 지금은 아니다.** 그 이중 프리픽스는 "이 앱의 pane 은 언제나
 * tmux 클라이언트 안" 이라는 전제 위에 있었다 — 바깥 tmux 가 `\x02` 를 먹으니
 * `send-prefix` 를 태워야 했다. 그 전제가 사라졌다: 지금은 고른 멀티플렉서 **하나만**
 * 깔고(backend/local_mux.js 의 짝인 local_mux.py), herdr 를 고르면 팬이 herdr 를 직접
 * 실행한다. 바깥 tmux 가 없으므로 프리픽스를 두 번 보내면 herdr 가 두 번째를 명령 키로
 * 읽어 **아무 일도 안 일어난다.**
 *
 * ⚠️ 손으로 tmux 안에서 herdr 를 띄운 경우(전환기 잔존 세션이 그렇다)에는 여전히 이중
 * 프리픽스가 필요하다. 그건 앱이 만드는 모양이 아니므로 커스텀 키로 둔다.
 *
 * 키 출처: `herdr --default-config` 의 `[keys]` 기본값. */
export const HERDR_KEYS = [
  { label: 'H·c', payload: `${PREFIX}c` },   // new_tab
  { label: 'H·v', payload: `${PREFIX}v` },   // split_vertical
  { label: 'H·−', payload: `${PREFIX}-` },   // split_horizontal (prefix+minus)
  { label: 'H·h', payload: `${PREFIX}h`, tone: 'muted' },  // focus_pane_left
  { label: 'H·j', payload: `${PREFIX}j`, tone: 'muted' },  // focus_pane_down
  { label: 'H·k', payload: `${PREFIX}k`, tone: 'muted' },  // focus_pane_up
  { label: 'H·l', payload: `${PREFIX}l`, tone: 'muted' },  // focus_pane_right
  { label: 'H·p', payload: `${PREFIX}p`, tone: 'muted' },  // previous_tab
  { label: 'H·n', payload: `${PREFIX}n`, tone: 'muted' },  // next_tab
  { label: 'H·z', payload: `${PREFIX}z` },   // zoom
  { label: 'H·b', payload: `${PREFIX}b` },   // toggle_sidebar
  { label: 'H·w', payload: `${PREFIX}w` },   // workspace_picker
  { label: 'H·x', payload: `${PREFIX}x`, tone: 'danger' },  // close_pane
  { label: 'H·?', payload: `${PREFIX}?` },   // help
  { label: 'H·q', payload: `${PREFIX}q`, tone: 'danger' },  // detach
];

/* tmux 프리픽스 키 — herdr 와 **같은 자리, 다른 글자**다.
 * 두 목록이 나란히 있어야 "왜 이 키는 저기 없나" 를 눈으로 답할 수 있다. */
export const TMUX_KEYS = [
  { label: 'T·c', payload: `${PREFIX}c` },   // 새 윈도우
  { label: 'T·%', payload: `${PREFIX}%` },   // 세로 분할
  { label: 'T·"', payload: `${PREFIX}"` },   // 가로 분할
  { label: 'T·o', payload: `${PREFIX}o`, tone: 'muted' },  // 다음 pane
  { label: 'T·p', payload: `${PREFIX}p`, tone: 'muted' },  // 이전 윈도우
  { label: 'T·n', payload: `${PREFIX}n`, tone: 'muted' },  // 다음 윈도우
  { label: 'T·z', payload: `${PREFIX}z` },   // 줌 토글
  { label: 'T·[', payload: `${PREFIX}[` },   // copy-mode (스크롤)
  { label: 'T·x', payload: `${PREFIX}x`, tone: 'danger' },  // pane 종료
  { label: 'T·d', payload: `${PREFIX}d`, tone: 'danger' },  // detach
];


/** 우리가 심은 멀티플렉서 키는 id 로 알아본다 — 사용자가 프리셋에서 손수 넣은 것과 구별. */
const MUX_KEY_PREFIX = 'mux_';

/** 그 묶음 앞의 구분자. **키와 함께 걷어야 한다** — 안 그러면 `none` 으로 바꿨을 때
 *  가리킬 것이 없는 구분자만 덩그러니 남는다(테스트가 잡은 실제 결함). */
const MUX_SEP_ID = 'sep_mux';

/* 퀵바에 **기본으로** 실리는 멀티플렉서 키. 전부 싣지 않는다 — 바가 길어지면 정작 자주
   쓰는 것이 스크롤 뒤로 밀린다. 나머지는 설정의 프리셋에서 골라 넣는다.

   ⚠️ 무엇을 싣느냐가 **고른 멀티플렉서를 따라간다.** 안 그러면 tmux 사용자의 바에
   herdr 키가 남아 눌러도 아무 일이 없는데, 그 실패는 조용하다(이 파일이 이미 이중
   프리픽스로 한 번 겪은 그 조용함이다). `none` 은 프리픽스라는 개념이 없어 비운다. */
const DEFAULT_MUX_LABELS = {
  [HERDR]: ['H·c', 'H·v', 'H·−', 'H·z', 'H·b', 'H·n'],
  [TMUX]: ['T·c', 'T·%', 'T·"', 'T·z', 'T·o', 'T·n'],
};

/** 이 멀티플렉서의 기본 등록 키들. 모르는 값이면 빈 배열. */
export const muxKeysFor = (multiplexer) => {
  const mux = normalizeMux(multiplexer);
  const source = mux === HERDR ? HERDR_KEYS : mux === TMUX ? TMUX_KEYS : [];
  return (DEFAULT_MUX_LABELS[mux] || [])
    .map((label) => source.find((k) => k.label === label))
    .filter(Boolean)
    .map((k) => ({ id: `${MUX_KEY_PREFIX}${k.label}`, kind: 'send', ...k }));
};

/** 기본 퀵바 = 공통 키 + 고른 멀티플렉서의 프리픽스 키. */
export const mobileKeysFor = (multiplexer) => {
  const muxKeys = muxKeysFor(multiplexer);
  if (!muxKeys.length) return DEFAULT_MOBILE_KEYS;
  return [...DEFAULT_MOBILE_KEYS, { id: MUX_SEP_ID, kind: 'sep' }, ...muxKeys];
};


/**
 * 이미 저장된 바에 **고른 멀티플렉서의 키를 맞춰 넣는다.**
 *
 * 왜 필요한가: `mobileKeys` 는 첫 실행에 저장되므로, 기본값만 바꾸면 **기존 사용자에게는
 * 영영 안 나온다.** 그렇다고 초기화로 밀면 사용자가 손본 배열이 날아간다.
 *
 * 규칙:
 *  - 우리가 심은 것(`mux_` id)만 걷어내고 다시 넣는다. 사용자가 프리셋에서 손수 넣은
 *    키는 id 가 다르므로 **건드리지 않는다.**
 *  - `seededFor` 가 지금 멀티플렉서와 같으면 **아무것도 안 한다** — 심어준 뒤에 사용자가
 *    지웠다면 지운 대로 두어야 한다. 매번 되살리면 지울 방법이 없어진다.
 *  - 멀티플렉서를 바꾸면 옛 키를 걷고 새 키를 넣는다. 안 그러면 tmux 로 옮긴 바에
 *    herdr 키가 남아 눌러도 아무 일이 없다(그 실패는 조용하다).
 *
 * @returns {{keys: Array, seededFor: string}} 바뀐 게 없으면 `keys` 는 같은 참조다.
 */
export const syncMuxKeys = (keys, multiplexer, seededFor = null) => {
  const mux = normalizeMux(multiplexer);
  if (!Array.isArray(keys) || seededFor === mux) return { keys, seededFor };
  const kept = keys.filter((k) => {
    const id = String(k?.id || '');
    return id !== MUX_SEP_ID && !id.startsWith(MUX_KEY_PREFIX);
  });
  const muxKeys = muxKeysFor(mux);
  if (!muxKeys.length) return { keys: kept, seededFor: mux };
  return {
    keys: [...kept, { id: MUX_SEP_ID, kind: 'sep' }, ...muxKeys],
    seededFor: mux,
  };
};

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

  ...HERDR_KEYS,
  ...TMUX_KEYS,

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
