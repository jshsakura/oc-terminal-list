
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
   /* 폰의 바는 **짧다.** 스크롤 뒤로 밀린 키는 없는 키다 — 그래서 기본에는 "이게 없으면
      아예 못 하는 것" 만 둔다. 한때 줄편집(^A ^E ^W)·세션(^R ^L ^D ^Z)·PgUp/PgDn·ALT 까지
      전부 실었다가 "쓸데없는 키가 많다" 로 되돌린 자리다. 전부 설정 프리셋에 있으므로
      쓰는 사람이 골라 넣는다 — 고른 사람의 바에만 있는 것이 맞다.

      ⚠️ 여기에 키를 더하기 전에 "이게 없으면 폰에서 무엇을 못 하나" 를 먼저 답할 것.
      CTRL 토글이 있으므로 나머지 컨트롤 조합은 소프트 키보드 글자와 조합해 낼 수 있다. */

   /* 빠른입력(cmdInput)이 **맨 앞이다.** 한때 뺐었다 — 입력창이 하단 상시 도크로 깔리니
      그걸 여는 버튼은 할 일이 없다고 봤다. 그 도크를 되돌리면서 이 버튼이 **모바일에서
      입력하는 유일한 길**로 돌아왔다.

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
   /* ⚠️ **엔터와 지우기는 기본에 있어야 한다.** 오래 빠져 있었다 — 소프트 키보드로 칠
      때는 거기 있으니 안 아쉬운데, 퀵바만으로 다루면 **줄을 끝낼 수도 고칠 수도 없다.**
      길게 누르면 연타된다(`utils/keyRepeat`). 반복은 `kind: 'send'` 에만 붙는다. */
   { id: 'enter', kind: 'send', label: '⏎', payload: '\r' },
   { id: 'bs',    kind: 'send', label: '⌫', payload: '\x7f' },
   { id: 'sep3',  kind: 'sep' },
   /* 조합키는 **둘만** 남긴다. 나머지(^A ^E ^U ^W ^R ^L ^D ^Z, ALT)는 프리셋으로 내렸다.
      - `^C` 는 소프트 키보드를 안 열고 작업을 중단하는 **유일한** 길이다. 바에 알파벳
        키가 없으므로 CTRL 토글로는 못 만든다.
      - `CTRL` 토글은 그 나머지 조합을 만드는 **유일한** 길이다(+ 소프트 키보드 글자).
      둘 중 하나라도 빼면 폰에서 못 하게 되는 일이 생긴다 — 그래서 여기까지다. */
   { id: 'ctrlc', kind: 'send', label: '^C', payload: '\x03', tone: 'danger' },
   { id: 'ctrl',  kind: 'mod', label: 'CTRL' },
   { id: 'sep4',  kind: 'sep' },
   { id: 'copy',  kind: 'copy' },
   { id: 'paste', kind: 'paste' },
];

/** 프리픽스는 **하나**다 — 그 팬에서 도는 멀티플렉서에게 바로 간다. */
const PREFIX = '\x02';   // ctrl+b — tmux 와 herdr 의 기본 프리픽스가 같다

/* tmux 프리픽스 키.
 *
 * ⚠️ **프리픽스는 하나다(`\x02`).** 한때 `\x02\x02` 였고, 그 근거는 "이 앱의 pane 은
 * 언제나 tmux 클라이언트 안" 이었다. 지금은 팬을 tmux 가 잡을 수도 herdr 가 잡을 수도
 * 있고(backend/local_mux.py), 어느 쪽이든 바깥에 또 하나가 깔려 있지 않다 — 이중으로
 * 보내면 안쪽이 두 번째를 명령 키로 읽어 아무 일도 안 일어난다.
 *
 * ⚠️ **herdr 프리픽스 키는 걷어냈다.** herdr 도 `C-b` 라 같은 바이트지만 뒤 글자가 달라
 * (`H·c` 는 new_tab, `T·c` 는 새 윈도우) 섞어 두면 눌러도 아무 일이 없는 키가 바에
 * 남는다 — 그 실패는 조용하다. 필요하면 커스텀 키로 넣는다(임의 바이트열을 보낼 수 있다).
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

/* ⚠️ **멀티플렉서 키는 기본으로 싣지 않는다.**
 *
 * 한때 tmux 프리픽스 키 여섯 개(`T·c` `T·%` `T·"` `T·z` `T·o` `T·n`)를 심었다. 이유는
 * "이 앱의 팬은 대개 tmux 안이니 새 윈도우·분할이 손에 닿아야 한다" 였는데, 실제로는
 * **바에서 가장 자주 쓰는 것들을 스크롤 뒤로 밀어냈다.** 폰의 바는 짧고, 거기 있어야
 * 하는 것은 엔터·화살표·^C 다. 새 윈도우를 여는 일은 앱의 탭 UI 가 이미 한다.
 *
 * 필요하면 설정의 프리셋에서 골라 넣는다(`KEY_PRESETS` 에 그대로 있다) — 고른 사람의
 * 바에만 있는 것이 맞다. `TMUX_KEYS` 를 남겨 두는 것은 그 프리셋을 위해서다. */

