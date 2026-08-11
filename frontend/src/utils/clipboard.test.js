import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard } from './clipboard';

const setClipboard = (impl) => {
  Object.defineProperty(navigator, 'clipboard', { value: impl, configurable: true, writable: true });
};

describe('copyToClipboard', () => {
  let execCommand;

  beforeEach(() => {
    execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
  });

  afterEach(() => {
    setClipboard(undefined);
    document.body.innerHTML = '';
  });

  it('uses the async clipboard API when it works', async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });

    expect(await copyToClipboard('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when the API rejects (embedded webview / denied)', async () => {
    setClipboard({ writeText: vi.fn(async () => { throw new Error('NotAllowedError'); }) });

    expect(await copyToClipboard('hello')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back when there is no clipboard API at all (plain-http origin)', async () => {
    setClipboard(undefined);

    expect(await copyToClipboard('hello')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('reports failure instead of throwing when every path fails', async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn(() => false);

    expect(await copyToClipboard('hello')).toBe(false);
  });

  it('selects the text through a Range — iOS ignores textarea.select()', async () => {
    setClipboard(undefined);
    const addRange = vi.fn();
    const removeAllRanges = vi.fn();
    document.getSelection = () => ({ rangeCount: 0, addRange, removeAllRanges, getRangeAt: () => null });

    await copyToClipboard('hello');
    expect(addRange).toHaveBeenCalled();
  });

  it('leaves no scratch element behind', async () => {
    setClipboard(undefined);
    await copyToClipboard('hello');
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('restores the selection the user already had', async () => {
    setClipboard(undefined);
    const saved = { id: 'user-range' };
    const addRange = vi.fn();
    document.getSelection = () => ({
      rangeCount: 1, addRange, removeAllRanges: vi.fn(), getRangeAt: () => saved,
    });

    await copyToClipboard('hello');
    expect(addRange).toHaveBeenLastCalledWith(saved);
  });

  it('refuses empty text without touching anything', async () => {
    const writeText = vi.fn();
    setClipboard({ writeText });

    expect(await copyToClipboard('')).toBe(false);
    expect(await copyToClipboard(null)).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });
});
