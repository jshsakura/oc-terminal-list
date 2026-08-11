import { describe, it, expect } from 'vitest';
import { claimChunkReload, isChunkLoadError, RELOAD_GUARD_KEY, RELOAD_GUARD_MS } from './chunkReload';

const fakeStorage = (initial = {}) => {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    read: (k) => store[k],
  };
};

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: /assets/Terminal-abc.js',
    'Loading chunk 42 failed',
    'Importing a module script failed.',
    'error loading dynamically imported module',
    "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\"",
  ])('recognises %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('does not recognise ordinary render errors', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
  });

  it('survives a thrown non-Error', () => {
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('boom')).toBe(false);
  });
});

describe('claimChunkReload', () => {
  const chunkError = new Error('Failed to fetch dynamically imported module: /assets/x.js');

  it('claims and stamps the guard on the first chunk error', () => {
    const storage = fakeStorage();
    expect(claimChunkReload(chunkError, { storage, now: 1_000 })).toBe(true);
    expect(storage.read(RELOAD_GUARD_KEY)).toBe('1000');
  });

  it('refuses a second claim inside the guard window — a persistent failure must not loop', () => {
    const storage = fakeStorage();
    claimChunkReload(chunkError, { storage, now: 1_000 });
    expect(claimChunkReload(chunkError, { storage, now: 1_000 + RELOAD_GUARD_MS - 1 })).toBe(false);
  });

  it('claims again once the window has passed', () => {
    const storage = fakeStorage();
    claimChunkReload(chunkError, { storage, now: 1_000 });
    expect(claimChunkReload(chunkError, { storage, now: 1_000 + RELOAD_GUARD_MS })).toBe(true);
  });

  it('never claims for a non-chunk error', () => {
    const storage = fakeStorage();
    expect(claimChunkReload(new TypeError('x is not a function'), { storage, now: 1 })).toBe(false);
    expect(storage.read(RELOAD_GUARD_KEY)).toBeUndefined();
  });

  it('still claims when storage is unavailable — recovery beats loop protection', () => {
    expect(claimChunkReload(chunkError, { storage: null, now: 1 })).toBe(true);
  });

  it('shares one guard across boundaries — the second catcher stands down', () => {
    // PaneErrorBoundary and LazyErrorBoundary can both catch the same broken deploy.
    const storage = fakeStorage();
    expect(claimChunkReload(chunkError, { storage, now: 5_000 })).toBe(true);
    expect(claimChunkReload(chunkError, { storage, now: 5_010 })).toBe(false);
  });
});