/** 기본 퀵바. 멀티플렉서와 무관하다 — 인자는 옛 호출부 호환으로만 받는다. */
export const mobileKeysFor = () => DEFAULT_MOBILE_KEYS;


/** 이 판본까지 정리했다는 표시. 값이 바뀌면 저장된 바를 한 번 더 훑는다. */
export const MOBILE_KEYS_REVISION = 'v3-lean';

/** 예전에 **우리가 기본으로 심었던** 키들. 지금 기준으로는 바를 길게만 만든다.
 *  프리셋에 그대로 있으므로 쓰는 사람은 다시 넣을 수 있다. */
const RETIRED_IDS = new Set([
  'ctrla', 'ctrle', 'ctrlu', 'ctrlw',   // 줄 편집 — 조합키는 ^C·CTRL 만 남긴다
  'ctrlr', 'ctrll', 'ctrld', 'ctrlz',   // 세션·히스토리
  'pgup', 'pgdn',                       // 터치로 스크롤된다
  'alt',                                // CTRL 만으로 충분하다
  'sep_line', 'sep_ses', 'sep_pg', 'sep5',  // 위 묶음들의 구분자
]);

/**
 * 저장된 바를 지금 규칙에 맞게 **한 번** 정리한다.
 *
 * 왜 필요한가: `mobileKeys` 는 첫 실행에 저장되므로 기본값만 바꾸면 **기존 사용자에게는
 * 영영 반영되지 않는다.** 그렇다고 초기화로 밀면 손본 배열이 날아간다.
 *
 * 하는 일 둘:
 *  - 우리가 심었던 멀티플렉서 키(`mux_` id)와 그 앞 구분자를 걷어낸다. 사용자가 프리셋
 *    에서 손수 넣은 키는 id 가 다르므로 **건드리지 않는다.**
 *  - 엔터가 없으면 TAB 뒤에 넣는다.
 *
 * ⚠️ **한 번만이다.** `revision` 이 지금 판본이면 아무것도 안 한다 — 정리한 뒤에 사용자가
 * 지웠다면 지운 대로 두어야 한다. 매번 되살리면 지울 방법이 없어진다(그게 옛 심기 로직이
 * 남긴 실제 불만이었다).
 *
 * @returns {{keys: Array, seededFor: string}} 바뀐 게 없으면 `keys` 는 같은 참조다.
 */
export const migrateMobileKeys = (keys, revision = null) => {
  if (!Array.isArray(keys)) return { keys, seededFor: revision };
  if (revision === MOBILE_KEYS_REVISION) return { keys, seededFor: revision };

  const stripped = keys.filter((k) => {
    const id = String(k?.id || '');
    if (id === MUX_SEP_ID || id.startsWith(MUX_KEY_PREFIX)) return false;
    return !RETIRED_IDS.has(id);
  });

  // TAB 뒤에 ⏎, ⌫ 순서로 — 없는 것만 넣는다.
  let next = stripped;
  for (const id of ['enter', 'bs']) {
    if (next.some((k) => k?.id === id)) continue;
    const key = DEFAULT_MOBILE_KEYS.find((k) => k.id === id);
    if (!key) continue;
    const after = next.findIndex((k) => k?.id === (id === 'enter' ? 'tab' : 'enter'));
    next = after >= 0
      ? [...next.slice(0, after + 1), { ...key }, ...next.slice(after + 1)]
      : [...next, { ...key }];
  }

  /* ⚠️ 묶음을 통째로 걷어내면 **아무것도 안 나누는 선**이 연달아 남는다. sanitize 는
     맨 앞/뒤만 걷으므로 가운데 중복은 여기서 접어야 한다. */
  next = next.filter((k, i) => !(k?.kind === 'sep' && next[i - 1]?.kind === 'sep'));

  const changed = next.length !== keys.length;
  return { keys: changed ? next : keys, seededFor: MOBILE_KEYS_REVISION };
};

/** 옛 이름 — 호출부가 아직 이걸 부른다. 하는 일은 위와 같다. */
export const syncMuxKeys = (keys, _multiplexer, revision = null) => (
  migrateMobileKeys(keys, revision)
);

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
