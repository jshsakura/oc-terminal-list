/**
 * 터미널 타이틀 → 에이전트 상태.
 *
 * tmux 가 `set-titles on` 으로 pane 타이틀을 OSC 0 으로 흘려주므로, xterm 의
 * `onTitleChange` 만 듣고 있으면 상태를 즉시 안다 — **원격 호스트 pane 도 같은 경로**다.
 * (백엔드 tmux 폴링은 로컬 세션만 볼 수 있어서, 원격 감지는 전적으로 이 경로에 의존한다.)
 *
 * ⚠️  판정 규칙은 backend/agent_status.py 와 반드시 같아야 한다. 두 구현이 갈라지면
 * 같은 pane 이 보는 각도에 따라 다른 상태가 된다. 케이스 표는 한 곳에 있다:
 * `shared/agent-title-cases.json` (양쪽 테스트가 그걸 읽는다).
 *
 * 판정 규칙 출처: stablyai/orca (MIT) src/shared/agent-title-status.ts
 */

export const CLAUDE_IDLE = '✳';
const GEMINI_WORKING = '✦';
const GEMINI_SILENT_WORKING = '⏲';
const GEMINI_IDLE = '◇';
const GEMINI_PERMISSION = '✋';

// 브라유 점자 블록 — 거의 모든 CLI 스피너가 이 범위를 쓴다.
const BRAILLE_RE = /[⠀-⣿]/;
const STATUS_GLYPHS_RE = new RegExp(
  `[${CLAUDE_IDLE}${GEMINI_WORKING}${GEMINI_SILENT_WORKING}${GEMINI_IDLE}${GEMINI_PERMISSION}\\u2800-\\u28FF]`,
  'g',
);

// OSC 타이틀 판정 전용 목록. 의도적으로 좁다 — `amp` 같은 짧은 이름을 넣으면
// "timestamp ready" 같은 평범한 셸 타이틀이 에이전트 활동으로 둔갑한다.
const AGENT_NAMES = [
  'claude', 'openclaude', 'codex', 'copilot', 'cursor', 'gemini',
  'antigravity', 'opencode', 'aider', 'grok', 'devin', 'droid', 'hermes', 'agy',
];

// 이름은 반드시 토큰 단위로 매치한다. substring 이면
//   "opencode-blinker" ⊃ opencode,  "android" ⊃ droid,  "~/codex/ready" ⊃ codex
// 가 전부 오탐이 된다. 경계 가드가 경로 구분자와 하이픈 합성어를 양쪽에서 막는다.
const AGENT_NAME_RE = new RegExp(
  `(?<![\\w./\\\\-])(?:${AGENT_NAMES.join('|')})(?:\\.(?:exe|cmd|bat|ps1))?(?![\\w./\\\\-])`,
  'i',
);

// 키워드도 같은 이유로 경계를 본다 — "reworking" 이 working 이 되면 안 된다.
const IDLE_KEYWORDS_RE = /(?<![\w./\\-])(ready|idle|done)(?![\w-])/i;
const WORKING_KEYWORDS_RE = /(?<![\w./\\-])(working|thinking|running)(?![\w-])/i;
const PERMISSION_KEYWORDS = ['action required', 'permission', 'waiting'];

/**
 * 'working' | 'permission' | 'idle' | null
 *
 * null 은 "에이전트가 아니다" 이지 "모르겠다" 가 아니다 — 평범한 셸 타이틀은
 * 상태를 갖지 않는다.
 */
export const detectAgentStatus = (title) => {
  if (!title) return null;

  // 1) 글리프가 가장 강한 증거다. cwd/세션 텍스트보다 우선한다.
  if (title.includes(GEMINI_PERMISSION)) return 'permission';
  if (title.includes(GEMINI_WORKING) || title.includes(GEMINI_SILENT_WORKING)) return 'working';
  if (title.includes(GEMINI_IDLE)) return 'idle';
  if (title.startsWith(CLAUDE_IDLE)) return 'idle';
  if (BRAILLE_RE.test(title)) return 'working';

  // 2) 글리프가 없으면 에이전트 이름이 있어야만 상태를 논한다.
  if (!AGENT_NAME_RE.test(title)) return null;

  const lowered = title.toLowerCase();
  if (PERMISSION_KEYWORDS.some((word) => lowered.includes(word))) return 'permission';
  if (IDLE_KEYWORDS_RE.test(title)) return 'idle';
  if (WORKING_KEYWORDS_RE.test(title)) return 'working';

  // 이름만 있고 상태어가 없다 — 떠 있지만 놀고 있는 것으로 본다.
  return 'idle';
};

/**
 * 탭/pane 이름으로 쓸 표시용 타이틀. 상태 글리프를 뗀다.
 * 글리프를 남기면 스피너 프레임마다 탭 이름이 덜덜 떨린다.
 */
export const agentDisplayTitle = (title) => {
  if (!title) return '';
  const cleaned = title.replace(STATUS_GLYPHS_RE, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned || title;
};

/**
 * 두 타이틀이 스피너 프레임만 다른가.
 * 브라유 스피너는 초당 10~12회 바뀐다 — 이걸 '변경' 으로 치면 상태 스토어가
 * 초당 열두 번 리렌더를 유발한다.
 */
export const isSpinnerOnlyChange = (before, after) => (
  before === after || agentDisplayTitle(before) === agentDisplayTitle(after)
);
