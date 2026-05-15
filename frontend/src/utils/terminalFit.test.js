import { describe, it, expect, vi } from 'vitest';
import { measureTerminalFit } from './terminalFit';

describe('measureTerminalFit', () => {
  it('uses fractional container dimensions and reports right/bottom remainders', () => {
    const parent = {
      getBoundingClientRect: () => ({ width: 101.5, height: 45.5 }),
    };
    const element = { parentElement: parent };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '0',
    });

    const result = measureTerminalFit({
      element,
      _core: {
        _renderService: {
          dimensions: {
            css: { cell: { width: 10, height: 15 } },
          },
        },
      },
    });

    expect(result).toMatchObject({
      cols: 10,
      rows: 3,
      remainderX: 1.5,
      remainderY: 0.5,
    });
  });
});
