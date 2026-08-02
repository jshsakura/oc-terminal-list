import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { locales } from './locales';

const SRC_ROOT = path.resolve(process.cwd(), 'src');
const SOURCE_EXT_RE = /\.(jsx?|tsx?)$/;
const T_CALL_PATTERNS = [
  /\bt\?\.\(\s*['"]([A-Za-z0-9_.$-]+)['"]/g,
  /\bt\(\s*['"]([A-Za-z0-9_.$-]+)['"]/g,
];

const walkSourceFiles = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(filePath, out);
    } else if (
      SOURCE_EXT_RE.test(entry.name)
      && !filePath.includes(`${path.sep}i18n${path.sep}locales${path.sep}`)
      && !filePath.endsWith(`${path.sep}hooks${path.sep}useTranslation.test.jsx`)
    ) {
      out.push(filePath);
    }
  }
  return out;
};

const collectTranslationKeys = () => {
  const used = new Map();
  for (const filePath of walkSourceFiles(SRC_ROOT)) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const pattern of T_CALL_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const key = match[1];
        const rel = path.relative(SRC_ROOT, filePath);
        used.set(key, [...(used.get(key) || []), rel]);
      }
    }
  }
  return used;
};

describe('locales', () => {
  it('keeps locale key sets in sync', () => {
    const [baseLang, ...otherLangs] = Object.keys(locales);
    const baseKeys = Object.keys(locales[baseLang]).sort();

    for (const lang of otherLangs) {
      expect(Object.keys(locales[lang]).sort(), `${lang} keys should match ${baseLang}`).toEqual(baseKeys);
    }
  });

  it('defines every literal t(...) key used in source', () => {
    const used = collectTranslationKeys();
    for (const [lang, dict] of Object.entries(locales)) {
      const missing = [...used.keys()]
        .filter((key) => !(key in dict))
        .sort()
        .map((key) => `${key} (${[...new Set(used.get(key))].join(', ')})`);

      expect(missing, `${lang} is missing translation keys`).toEqual([]);
    }
  });

  // 동적 키(t?.(`vncStatus_${status}`)) 는 정적 스캐너가 잡지 못한다 — 명시 검증.
  it('defines all vncStatus_* keys (used via template literal, not caught by scanner)', () => {
    const required = [
      'vncStatus_connecting',
      'vncStatus_connected',
      'vncStatus_credentials',
      'vncStatus_disconnected',
      'vncStatus_error',
    ];
    for (const [lang, dict] of Object.entries(locales)) {
      for (const key of required) {
        expect(key in dict, `${lang} missing ${key}`).toBe(true);
        // 값이 키 자체가 아니라 사람이 읽을 수 있는 문자열이어야 한다.
        expect(dict[key], `${lang}.${key} should not be the raw key`).not.toBe(key);
      }
    }
  });
});
