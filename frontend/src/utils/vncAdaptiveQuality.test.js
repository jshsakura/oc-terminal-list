import { describe, it, expect, vi } from 'vitest';
import {
  QUALITY_STEPS, INITIAL_STEP, MIN_BURST_BYTES, BURST_GAP_MS,
  COOLDOWN_UP_MS, AGREE_TO_RAISE,
  stepForThroughput, initialState, decideStep, createBurstMeter,
} from './vncAdaptiveQuality';

const name = (i) => QUALITY_STEPS[i].name;

describe('stepForThroughput', () => {
  it('대역폭이 감당하는 가장 높은 단을 고른다', () => {
    expect(name(stepForThroughput(100))).toBe('sharp');
    expect(name(stepForThroughput(25))).toBe('sharp');
    expect(name(stepForThroughput(24))).toBe('balanced');
    expect(name(stepForThroughput(8))).toBe('balanced');
    expect(name(stepForThroughput(7))).toBe('light');
    expect(name(stepForThroughput(0))).toBe('light');
  });

  it('사다리는 낮은 화질에서 높은 화질 순이다', () => {
    const levels = QUALITY_STEPS.map((s) => s.qualityLevel);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });
});

describe('decideStep — 내려갈 때는 빠르게', () => {
  it('한 번의 측정으로 내린다 — 버벅임은 지금 아프다', () => {
    const r = decideStep(initialState(), { mbps: 2, at: 10_000 });
    expect(r.changed).toBe(true);
    expect(r.step.name).toBe('balanced');   // 한 단씩
  });

  it('바닥까지 한 번에 떨어뜨리지 않는다 — 과하게 흐려진다', () => {
    let s = initialState();                  // sharp
    let r = decideStep(s, { mbps: 0.5, at: 10_000 });
    expect(r.step.name).toBe('balanced');
    r = decideStep(r.state, { mbps: 0.5, at: 10_000 + 4000 });
    expect(r.step.name).toBe('light');
  });

  it('쿨다운 안에서는 연달아 내리지 않는다', () => {
    const first = decideStep(initialState(), { mbps: 1, at: 10_000 });
    const second = decideStep(first.state, { mbps: 1, at: 10_500 });
    expect(second.changed).toBe(false);
    expect(second.step.name).toBe('balanced');
  });

  it('바닥에서는 더 내려가지 않는다', () => {
    const r = decideStep(initialState(0), { mbps: 0, at: 99_999 });
    expect(r.changed).toBe(false);
    expect(r.step.name).toBe('light');
  });
});

describe('decideStep — 올라갈 때는 느리게', () => {
  it('한 번 좋아졌다고 바로 올리지 않는다', () => {
    const r = decideStep(initialState(0), { mbps: 100, at: 100_000 });
    expect(r.changed).toBe(false);
    expect(r.state.agreeing).toBe(1);
  });

  it('연속으로 동의하고 쿨다운도 지나야 올린다', () => {
    let s = initialState(0);
    let r;
    for (let i = 0; i < AGREE_TO_RAISE; i += 1) {
      r = decideStep(s, { mbps: 100, at: 100_000 + i * 1000 });
      s = r.state;
    }
    expect(r.changed).toBe(true);
    expect(r.step.name).toBe('balanced');
  });

  it('한 번이라도 나빠지면 동의 횟수가 초기화된다 — 경계에서 진동하지 않게', () => {
    let s = initialState(0);
    s = decideStep(s, { mbps: 100, at: 100_000 }).state;
    s = decideStep(s, { mbps: 100, at: 101_000 }).state;
    expect(s.agreeing).toBe(2);
    s = decideStep(s, { mbps: 1, at: 102_000 }).state;   // 같은 단에 머무름
    expect(s.agreeing).toBe(0);
  });

  it('막 바꾼 직후에는 쿨다운 때문에 못 올린다', () => {
    let s = { index: 0, agreeing: 0, lastChangeAt: 100_000 };
    let r;
    for (let i = 0; i < AGREE_TO_RAISE + 2; i += 1) {
      r = decideStep(s, { mbps: 100, at: 100_500 + i * 100 });
      s = r.state;
    }
    expect(r.changed).toBe(false);
  });

  it('꼭대기에서는 더 올라가지 않는다', () => {
    const r = decideStep(initialState(), { mbps: 999, at: 999_999 });
    expect(r.changed).toBe(false);
    expect(r.step.name).toBe('sharp');
  });

  it('내리는 쿨다운이 올리는 쿨다운보다 짧다 — 비대칭이 이 모듈의 요점이다', () => {
    expect(COOLDOWN_UP_MS).toBeGreaterThan(3000);
  });
});

describe('createBurstMeter', () => {
  it('덩어리가 끝날 때 대역폭 하나를 뱉는다', () => {
    const seen = [];
    const m = createBurstMeter((s) => seen.push(s));
    // 1MB 를 100ms 에 받았다 → 약 80Mbps
    m.push(MIN_BURST_BYTES * 6, 1000);
    m.push(1, 1100);
    m.flush();
    expect(seen).toHaveLength(1);
    expect(seen[0].mbps).toBeGreaterThan(50);
  });

  it('조용한 구간은 재지 않는다 — 보낼 게 없는 것과 링크가 느린 것은 다르다', () => {
    const seen = [];
    const m = createBurstMeter((s) => seen.push(s));
    m.push(1024, 1000);
    m.push(1024, 5000);
    m.flush();
    expect(seen).toEqual([]);
  });

  it('간격이 벌어지면 별개의 덩어리로 나눈다', () => {
    const seen = [];
    const m = createBurstMeter((s) => seen.push(s));
    m.push(MIN_BURST_BYTES, 1000);
    m.push(MIN_BURST_BYTES, 1050);
    m.push(MIN_BURST_BYTES, 1050 + BURST_GAP_MS + 50);   // 새 덩어리
    m.push(MIN_BURST_BYTES, 1050 + BURST_GAP_MS + 100);
    m.flush();
    expect(seen).toHaveLength(2);
  });

  it('한 점짜리 덩어리는 시간이 0 이라 재지 않는다', () => {
    const seen = [];
    const m = createBurstMeter((s) => seen.push(s));
    m.push(MIN_BURST_BYTES * 10, 1000);
    m.flush();
    expect(seen).toEqual([]);
  });

  it('느린 링크는 낮은 대역폭으로 측정된다', () => {
    const seen = [];
    const m = createBurstMeter((s) => seen.push(s));
    // 느린 링크의 실제 모양: 64KB 짜리가 500ms 씩 벌어져 도착한다.
    for (let i = 0; i < 5; i += 1) m.push(64 * 1024, 1000 + i * 500);
    m.flush();
    expect(seen).toHaveLength(1);
    expect(seen[0].mbps).toBeLessThan(2);
    expect(QUALITY_STEPS[stepForThroughput(seen[0].mbps)].name).toBe('light');
  });

  it('느린 링크의 벌어진 간격을 별개 덩어리로 쪼개지 않는다', () => {
    // 이 선을 놓치면 정작 재야 할 느린 링크만 영영 측정되지 않는다 —
    // 백엔드가 64KB 씩 보내므로 1Mbps 에서는 메시지 간격이 0.5초다.
    expect(BURST_GAP_MS).toBeGreaterThanOrEqual(500);
  });
});

describe('출발점', () => {
  it('가장 선명한 단에서 시작한다 — 못 버티면 첫 덩어리가 알려준다', () => {
    expect(name(INITIAL_STEP)).toBe('sharp');
  });
});
