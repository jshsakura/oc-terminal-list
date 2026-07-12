import { MAX_PENDING_WRITE_BYTES } from './terminalConstants';

/**
 * WebSocket 출력 → xterm 쓰기. 사이에 배치·백프레셔·비활성 지연을 끼운다.
 *
 * 세 가지를 막는다:
 *  1. 프레임마다 write 폭주 → 16ms(활성) / 50ms(비활성) 배치로 묶는다.
 *  2. xterm 파서가 못 따라와 내부 write 버퍼가 폭증 → 탭 freeze. 미처리 백로그가 상한을
 *     넘으면 이번 출력을 통째로 버린다(화면은 다음 출력·redraw 로 회복된다).
 *  3. 비활성 pane 의 파싱/렌더 비용 → 버퍼에 쌓아두고 활성 복귀 시 한 번에 쓴다.
 *     tmux 가 attach 시 화면을 다시 그려주므로 일부 scrollback 손실은 감수할 만하다.
 */

// 비활성 동안 쌓아둘 raw 바이트 상한 — 넘으면 오래된 것부터 버린다.
const INACTIVE_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
// 큰 누적분을 한 번에 write 하면 파서가 메인스레드를 길게 잡아 재활성 순간 UI 가 멈춘다.
// 청크로 쪼개 xterm 이 프레임 사이에 렌더를 끼워넣게 한다.
const WRITE_CHUNK_BYTES = 256 * 1024;

const BATCH_ACTIVE_MS = 16;   // 한 프레임
const BATCH_INACTIVE_MS = 50;

const createOutputSink = ({ term, isActive, onServerOutput, onNewData, onContent }) => {
  let buffer = [];
  let flushTimer = null;
  let pendingWriteBytes = 0;

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
    /** 서버에서 온 raw ArrayBuffer 한 덩어리. 다음 배치 틱에 묶여 쓰인다. */
    push: (chunk) => {
      buffer.push(chunk);
      if (flushTimer) return;
      flushTimer = setTimeout(flush, isActive() ? BATCH_ACTIVE_MS : BATCH_INACTIVE_MS);
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
    },
  };
};

export default createOutputSink;
