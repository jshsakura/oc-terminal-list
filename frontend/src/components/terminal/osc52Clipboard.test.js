import { describe, test, expect, vi, beforeEach } from 'vitest';
import registerOsc52 from './osc52Clipboard';

vi.mock('../../utils/clipboard', () => ({ default: vi.fn(() => Promise.resolve(true)) }));
const clipboard = await import('../../utils/clipboard');

const fakeTerm = () => {
  const handlers = {};
  return {
    parser: {
      registerOscHandler: (code, fn) => {
        handlers[code] = fn;
        return { dispose: vi.fn() };
      },
    },
    fire: (payload) => handlers[52]?.(payload),
  };
};

describe('OSC 52', () => {
  beforeEach(() => { clipboard.default.mockClear(); });

  test('선택한 것이 브라우저 클립보드로 간다', () => {
    const term = fakeTerm();
    registerOsc52(term);
    term.fire(`c;${btoa('hello world')}`);
    expect(clipboard.default).toHaveBeenCalledWith('hello world');
  });

  /* ⚠️ OSC 52 는 클립보드 **읽기**(`?`)도 정의한다. 그건 원격이 사용자 클립보드를
     훔쳐볼 수 있는 통로다 — 다른 창에서 복사해 둔 비밀번호까지. 응답하지 않는다. */
  test('읽기 요청에는 응답하지 않는다', () => {
    const term = fakeTerm();
    registerOsc52(term);
    expect(term.fire('c;?')).toBe(true);
    expect(clipboard.default).not.toHaveBeenCalled();
  });

  test('깨진 payload 는 조용히 버린다 — 화면에 흘리지 않는다', () => {
    const term = fakeTerm();
    registerOsc52(term);
    expect(term.fire('c;!!!not-base64!!!')).toBe(true);
  });

  test('너무 큰 것은 받지 않는다 — 붙여넣기지 파일 전송이 아니다', () => {
    const term = fakeTerm();
    registerOsc52(term);
    term.fire(`c;${'A'.repeat(600 * 1024)}`);
    expect(clipboard.default).not.toHaveBeenCalled();
  });

  test('핸들러가 없는 터미널에서도 터지지 않는다', () => {
    expect(() => registerOsc52({})).not.toThrow();
    expect(() => registerOsc52(null)).not.toThrow();
  });
});
