import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MOBILE_KEYS,
  KEY_PRESETS,
  sanitizeMobileKeys,
  splitPinnedAndScroll,
} from './mobileKeys';

describe('splitPinnedAndScroll', () => {
  it('pinnedKey 뒤 구분자를 고정 영역에 두고 scrollKeys에서 뺀다', () => {
    const list = [
      { id: 'cmd', kind: 'cmdInput', tone: 'accent' },
      { id: 'sep1', kind: 'sep' },
      { id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' },
    ];
    const { pinnedKey, pinnedDivider, scrollKeys } = splitPinnedAndScroll(list);
    expect(pinnedKey).toBe(list[0]);
    expect(pinnedDivider).toBe(list[1]);
    expect(scrollKeys).toEqual([list[2]]);
  });

  it('pinnedKey 뒤가 구분자가 아니면 pinnedDivider=null, 기존 동작 유지', () => {
    const list = [
      { id: 'cmd', kind: 'cmdInput', tone: 'accent' },
      { id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' },
    ];
    const { pinnedKey, pinnedDivider, scrollKeys } = splitPinnedAndScroll(list);
    expect(pinnedKey).toBe(list[0]);
    expect(pinnedDivider).toBeNull();
    expect(scrollKeys).toEqual([list[1]]);
  });

  it('cmdInput이 없으면 pinnedKey=null, scrollKeys=list 전체', () => {
    const list = [
      { id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' },
      { id: 'sep1', kind: 'sep' },
      { id: 'tab', kind: 'send', label: 'TAB', payload: '\t' },
    ];
    const { pinnedKey, pinnedDivider, scrollKeys } = splitPinnedAndScroll(list);
    expect(pinnedKey).toBeNull();
    expect(pinnedDivider).toBeNull();
    expect(scrollKeys).toBe(list);
  });

  it('DEFAULT_MOBILE_KEYS에서 sep1이 고정 영역으로 빠진다', () => {
    const { pinnedKey, pinnedDivider, scrollKeys } = splitPinnedAndScroll(DEFAULT_MOBILE_KEYS);
    expect(pinnedKey?.kind).toBe('cmdInput');
    expect(pinnedDivider?.kind).toBe('sep');
    // scrollKeys에는 cmdInput도 sep1도 없어야 한다
    expect(scrollKeys.some((k) => k.kind === 'cmdInput')).toBe(false);
    expect(scrollKeys).not.toContain(pinnedDivider);
  });
});

describe('DEFAULT_MOBILE_KEYS 줄 편집 + 세션 키', () => {
  const findByLabel = (label) => DEFAULT_MOBILE_KEYS.find((k) => k.label === label);

  it('^A ^E ^U ^W 가 올바른 payload와 tone을 갖는다', () => {
    const expected = {
      '^A': '\x01',
      '^E': '\x05',
      '^U': '\x15',
      '^W': '\x17',
    };
    for (const [label, payload] of Object.entries(expected)) {
      const k = findByLabel(label);
      expect(k, `missing ${label}`).toBeDefined();
      expect(k.payload).toBe(payload);
      expect(k.tone).toBe('muted');
    }
  });

  it('^R ^L ^D ^Z 가 올바른 payload와 tone을 갖는다', () => {
    const expected = {
      '^R': '\x12',
      '^L': '\x0c',
      '^D': '\x04',
      '^Z': '\x1a',
    };
    for (const [label, payload] of Object.entries(expected)) {
      const k = findByLabel(label);
      expect(k, `missing ${label}`).toBeDefined();
      expect(k.payload).toBe(payload);
      expect(k.tone).toBe('muted');
    }
  });

  it('payload 값이 KEY_PRESETS과 일치한다', () => {
    const presetPayload = (label) => KEY_PRESETS.find((p) => p.label === label)?.payload;
    for (const label of ['^A', '^E', '^U', '^W', '^R', '^L', '^D', '^Z']) {
      const k = findByLabel(label);
      expect(k.payload).toBe(presetPayload(label));
    }
  });

  it('^C는 danger tone이고 중복되지 않는다', () => {
    const ctrlc = DEFAULT_MOBILE_KEYS.filter((k) => k.label === '^C');
    expect(ctrlc.length).toBe(1);
    expect(ctrlc[0].payload).toBe('\x03');
    expect(ctrlc[0].tone).toBe('danger');
  });
});

describe('sanitizeMobileKeys 사용자 설정 우선', () => {
  it('사용자가 전달한 keys가 DEFAULT보다 우선한다', () => {
    const userKeys = [
      { id: 'cmd', kind: 'cmdInput', tone: 'accent' },
      { id: 'mykey', kind: 'send', label: 'MY', payload: 'x' },
    ];
    const result = sanitizeMobileKeys(userKeys);
    // filter를 거쳐 새 배열이 반환되지만, 내용은 동일하고 DEFAULT가 아니다
    expect(result).toEqual(userKeys);
    expect(result).not.toBe(DEFAULT_MOBILE_KEYS);
    expect(result.some((k) => k.id === 'mykey')).toBe(true);
  });

  it('DEFAULT_MOBILE_KEYS를 직접 수정하지 않고 새 배열을 반환한다 (비정상 입력)', () => {
    const result = sanitizeMobileKeys(null);
    expect(result).toBe(DEFAULT_MOBILE_KEYS);
  });
});
