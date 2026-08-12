/**
 * WS 핸드셰이크 동시 개수 게이트 — 페이지 전체가 하나를 공유한다.
 *
 * 복원된 워크스페이스는 pane 을 전부 동시에 연다(실측 14개가 8초 안에). 그 순간
 * 핸드셰이크 14개가 한꺼번에 공유 Cloudflare 터널로 나가고, 서버는 tmux attach 14개를
 * 띄워 화면 리플레이를 동시에 쏟아낸다 — "로딩중" 이 길게 걸리는 그 장면이다.
 * 최종 상태는 어차피 같으므로, 몇 개씩 나눠 붙이면 체감만 좋아진다.
 *
 * 규칙 두 가지:
 * - **보이는 pane 이 먼저다.** 안 보이는 탭의 pane 은 뒤로 미룬다.
 * - **무한 대기는 없다.** 핸드셰이크가 매달려 슬롯을 물고 있어도 maxWaitMs 뒤에는
 *   그냥 진행한다. 이 게이트가 재연결을 막는 새로운 교착이 되면 안 된다
 *   (이 저장소가 이미 여러 번 밟은 사고다).
 */

export const WS_GATE_MAX_CONCURRENT = 3;
export const WS_GATE_MAX_WAIT_MS = 2500;
// 호출부가 release 를 잊거나 그 전에 통째로 언마운트돼도 슬롯이 영영 잠기지 않게 하는 백스톱.
export const WS_GATE_AUTO_RELEASE_MS = 12000;

export const createWsConnectGate = ({
  maxConcurrent = WS_GATE_MAX_CONCURRENT,
  maxWaitMs = WS_GATE_MAX_WAIT_MS,
  autoReleaseMs = WS_GATE_AUTO_RELEASE_MS,
} = {}) => {
  let active = 0;
  let waiting = [];

  const makeRelease = () => {
    let released = false;
    const autoTimer = setTimeout(() => release(), autoReleaseMs);
    function release() {
      if (released) return;
      released = true;
      clearTimeout(autoTimer);
      active = Math.max(0, active - 1);
      pump();
    }
    return release;
  };

  const grant = (entry) => {
    if (entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.timer);
    active += 1;
    entry.resolve(makeRelease());
  };

  function pump() {
    while (active < maxConcurrent && waiting.length) {
      // 우선순위가 있으면 그쪽부터, 같으면 들어온 순서대로.
      let idx = waiting.findIndex((w) => w.priority);
      if (idx < 0) idx = 0;
      const [entry] = waiting.splice(idx, 1);
      grant(entry);
    }
  }

  /**
   * @returns {Promise<() => void>} release 함수. 소켓이 열리든 닫히든 반드시 호출한다.
   */
  const acquire = ({ priority = false } = {}) => new Promise((resolve) => {
    const entry = { priority, resolve, settled: false, timer: null };
    if (active < maxConcurrent) { grant(entry); return; }
    entry.timer = setTimeout(() => {
      // 상한 초과 — 큐에서 빼고 그냥 진행한다. active 는 그대로 올려서 release 와 짝을 맞춘다.
      waiting = waiting.filter((w) => w !== entry);
      grant(entry);
    }, maxWaitMs);
    waiting.push(entry);
  });

  const stats = () => ({ active, waiting: waiting.length });

  return { acquire, stats };
};

const gate = createWsConnectGate();

export const acquireWsConnectSlot = gate.acquire;
export const wsConnectGateStats = gate.stats;
export default gate;
