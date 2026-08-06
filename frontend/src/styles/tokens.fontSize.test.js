import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from './tokens';

/**
 * A size that is not in the scale silently gets BIGGER.
 *
 * A missing key like `fontSize['10.5']` yields undefined, and an undefined fontSize is
 * ignored — the element renders at the **inherited size** (the browser default of 16px,
 * since there is no global CSS). A label meant to be small becomes the largest text on
 * screen and nothing errors. Every secondary label on the dashboard was in that state,
 * so a source scan guards it.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_RE = /fontSize\[['"]([^'"]+)['"]\]/g;

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  if (statSync(full).isDirectory()) return walk(full);
  // Test files carry example strings, so they are not scanned.
  return /\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry) ? [full] : [];
});

describe('fontSize token scale', () => {
  it('is only referenced with keys that exist', () => {
    const scale = new Set(Object.keys(tokens.fontSize));
    const offenders = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const [, key] of source.matchAll(KEY_RE)) {
        if (!scale.has(key)) offenders.push(`${file.replace(SRC, '')}: fontSize['${key}']`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
