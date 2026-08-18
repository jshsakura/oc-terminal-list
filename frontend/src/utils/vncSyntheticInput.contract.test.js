import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * 우리 터치패드는 noVNC 캔버스에 **DOM 이벤트를 합성해** 넣는다(공개 포인터 API 가 없다).
 * 그래서 계약이 코드가 아니라 **라이브러리의 리스너 이름과 읽는 필드**에 걸려 있다.
 *
 * noVNC 를 올렸는데 그쪽이 PointerEvent 로 갈아타거나 버튼 비트 해석을 바꾸면, 우리 쪽은
 * 아무 에러 없이 **조용히 아무 일도 안 하게** 된다. 그 순간을 여기서 잡는다.
 */
const rfbSource = () => fs.readFileSync(
  path.resolve(process.cwd(), 'node_modules/@novnc/novnc/core/rfb.js'),
  'utf8',
);

describe('noVNC 입력 계약', () => {
  it('캔버스에서 마우스 이벤트를 듣는다 (우리가 보내는 바로 그 이름들)', () => {
    const src = rfbSource();
    for (const type of ['mousedown', 'mouseup', 'mousemove', 'wheel']) {
      // 따옴표 스타일은 noVNC 안에서도 섞여 있다 — 이름만 본다.
      expect(src, `noVNC 가 ${type} 리스너를 잃었다`)
        .toMatch(new RegExp(`addEventListener\\(["']${type}["']`));
    }
  });

  it('MouseEvent.buttons 비트를 RFB 마스크로 바꾼다 — 우리는 그 비트를 채워 보낸다', () => {
    const src = rfbSource();
    expect(src).toContain('_convertButtonMask(ev.buttons)');
    // 0=왼쪽, 1=오른쪽, 2=가운데. vncSyntheticInput 의 BUTTON_* 이 이 규약을 따른다.
    expect(src).toMatch(/0:\s*1\s*<<\s*0/);
    expect(src).toMatch(/1:\s*1\s*<<\s*2/);
    expect(src).toMatch(/2:\s*1\s*<<\s*1/);
  });

  it('요소 좌표는 getBoundingClientRect 로 되돌린다 — 그래서 우리는 배율을 몰라도 된다', () => {
    const util = fs.readFileSync(
      path.resolve(process.cwd(), 'node_modules/@novnc/novnc/core/util/element.js'),
      'utf8',
    );
    expect(util).toContain('getBoundingClientRect');
    expect(rfbSource()).toContain('clientToElement(ev.clientX, ev.clientY');
  });

  it('화면 요소(우리가 넘긴 컨테이너) 크기를 보고 autoscale 한다 — 확대를 상자 크기로 하는 근거', () => {
    const src = rfbSource();
    expect(src).toContain('this._resizeObserver.observe(this._screen)');
    expect(src).toContain('this._display.autoscale(size.w, size.h)');
  });

  it('핀치는 원격에 Ctrl+휠로 넘긴다 — 뷰어 확대가 아니라서 우리가 따로 만든 것이다', () => {
    const src = rfbSource();
    expect(src).toContain("case 'pinch':");
    expect(src).toContain('KeyTable.XK_Control_L');
  });
});
