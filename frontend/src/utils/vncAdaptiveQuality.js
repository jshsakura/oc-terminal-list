/**
 * VNC 화질 자동 적응 — 사람이 프리셋을 고르지 않아도 되게.
 *
 * 왜 자동인가: 화질은 링크가 정하는 값이지 취향이 아니다. 같은 사용자가 사무실에서는
 * 선명하게 볼 수 있고 모바일 테더링에서는 못 본다. 그때마다 메뉴를 여는 것은 앱이 할 일을
 * 사람에게 미루는 것이다.
 *
 * 무엇을 재는가: **버스트 구간의 실측 처리량**이다. RFB 는 몰아치는 스트림이라(해상도 변경,
 * 창 이동, 스크롤) 서버가 보낼 것이 쌓인 동안은 링크가 병목이 된다. 그 구간의
 * 바이트/시간이 곧 이 링크가 감당할 수 있는 대역폭이다. 조용할 때는 재지 않는다 —
 * 보낼 게 없어서 느린 것과 링크가 느린 것은 다른 사건이다.
 *
 * ⚠️ **내려갈 때는 빠르게, 올라갈 때는 느리게.** 화질이 과하면 즉시 버벅여서 사용자가
 * 바로 아프지만, 올릴 기회를 한 박자 놓치는 것은 아무도 모른다. 대칭으로 만들면 경계에서
 * 위아래로 진동하고, 그 진동 자체가 가장 나쁜 경험이다.
 */

/** 낮은 화질 → 높은 화질. `minMbps` 는 그 단을 유지하기 위해 필요한 실측 대역폭. */
export const QUALITY_STEPS = [
  // qualityLevel 은 서버가 실제 JPEG 품질로 옮기는 값이다(TurboVNC: 3→42, 8→92, 9→100).
  { name: 'light', qualityLevel: 3, compressionLevel: 7, minMbps: 0 },
  { name: 'balanced', qualityLevel: 8, compressionLevel: 3, minMbps: 8 },
  { name: 'sharp', qualityLevel: 9, compressionLevel: 0, minMbps: 25 },
];

/** 낙관적으로 시작한다 — 대부분의 링크는 감당하고, 못 하면 첫 버스트가 바로 알려준다. */
export const INITIAL_STEP = QUALITY_STEPS.length - 1;

/* 버스트 판정: 이 간격 안에 이어 도착하면 같은 덩어리로 본다.
 *
 * ⚠️ **넉넉해야 한다. 느린 링크일수록 간격이 벌어지기 때문이다.** 백엔드는 64KB 씩 읽어
 * 보내므로, 1Mbps 링크에서는 메시지 하나를 밀어내는 데만 0.5초가 걸린다 — 간격을 짧게
 * (처음엔 120ms 로) 잡으면 그 덩어리가 매번 쪼개져 최소 크기를 못 넘고, **정작 재야 할
 * 느린 링크가 영영 측정되지 않는다.** 그러면 화질은 영원히 sharp 에 머문다.
 *
 * 조용한 구간을 걸러내는 일은 간격이 아니라 `MIN_BURST_BYTES` 가 한다. 깜빡이는 커서가
 * 만드는 작은 갱신은 1초 간격으로 이어져도 바이트가 모자라 버려진다. */
export const BURST_GAP_MS = 1000;
// 이보다 작은 덩어리로는 대역폭을 재지 않는다 — 도착 시각 두 점으로는 오차가 크다.
export const MIN_BURST_BYTES = 192 * 1024;
// 한 번 바꾸면 이만큼은 그대로 둔다(내려갈 때 / 올라갈 때).
export const COOLDOWN_DOWN_MS = 3000;
export const COOLDOWN_UP_MS = 15000;
// 올릴 때는 연속으로 이만큼 동의해야 한다. 내릴 때는 한 번이면 충분하다.
export const AGREE_TO_RAISE = 3;

/** 실측 대역폭이 감당할 수 있는 가장 높은 단. */
export const stepForThroughput = (mbps) => {
  let index = 0;
  for (let i = 0; i < QUALITY_STEPS.length; i += 1) {
    if (mbps >= QUALITY_STEPS[i].minMbps) index = i;
  }
  return index;
};

export const initialState = (index = INITIAL_STEP) => ({
  index,
  agreeing: 0,
  lastChangeAt: -Infinity,
});

/**
 * 한 번의 측정으로 다음 상태를 정한다. **순수 함수** — 상태를 새로 만들어 돌려준다.
 *
 * @param state {{index, agreeing, lastChangeAt}}
 * @param sample {{mbps: number, at: number}}
 * @returns {{state, changed: boolean, step: object}}
 */
export const decideStep = (state, sample) => {
  const want = stepForThroughput(sample.mbps);
  const held = { ...state, agreeing: 0 };

  if (want < state.index) {
    // 링크가 못 버틴다. 한 번의 측정으로 내린다 — 버벅임은 지금 아프다.
    if (sample.at - state.lastChangeAt < COOLDOWN_DOWN_MS) {
      return { state: held, changed: false, step: QUALITY_STEPS[state.index] };
    }
    const index = state.index - 1;   // 한 단씩 — 바닥까지 떨어뜨리면 과하게 흐려진다
    return {
      state: { index, agreeing: 0, lastChangeAt: sample.at },
      changed: true,
      step: QUALITY_STEPS[index],
    };
  }

  if (want > state.index) {
    // 여유가 생겼다. 연속으로 동의할 때만, 그리고 충분히 기다린 뒤에만 올린다.
    const agreeing = state.agreeing + 1;
    if (agreeing < AGREE_TO_RAISE || sample.at - state.lastChangeAt < COOLDOWN_UP_MS) {
      return {
        state: { ...state, agreeing },
        changed: false,
        step: QUALITY_STEPS[state.index],
      };
    }
    const index = state.index + 1;
    return {
      state: { index, agreeing: 0, lastChangeAt: sample.at },
      changed: true,
      step: QUALITY_STEPS[index],
    };
  }

  return { state: held, changed: false, step: QUALITY_STEPS[state.index] };
};

/**
 * 도착 이벤트를 모아 버스트가 끝나는 순간 대역폭 하나를 뱉는다.
 *
 * 시계를 주입받는다 — 타이머 없이 테스트할 수 있어야 하고, 무엇보다 이 계산이
 * 렌더 루프와 무관해야 한다.
 */
export const createBurstMeter = (onSample) => {
  let bytes = 0;
  let startedAt = 0;
  let lastAt = 0;

  const flush = () => {
    // 한 점짜리 버스트는 시간이 0 이라 나눌 수 없다. 작은 덩어리도 버린다.
    if (bytes >= MIN_BURST_BYTES && lastAt > startedAt) {
      const mbps = (bytes * 8) / ((lastAt - startedAt) / 1000) / 1e6;
      onSample({ mbps, at: lastAt, bytes });
    }
    bytes = 0;
    startedAt = 0;
    lastAt = 0;
  };

  return {
    /** 메시지 하나가 도착했다. */
    push(byteLength, at) {
      if (startedAt && at - lastAt > BURST_GAP_MS) flush();
      if (!startedAt) startedAt = at;
      lastAt = at;
      bytes += byteLength;
    },
    /** 조용해졌다 — 진행 중인 버스트를 마감한다. */
    flush,
  };
};
