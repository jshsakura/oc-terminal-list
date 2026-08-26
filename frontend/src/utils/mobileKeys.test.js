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

  it('기본 키셋에는 고정 영역이 없다 — 빠른입력 버튼이 빠졌기 때문', () => {
    /* 입력창이 하단에 상시 도크로 깔리면서 그걸 여는 버튼이 사라졌고, 고정(pinned)
       영역의 유일한 주인이 그 버튼이었다. 이제 키는 전부 스크롤 영역이다. */
    const { pinnedKey, pinnedDivider, scrollKeys } = splitPinnedAndScroll(DEFAULT_MOBILE_KEYS);
    expect(pinnedKey).toBeNull();
    expect(pinnedDivider).toBeNull();
    expect(scrollKeys).toBe(DEFAULT_MOBILE_KEYS);
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
    const userKeys = [{ id: 'mykey', kind: 'send', label: 'MY', payload: 'x' }];
    const result = sanitizeMobileKeys(userKeys);
    expect(result).toEqual(userKeys);
    expect(result).not.toBe(DEFAULT_MOBILE_KEYS);
    expect(result.some((k) => k.id === 'mykey')).toBe(true);
  });

  it('저장된 설정에 남아 있는 빠른입력 버튼은 걷어낸다', () => {
    /* 예전에는 없으면 강제로 끼워 넣었다(지울 수 없었다). 지금은 그 버튼이 여는 것이
       이미 하단에 열려 있으므로, 옛 설정을 들고 있어도 사용자가 손댈 필요 없이 사라진다. */
    const result = sanitizeMobileKeys([
      { id: 'cmd', kind: 'cmdInput', tone: 'accent' },
      { id: 'mykey', kind: 'send', label: 'MY', payload: 'x' },
    ]);
    expect(result.some((k) => k.kind === 'cmdInput')).toBe(false);
    expect(result.some((k) => k.id === 'mykey')).toBe(true);
  });

  it('빠른입력 버튼만 있던 설정은 기본 키셋으로 되돌린다 — 빈 툴바를 만들지 않는다', () => {
    expect(sanitizeMobileKeys([{ id: 'cmd', kind: 'cmdInput' }])).toBe(DEFAULT_MOBILE_KEYS);
  });

  it('DEFAULT_MOBILE_KEYS를 직접 수정하지 않고 새 배열을 반환한다 (비정상 입력)', () => {
    const result = sanitizeMobileKeys(null);
    expect(result).toBe(DEFAULT_MOBILE_KEYS);
  });
});
