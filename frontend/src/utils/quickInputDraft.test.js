import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadDraft, saveDraft, clearDraft } from './quickInputDraft';

const KEY = 'iterm:quickInputDraft:v1';

describe('quickInputDraft', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  test('returns an empty string when nothing was saved', () => {
    expect(loadDraft()).toBe('');
  });

  test('round-trips the draft so a reload can restore it', () => {
    saveDraft('git pull && ./deploy/local-deploy.sh');

    expect(loadDraft()).toBe('git pull && ./deploy/local-deploy.sh');
  });

  test('drops the key when the draft becomes empty', () => {
    saveDraft('half typed');
    saveDraft('');

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadDraft()).toBe('');
  });

  test('clearDraft removes a stored draft', () => {
    saveDraft('rm -rf /tmp/scratch');
    clearDraft();

    expect(loadDraft()).toBe('');
  });

  test('caps a runaway paste instead of filling localStorage', () => {
    saveDraft('x'.repeat(50000));

    expect(loadDraft()).toHaveLength(32768);
  });

  test('survives storage being unavailable (private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });

    expect(() => saveDraft('anything')).not.toThrow();
    expect(loadDraft()).toBe('');
  });
});
