import { describe, it, expect } from 'vitest';
import { shouldUseNaturalMouseSelection, selectionArgsFromCells } from './terminalMouseSelection';

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
});
