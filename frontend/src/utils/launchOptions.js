/**
 * 폴더를 고를 때 함께 고르는 것 — **이 터미널 하나를 무엇으로 열까.**
 *
 * 설정(세션 멀티플렉서 · 기본 셸)은 "앞으로 여는 것 전부" 를 정한다. 여기는 그 위에
 * 얹는 **한 번짜리 선택**이다. 둘은 다르다:
 *
 *   설정  = 이 사람이 평소에 쓰는 것        (저장되고, 계속 따라온다)
 *   이 값 = 이 pane 을 지금 무엇으로 열까   (그 pane 에만 남는다)
 *
 * ⚠️ 그래서 `utils/multiplexer.js` 의 "고르는 자리는 설정 한 곳뿐이다" 를 어기는 게
 * 아니다. 그 규칙이 막는 것은 **같은 기본값이 두 군데 저장되어 서로 어긋나는 것**이고
 * (호스트마다 또 고르게 두었다가 되돌린 그 일), 이건 저장된 기본값이 아니라 사용자가
 * 그 자리에서 한 번 내린 결정이다.
 *
 * ⚠️ **빈 값이 "기본" 이다.** 안 고르면 필드를 아예 안 싣고, 그러면 서버가 설정을 읽는다.
 * 여기서 기본값을 문자열로 박아 넣으면 나중에 설정을 바꿔도 옛 pane 이 안 따라온다 —
 * 그게 "같은 결정이 두 자리에 생긴다" 의 실제 증상이다.
 */
import { CHOICES as MUX_CHOICES } from './multiplexer';

/** 셸 선택지. 설정의 `defaultShell` 과 같은 어휘를 쓰되 `auto` 는 여기서 "기본" 이다. */
export const SHELL_CHOICES = ['bash', 'zsh', 'sh'];

/** 안 고른 상태. 필드를 싣지 않는다는 뜻이라 빈 문자열 하나로 충분하다. */
export const INHERIT = '';

/**
 * 화면이 준 값 → pane 에 실을 필드. **모르는 값은 통째로 버린다.**
 *
 * 서버도 화이트리스트로 접지만(쿼리는 클라이언트가 준 값이다), 여기서 걸러야 탭 상태에
 * 쓰레기가 저장되지 않는다. 안 고른 것은 키 자체가 없다 — `undefined` 를 넣어 두면
 * 탭 상태 비교(`areTabsEquivalent`)에서 없는 키와 다르게 읽힐 수 있다.
 */
export const cleanLaunch = (opts) => {
  const out = {};
  const mux = opts?.multiplexer;
  const shell = opts?.shell;
  if (typeof mux === 'string' && MUX_CHOICES.includes(mux)) out.multiplexer = mux;
  if (typeof shell === 'string' && SHELL_CHOICES.includes(shell)) out.shell = shell;
  return out;
};

/** 고른 게 하나라도 있나 — 없으면 호출부가 patch 자체를 건너뛴다. */
export const hasLaunchChoice = (opts) => Object.keys(cleanLaunch(opts)).length > 0;
