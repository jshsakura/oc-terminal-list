/**
 * 막힌 업로드를 **붙잡고 다시 시도한다** — 사용자가 붙여넣은 이미지를 잃지 않기 위해.
 *
 * 이 배포의 단골 고장: 공유 HTTP/2 연결이 막히면 평범한 fetch 는 죽는데 WebSocket 은
 * 매번 새 TCP 라 멀쩡히 살아 있다. 그래서 "터미널은 되는데 업로드만 실패" 가 되고,
 * 예전에는 그 순간 blob 이 그대로 버려져서 **사용자가 다시 복사해 오는 수밖에** 없었다.
 *
 * 규칙:
 *  - `blocked`(요청이 도착조차 못 함)일 때만 붙잡는다. 서버가 거절한 것(`server`)은
 *    다시 보내도 같은 답이므로 즉시 포기한다 — 원격 /tmp 가 찼는데 60초 더 두드리지 않는다.
 *  - **총 시간에 상한이 있다.** 영영 재시도하면 그건 고장이 아니라 다른 고장이다.
 *  - 성공하면 그때 경로를 넣는다. 사용자는 늦게라도 잃지 않는다.
 */

// 재시도 사다리(ms). 마지막까지 실패하면 포기하고 새로고침을 권한다.
export const RETRY_DELAYS_MS = [2000, 5000, 12000, 25000];

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * @param attempt  실제 업로드 한 번. resolve 값이 결과, throw 는 UploadError.
 * @param onState  'uploading' | 'retrying' | 'done' | 'blocked' | 'error' 를 통보.
 * @param isStale  true 를 돌려주면 즉시 그만둔다(pane 이 사라졌다 등).
 * @returns 성공하면 결과, 끝내 실패하면 null.
 */
export const uploadWithRetry = async ({ attempt, onState, isStale = () => false, delays = RETRY_DELAYS_MS }) => {
  onState('uploading');
  for (let i = 0; i <= delays.length; i += 1) {
    if (isStale()) return null;
    try {
      const result = await attempt();
      onState('done');
      return result;
    } catch (err) {
      // 서버가 답을 한 실패는 다시 보내도 같다. 붙잡지 않는다.
      if (err?.kind !== 'blocked' && err?.kind !== 'offline') {
        onState('error', err);
        return null;
      }
      if (i === delays.length) {
        onState('blocked', err);
        return null;
      }
      onState('retrying', err);
      await sleep(delays[i]);
    }
  }
  return null;
};
