/**
 * 서버 복귀 감지 프로브(`/api/health`)를 **가볍게** 만드는 두 가지.
 *
 * 왜 필요했나: 장애가 나면 pane 마다 3초 주기로 `/api/health` 를 두드렸다. 게이트가
 * `isActive` 였는데 **분할 형제는 전부 isActive=true** 라, 4분할이면 3초마다 4번이다.
 * 5분 30초짜리 장애 한 번에 400회가 넘는다. 그런데 이 앱의 장애는 대개 공유 터널 포화라
 * (memory: project_cloudflare_tunnel_layer) — **막혀서 생긴 장애에 프로브로 더 때리는 꼴**이다.
 *
 *  1. 리스 — 페이지당 한 pane 만 프로브한다. pane 수와 무관해진다.
 *  2. 사다리 — 장애가 길어질수록 간격을 늘린다. 3초 해상도는 초반에만 의미가 있다.
 */

/* 장애 경과 → 프로브 간격. 초반엔 촘촘히(복귀 즉시 붙는 게 체감의 전부), 길어지면 성기게.
   경계는 오름차순이어야 하고 `probeSpacingMs` 가 마지막으로 넘어선 칸을 쓴다. */
export const PROBE_LADDER = [
  { afterMs: 0, everyMs: 3000 },
  { afterMs: 30_000, everyMs: 10_000 },
  { afterMs: 120_000, everyMs: 30_000 },
];

export const probeSpacingMs = (outageMs) => {
  let spacing = PROBE_LADDER[0].everyMs;
  for (const step of PROBE_LADDER) {
    if (outageMs >= step.afterMs) spacing = step.everyMs;
  }
  return spacing;
};

/* 리스 보유자가 이 시간 동안 갱신하지 않으면 다른 pane 이 뺏어온다. 어딘가에서 해제를
   빠뜨려도 프로브가 영영 멈추지 않게 하는 안전장치 — 명시적 해제에만 기대면, 리스를 쥔 채
   정리된 pane 하나가 페이지 전체의 복귀 감지를 죽인다. 프로브 틱이 3초라 여유는 충분하다. */
export const LEASE_STALE_MS = 15_000;

let holder = null; // { paneKey, renewedAt }

/**
 * 이 pane 이 지금 프로브해도 되는가. 보유자면 갱신하고 true.
 * @returns {boolean} false 면 다른 pane 이 이미 이 페이지를 대표해 프로브 중이다.
 */
export const claimProbeLease = (paneKey, now) => {
  if (holder && holder.paneKey !== paneKey && now - holder.renewedAt <= LEASE_STALE_MS) return false;
  holder = { paneKey, renewedAt: now };
  return true;
};

export const releaseProbeLease = (paneKey) => {
  if (holder?.paneKey === paneKey) holder = null;
};

/** 테스트 전용 — 모듈 레벨 상태를 초기화한다. */
export const _resetProbeLease = () => { holder = null; };
