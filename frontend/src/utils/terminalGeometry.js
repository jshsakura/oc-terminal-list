/**
 * 픽셀 ↔ 터미널 셀 좌표 변환. 휠/터치 스크롤 라우팅과 마우스 선택이 공유한다.
 *
 * 순수 계산만 한다 — term 을 읽기만 하고 아무것도 바꾸지 않는다.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// WheelEvent.deltaMode 상수 — 브라우저가 픽셀/줄/페이지 중 무엇으로 델타를 주는지.
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

// 렌더러가 셀 높이를 아직 모를 때(초기 프레임 등) 쓰는 최후 폴백.
const FALLBACK_CELL_HEIGHT = 17;
const FALLBACK_CELL_WIDTH = 9;

const createTerminalGeometry = (term) => {
  const cellDims = () => term._core?._renderService?.dimensions?.css?.cell;

  const getCellHeight = () => (
    cellDims()?.height
    || Math.max(1, Math.round((term.element?.clientHeight || 0) / Math.max(1, term.rows)))
    || FALLBACK_CELL_HEIGHT
  );

  // 휠 델타를 "줄 수" 로 환산. deltaMode 에 따라 단위가 다르다.
  const deltaToLines = (deltaY, deltaMode = 0) => {
    if (deltaMode === DELTA_MODE_LINE) return deltaY;
    if (deltaMode === DELTA_MODE_PAGE) return deltaY * Math.max(1, term.rows);
    return deltaY / getCellHeight();
  };

  // 화면 좌표 → 1-based 셀 좌표(SGR 마우스 리포트가 쓰는 형식).
  // 좌표가 없으면(키보드발 이벤트 등) 화면 중앙으로 친다.
  const cellFromClientPoint = (clientX, clientY) => {
    const screen = term.element?.querySelector('.xterm-screen') || term.element;
    const rect = screen?.getBoundingClientRect?.();
    const dims = cellDims();
    const cellW = dims?.width || Math.max(1, (rect?.width || 0) / Math.max(1, term.cols)) || FALLBACK_CELL_WIDTH;
    const cellH = dims?.height || getCellHeight();
    const x = Number.isFinite(clientX) ? clientX : ((rect?.left || 0) + (rect?.width || 0) / 2);
    const y = Number.isFinite(clientY) ? clientY : ((rect?.top || 0) + (rect?.height || 0) / 2);
    return {
      col: clamp(Math.floor((x - (rect?.left || 0)) / cellW) + 1, 1, Math.max(1, term.cols)),
      row: clamp(Math.floor((y - (rect?.top || 0)) / cellH) + 1, 1, Math.max(1, term.rows)),
    };
  };

  // 화면 좌표 → 0-based 버퍼 좌표(스크롤백 포함). term.select() 가 쓰는 형식.
  const bufferCellFromClientPoint = (clientX, clientY) => {
    const cell = cellFromClientPoint(clientX, clientY);
    return {
      col: cell.col - 1,
      row: (term.buffer?.active?.viewportY || 0) + cell.row - 1,
    };
  };

  return { getCellHeight, deltaToLines, cellFromClientPoint, bufferCellFromClientPoint };
};

export default createTerminalGeometry;
