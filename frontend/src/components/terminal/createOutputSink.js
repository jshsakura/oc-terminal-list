import { MAX_PENDING_WRITE_BYTES } from './terminalConstants';

/**
 * WebSocket 출력 → xterm 쓰기. 사이에 배치·백프레셔·비활성 지연을 끼운다.
 *
 * 네 가지를 막는다:
 *  1. 프레임마다 write 폭주 → 아래 코얼레싱 창으로 묶는다.
 *  2. xterm 파서가 못 따라와 내부 write 버퍼가 폭증 → 탭 freeze. 미처리 백로그가 상한을
 *     넘으면 이번 출력을 통째로 버린다(화면은 다음 출력·redraw 로 회복된다).
 *  3. 비활성 pane 의 파싱/렌더 비용 → 버퍼에 쌓아두고 활성 복귀 시 한 번에 쓴다.
 *     tmux 가 attach 시 화면을 다시 그려주므로 일부 scrollback 손실은 감수할 만하다.
 *  4. 조용하다가 온 첫 바이트가 배치 타이머만큼 늦게 그려지는 것 → 리딩엣지로 즉시 쓴다.
 *
 * 타이밍이 리딩엣지 + 코얼레싱인 이유: 예전엔 push 마다 트레일링 타이머(16ms)를 걸었다.
 * 그래서 (a) 조용하다 온 한 글자도 16ms 늦게 그려지고, (b) 출력이 끊기지 않는 동안은
 * 초당 60회 파싱+GPU 드로우가 돌았다. 둘 다 원하는 게 아니다 — 사람이 기다리는 건 (a) 뿐이고,
 * (b) 의 중간 프레임은 읽지도 못한다. 그래서 창이 비어 있으면 즉시 쓰고, 지속 출력 중에는
 * 창 주기로만 쓴다. 지연은 줄고 렌더는 반 이하가 된다.
 */

// 비활성 동안 쌓아둘 raw 바이트 상한 — 넘으면 오래된 것부터 버린다.
const INACTIVE_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
// 큰 누적분을 한 번에 write 하면 파서가 메인스레드를 길게 잡아 재활성 순간 UI 가 멈춘다.
// 청크로 쪼개 xterm 이 프레임 사이에 렌더를 끼워넣게 한다.
const WRITE_CHUNK_BYTES = 256 * 1024;

/* 지속 출력 중의 렌더 상한 — 이 앱에서 가장 뜨거운 경로다.
   분할 그리드에서는 형제 pane 이 전부 isActive=true 라 이 값이 pane 수만큼 곱해진다 —
   그래서 포커스 안 된 pane 은 한 단 더 느리게 그린다(보이니까 그리긴 해야 하지만,
   보고 있는 pane 과 같은 속도로 그릴 이유는 없다).

   ⚠️ **이 숫자는 입력 지연과 무관하다.** 리딩엣지라 조용하다 온 첫 바이트(=키 에코)는
   창을 거치지 않고 그 자리에서 그려진다. 여기서 정하는 것은 **지속 출력**(빌드 로그가
   쏟아질 때)의 렌더 횟수뿐이고, 그 구간의 중간 프레임은 사람이 읽지 못한다.

   60 → 30 → 20fps 로 두 번 내려왔다. 첫 번째(60→30)에서 아무도 차이를 못 느꼈고,
   같은 논리가 그대로 이어진다: 스크롤하며 흘러가는 글자는 어느 쪽이든 못 읽는다.
   대신 지속 출력 한 구간마다 파싱+드로우가 1/3 줄어든다. 더 내리면 그때는 스크롤이
   끊겨 보이기 시작한다 — 여기가 바닥이다. */
export const COALESCE_FOCUSED_MS = 50;   // ~20fps — 지금 보고 있는 pane
export const COALESCE_VISIBLE_MS = 80;   // ~12fps — 보이지만 포커스는 아닌 분할 형제
export const COALESCE_INACTIVE_MS = 50;  // 안 보이는 pane — 어차피 버퍼에 쌓기만 한다
/* 이북(전자잉크) 모드 — 이 값이 이 모드의 **핵심 절감**이다.
   전자잉크는 화면 갱신 한 번이 100~300ms 다. 30fps 로 밀어 넣으면 패널이 못 따라와
   잔상만 쌓이고, 사람이 읽을 수 있는 중간 프레임도 아니다. 창을 300ms(~3fps)로 벌리면
   같은 출력에 write·파싱·리페인트가 10분의 1로 줄고, 화면은 오히려 더 읽힌다.
   리딩엣지는 그대로라 조용하다 온 첫 바이트(=키 입력 에코)는 여전히 즉시 그려진다. */
