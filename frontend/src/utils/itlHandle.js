/**
 * 팬 우상단 배지가 복사하는 **핸들** — 남의 에이전트에게 "저 터미널에 시켜" 라고 건네는 줄.
 *
 * 예전 핸들은 `tmux -L <sock> attach -t '=<uuid>:'  # … send-keys -l 'TEXT' …` 였다.
 * 길었고, 무엇보다 **받는 쪽이 상대가 tmux 인지 herdr 인지 알아야** 했다 — 보내는 쪽이
 * 알 수 없는 값이다. 그래서 itl 이 사라졌을 때 이 배지도 같이 걷어냈다.
 *
 * itl 이 돌아오면서 핸들이 한 줄로 줄었다:
 *
 *     itl send 1.2 'TEXT'  # ubuntu-lab · …/workspace/sn-ninja
 *
 * `1.2` 는 **앱 주소**(탭.팬)다. 그 팬을 tmux 가 잡고 있든 herdr 가 잡고 있든, 같은
 * 기계든 다른 기계든 itl 이 알아서 푼다(`backend/cli/itl` 의 규칙 1: 설정이 아니라 탐색).
 * 그래서 여기서 소켓 이름도, 멀티플렉서 종류도, ssh 주소도 실을 이유가 없다.
 *
 * ⚠️ **명령이 먼저, 나머지는 `#` 뒤로.** 문장으로 쓰면 받는 에이전트가 산문으로 읽고
 * 자기 나름의 방법을 찾아 헤맨다. `itl` 로 시작하는 줄은 오해할 여지가 없고 붙여넣은
 * 그대로 돌아간다.
 */

/** 보낼 내용이 들어갈 자리. 받는 쪽이 이 자리를 바꿔 쓴다. */
export const TEXT_PLACEHOLDER = 'TEXT';

// 주석이 줄바꿈되면 아무도 끝까지 안 읽는다. 경로는 **꼬리**가 식별하는 부분이다.
const MAX_CWD = 46;

export const clampTail = (value, max = MAX_CWD) => {
  const text = String(value || '').trim();
  return !text || text.length <= max ? text : `…${text.slice(-(max - 1))}`;
};

/**
 * @param {object}  opts
 * @param {string}  opts.addr    앱 주소 `탭.팬` (예: `1.2`). 없으면 핸들도 없다.
 * @param {string} [opts.server] 어느 기계인지 — 호스트 이름 또는 이 서버의 표시 이름.
 * @param {string} [opts.cwd]    그 팬이 있는 경로.
 * @returns {string} 복사할 한 줄. 주소가 없으면 빈 문자열.
 */
export const buildItlHandle = ({ addr, server = '', cwd = '' } = {}) => {
  const target = String(addr || '').trim();
  if (!target) return '';
  const note = [String(server || '').trim(), clampTail(cwd)].filter(Boolean).join(' · ');
  const command = `itl send ${target} '${TEXT_PLACEHOLDER}'`;
  return note ? `${command}  # ${note}` : command;
};

/** 토스트에 쓸 짧은 라벨 — 클립보드에 들어간 긴 줄을 화면에 또 띄우지 않는다. */
export const itlHandleLabel = ({ addr, server = '' } = {}) => {
  const target = String(addr || '').trim();
  if (!target) return '';
  const where = String(server || '').trim();
  return where ? `${target} · ${where}` : target;
};

export default buildItlHandle;
