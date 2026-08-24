import { describe, it, expect } from 'vitest';
import {
  estimateImageTokens, fitWithin, findContentBox, scaleBoxToSource,
} from './pasteImageOptimize';

// Build a thumbnail-shaped ImageData stand-in: uniform background with a filled inner box.
const canvasWith = (width, height, bg, box) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = box && x >= box.x && x < box.x + box.width
        && y >= box.y && y < box.y + box.height;
      const [r, g, b] = inside ? box.color : bg;
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width, height };
};

describe('estimateImageTokens — 청구는 픽셀 수로만 매겨진다', () => {
  it('상한을 넘는 이미지는 전부 같은 값에 수렴한다 (파일 크기와 무관)', () => {
    // 2048 로 줄여봐야 절감이 0 인 이유: 1.15M 픽셀 상한이 이미 걸린다.
    expect(estimateImageTokens(3840, 2160)).toBe(estimateImageTokens(2048, 1152));
    expect(estimateImageTokens(1999, 1500)).toBe(estimateImageTokens(1568, 1176));
  });

  it('상한 아래로 내려가야 실제로 줄어든다', () => {
    expect(estimateImageTokens(1024, 768)).toBeLessThan(estimateImageTokens(1999, 1500));
    expect(estimateImageTokens(800, 600)).toBeLessThan(estimateImageTokens(1024, 768));
  });

  it('작은 이미지는 그대로 계산한다', () => {
    expect(estimateImageTokens(307, 157)).toBe(Math.ceil((307 * 157) / 750));
  });

  it('빈 값은 0', () => {
    expect(estimateImageTokens(0, 100)).toBe(0);
    expect(estimateImageTokens(undefined, undefined)).toBe(0);
  });
});

describe('fitWithin', () => {
  it('긴 변 기준으로 줄인다', () => {
    expect(fitWithin(1999, 1500, 1024)).toMatchObject({ width: 1024, height: 768 });
  });
  it('작은 이미지를 키우지 않는다 — 없는 정보를 만들면서 토큰만 는다', () => {
    expect(fitWithin(300, 200, 1024)).toMatchObject({ width: 300, height: 200, scale: 1 });
  });
});

describe('findContentBox — 여백만 잘라낸다', () => {
  it('단색 테두리 안의 내용 상자를 찾는다', () => {
    const img = canvasWith(40, 40, [255, 255, 255], { x: 10, y: 8, width: 12, height: 20, color: [10, 10, 10] });
    expect(findContentBox(img)).toEqual({ x: 10, y: 8, width: 12, height: 20 });
  });

  it('잘라낼 여백이 없으면 null — 멀쩡한 이미지를 건드리지 않는다', () => {
    const img = canvasWith(20, 20, [255, 255, 255], { x: 0, y: 0, width: 20, height: 20, color: [0, 0, 0] });
    expect(findContentBox(img)).toBeNull();
  });

  it('모서리 색이 서로 다르면 포기한다 — 그런 이미지에 "여백" 은 없다', () => {
    const img = canvasWith(20, 20, [255, 255, 255], null);
    const i = ((19 * 20) + 19) * 4;
    img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0;
    expect(findContentBox(img)).toBeNull();
  });

  it('거의 전부를 잘라내게 되면 포기한다 — 판정이 틀린 쪽에 건다', () => {
    const img = canvasWith(100, 100, [255, 255, 255], { x: 50, y: 50, width: 2, height: 2, color: [0, 0, 0] });
    expect(findContentBox(img)).toBeNull();
  });

  it('JPEG 잡음 정도의 색 흔들림은 여백으로 본다', () => {
    const img = canvasWith(30, 30, [250, 250, 250], { x: 6, y: 6, width: 10, height: 10, color: [0, 0, 0] });
    img.data[(3 * 30 + 3) * 4] = 244;      // 6 off — within tolerance
    expect(findContentBox(img)).toEqual({ x: 6, y: 6, width: 10, height: 10 });
  });
});

describe('scaleBoxToSource', () => {
  it('썸네일 좌표를 원본으로 되돌리되 여유를 둔다 — 1px 오판이 내용을 깎으면 안 된다', () => {
    const box = scaleBoxToSource({ x: 10, y: 10, width: 20, height: 20 }, 40, 40, 400, 400);
    expect(box.x).toBeLessThanOrEqual(100);
    expect(box.x + box.width).toBeGreaterThanOrEqual(300);
  });
  it('원본 밖으로 나가지 않는다', () => {
    const box = scaleBoxToSource({ x: 0, y: 0, width: 40, height: 40 }, 40, 40, 400, 300);
    expect(box).toMatchObject({ x: 0, y: 0, width: 400, height: 300 });
  });
});