export const COALESCE_EINK_MS = 300;

const createOutputSink = ({ term, isActive, isFocused = () => true, isEink = () => false, onServerOutput, onNewData, onContent }) => {
  let buffer = [];
  let flushTimer = null;
  let pendingWriteBytes = 0;
  // 마지막으로 flush 를 *수행한* 시각. 창이 이미 비었는지 판정하는 기준.
  let lastFlushAt = 0;

  const coalesceMs = () => {
    // 이북 모드는 pane 이 활성이든 아니든 같은 창을 쓴다 — 상한을 정하는 것이 화면이지
    // 우리 우선순위가 아니기 때문이다.
    if (isEink()) return COALESCE_EINK_MS;
    if (!isActive()) return COALESCE_INACTIVE_MS;
    return isFocused() ? COALESCE_FOCUSED_MS : COALESCE_VISIBLE_MS;
  };

  const dropOldestIfOverCap = () => {
    let total = 0;
    for (const chunk of buffer) total += chunk.byteLength;
    while (total > INACTIVE_BUFFER_MAX_BYTES && buffer.length > 1) {
      total -= buffer.shift().byteLength;
    }
  };

  const merge = () => {
    let totalLength = 0;
    for (const chunk of buffer) totalLength += chunk.byteLength;
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of buffer) {
      merged.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    buffer = [];
    return merged;
  };

  const flush = () => {
    flushTimer = null;
    // 실제로 쓰지 않는 경로(비활성 버퍼링)에서도 스탬프를 찍는다 — 여기서 안 찍으면 비활성
    // pane 의 매 push 가 리딩엣지로 떨어져 dropOldestIfOverCap 을 청크마다 돌게 된다.
    lastFlushAt = Date.now();
    if (buffer.length === 0) return;

    // 비활성 pane — 파싱/렌더를 미룬다. 활성 복귀 시 호출부가 flush() 를 다시 부른다.
    if (!isActive()) {
      dropOldestIfOverCap();
      return;
    }

    const merged = merge();

    // 백프레셔 — 미처리 백로그가 상한을 넘으면 이번 출력은 버린다.
    if (pendingWriteBytes > MAX_PENDING_WRITE_BYTES) return;

    const onWriteDone = () => {
      // 서버 출력이 반영됐으니 에코로 확정된 만큼 예측 유령을 줄인다(틀린 예측은 여기서 정정).
      onServerOutput?.();
      onNewData?.();
      onContent?.();
    };

    pendingWriteBytes += merged.byteLength;
    const settle = (n) => { pendingWriteBytes = Math.max(0, pendingWriteBytes - n); };

    if (merged.byteLength <= WRITE_CHUNK_BYTES) {
      const n = merged.byteLength;
      term.write(merged, () => { settle(n); onWriteDone(); });
      return;
    }
    for (let off = 0; off < merged.byteLength; off += WRITE_CHUNK_BYTES) {
      const end = Math.min(off + WRITE_CHUNK_BYTES, merged.byteLength);
      const isLast = end >= merged.byteLength;
      const chunkLen = end - off;
      // subarray 는 복사 없이 뷰만 공유한다.
      term.write(merged.subarray(off, end), () => {
        settle(chunkLen);
        if (isLast) onWriteDone();
      });
    }
  };

  return {
    /** 서버에서 온 raw ArrayBuffer 한 덩어리. 창이 비었으면 즉시, 아니면 다음 틱에 쓰인다. */
    push: (chunk) => {
      buffer.push(chunk);
      if (flushTimer) return;
      const wait = coalesceMs() - (Date.now() - lastFlushAt);
      // 리딩엣지 — 조용하다가 온 첫 바이트는 타이머를 거치지 않고 이 자리에서 그린다.
      if (wait <= 0) { flush(); return; }
      flushTimer = setTimeout(flush, wait);
    },
    /** 활성 복귀 시 즉시 쓰기 — 비활성 동안 쌓인 출력을 흘려보낸다. */
    flush,
    /** eviction — 이 뒤로는 아무것도 터미널에 닿으면 안 된다. */
    clear: () => {
      buffer = [];
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
    },
    dispose: () => {
      buffer = [];
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      pendingWriteBytes = 0;
      lastFlushAt = 0;
    },
  };
};

export default createOutputSink;
