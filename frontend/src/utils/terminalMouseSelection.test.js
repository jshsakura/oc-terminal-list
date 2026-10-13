import { describe, it, expect } from 'vitest';
import {
  shouldUseNaturalMouseSelection,
  selectionArgsFromCells,
  selectionArgsFromEdges,
  shouldRouteWheelToPty,
  shouldClearSelectionOnScroll,
} from './terminalMouseSelection';

describe('terminal mouse selection helpers', () => {
  it('enables natural selection only for plain primary drag in mouse tracking mode', () => {
    expect(shouldUseNaturalMouseSelection({
      event: { button: 0 },
      mouseTrackingMode: 'drag',
    })).toBe(true);

    expect(shouldUseNaturalMouseSelection({
      event: { button: 0, shiftKey: true },
      mouseTrackingMode: 'drag',
    })).toBe(false);

    expect(shouldUseNaturalMouseSelection({
      event: { button: 0 },
      mouseTrackingMode: 'none',
    })).toBe(false);

    expect(shouldUseNaturalMouseSelection({
      event: { button: 0 },
      isMobile: true,
      mouseTrackingMode: 'drag',
    })).toBe(false);
  });

  it('builds forward selection args across wrapped buffer rows', () => {
    expect(selectionArgsFromCells({ col: 4, row: 10 }, { col: 2, row: 12 }, 80)).toEqual({
      column: 4,
      row: 10,
      length: 159,
    });
  });

  it('normalizes backward drags', () => {
    expect(selectionArgsFromCells({ col: 9, row: 5 }, { col: 3, row: 5 }, 80)).toEqual({
      column: 3,
      row: 5,
      length: 7,
    });
  });

  it('excludes the cell after the end edge of a drag', () => {
    // "hello" 를 h 앞 경계(0) 에서 o 뒤 경계(5) 까지 끈다 → 다섯 글자만.
    expect(selectionArgsFromEdges({ col: 0, row: 3 }, { col: 5, row: 3 }, 80)).toEqual({
      column: 0, row: 3, length: 5,
    });
  });

  it('normalizes backward edge drags and spans rows', () => {
    expect(selectionArgsFromEdges({ col: 2, row: 6 }, { col: 78, row: 5 }, 80)).toEqual({
      column: 78, row: 5, length: 4,
    });
  });

  it('selects nothing when the drag returns to its start edge', () => {
    expect(selectionArgsFromEdges({ col: 4, row: 1 }, { col: 4, row: 1 }, 80)).toBeNull();
  });

  it('starts on the next row when the start edge is the end of a line', () => {
    expect(selectionArgsFromEdges({ col: 80, row: 1 }, { col: 3, row: 2 }, 80)).toEqual({
      column: 0, row: 2, length: 3,
    });
  });

  it('routes wheel to the PTY when tmux mouse tracking is active', () => {
    expect(shouldRouteWheelToPty({ bufferType: 'normal', mouseTrackingMode: 'vt200' })).toBe(true);
    expect(shouldRouteWheelToPty({ bufferType: 'alternate', mouseTrackingMode: 'none' })).toBe(true);
    expect(shouldRouteWheelToPty({ bufferType: 'normal', mouseTrackingMode: 'none' })).toBe(false);
  });

  it('clears stale xterm selection when scrolling actually moves', () => {
    expect(shouldClearSelectionOnScroll({ hasSelection: true, lines: 3 })).toBe(true);
    expect(shouldClearSelectionOnScroll({ hasSelection: true, lines: 0 })).toBe(false);
    expect(shouldClearSelectionOnScroll({ hasSelection: false, lines: 3 })).toBe(false);
  });
});
