import { describe, it, expect } from 'vitest';
import createTerminalGeometry from './terminalGeometry';

/* 픽셀 ↔ 셀 좌표 변환. 여기가 틀어지면 tmux/vim 으로 보내는 SGR 마우스 리포트가 엉뚱한
   칸을 가리키고(휠 스크롤이 다른 pane 을 긁는다), 드래그 선택 범위도 어긋난다. */

// 셀 10x20px, 화면은 (100, 50) 에서 시작하는 800x400 영역 = 80칸 x 20줄.
const makeTerm = (over = {}) => {
  const screen = {
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 400 }),
  };
  return {
    cols: 80,
    rows: 20,
    element: {
      clientHeight: 400,
      querySelector: () => screen,
    },
    buffer: { active: { viewportY: 0 } },
    _core: { _renderService: { dimensions: { css: { cell: { width: 10, height: 20 } } } } },
    ...over,
  };
};

describe('deltaToLines', () => {
  it('픽셀 델타(deltaMode=0)를 셀 높이로 나눠 줄 수로 만든다', () => {
    const { deltaToLines } = createTerminalGeometry(makeTerm());
    expect(deltaToLines(60, 0)).toBe(3); // 60px / 20px = 3줄
    expect(deltaToLines(-40, 0)).toBe(-2);
  });

  it('줄 델타(deltaMode=1)는 그대로 쓴다', () => {
    const { deltaToLines } = createTerminalGeometry(makeTerm());
    expect(deltaToLines(3, 1)).toBe(3);
  });

  it('페이지 델타(deltaMode=2)는 한 화면(rows)만큼으로 친다', () => {
    const { deltaToLines } = createTerminalGeometry(makeTerm());
    expect(deltaToLines(2, 2)).toBe(40); // 2페이지 x 20줄
  });

  it('렌더러가 셀 높이를 아직 모르면 element 높이/rows 로 추정한다', () => {
    // 초기 프레임에는 _renderService 치수가 없다.
    const { deltaToLines } = createTerminalGeometry(makeTerm({ _core: {} }));
    expect(deltaToLines(60, 0)).toBe(3); // 400px / 20rows = 20px per cell
  });
});

describe('cellFromClientPoint', () => {
  it('화면 좌표를 1-based 셀 좌표로 바꾼다 (SGR 리포트 형식)', () => {
    const { cellFromClientPoint } = createTerminalGeometry(makeTerm());
    // 화면 좌상단 = 1행 1열
    expect(cellFromClientPoint(100, 50)).toEqual({ col: 1, row: 1 });
    // 좌에서 35px, 위에서 45px → 4번째 칸, 3번째 줄
    expect(cellFromClientPoint(135, 95)).toEqual({ col: 4, row: 3 });
  });

  it('화면 밖 좌표는 터미널 경계로 클램프한다', () => {
    const { cellFromClientPoint } = createTerminalGeometry(makeTerm());
    expect(cellFromClientPoint(-500, -500)).toEqual({ col: 1, row: 1 });
    expect(cellFromClientPoint(99999, 99999)).toEqual({ col: 80, row: 20 });
  });

  it('좌표가 없으면(키보드발 이벤트 등) 화면 중앙으로 친다', () => {
    const { cellFromClientPoint } = createTerminalGeometry(makeTerm());
    expect(cellFromClientPoint(undefined, undefined)).toEqual({ col: 41, row: 11 });
  });
});

describe('bufferCellFromClientPoint', () => {
  it('0-based 로 바꾸고 스크롤백 오프셋(viewportY)을 더한다', () => {
    const { bufferCellFromClientPoint } = createTerminalGeometry(makeTerm());
    expect(bufferCellFromClientPoint(135, 95)).toEqual({ col: 3, row: 2 });
  });

  it('스크롤이 내려가 있으면 그만큼 버퍼 행이 밀린다', () => {
    // 위로 500줄 스크롤한 상태에서 같은 화면 좌표는 버퍼상 500줄 아래를 가리킨다.
    const term = makeTerm({ buffer: { active: { viewportY: 500 } } });
    const { bufferCellFromClientPoint } = createTerminalGeometry(term);
    expect(bufferCellFromClientPoint(135, 95)).toEqual({ col: 3, row: 502 });
  });
});
