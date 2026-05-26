import { describe, expect, it } from 'vitest';
import { isTerminalAutoResponse } from './terminalInput';

describe('isTerminalAutoResponse', () => {
  it('detects primary and secondary device attribute responses', () => {
    expect(isTerminalAutoResponse('\x1b[?1;2c')).toBe(true);
    expect(isTerminalAutoResponse('\x1b[>0;276;0c')).toBe(true);
    expect(isTerminalAutoResponse('\x1b[>0;276;0c\x1b[>0;276;0c')).toBe(true);
    expect(isTerminalAutoResponse('0;276;0c')).toBe(true);
    expect(isTerminalAutoResponse('0;276;0c0;276;0c')).toBe(true);
  });

  it('does not block ordinary input or non-DA escape sequences', () => {
    expect(isTerminalAutoResponse('\x1b[A')).toBe(false);
    expect(isTerminalAutoResponse('\x03')).toBe(false);
    expect(isTerminalAutoResponse('ls -la')).toBe(false);
    expect(isTerminalAutoResponse('echo 0;276;0c')).toBe(false);
  });
});
