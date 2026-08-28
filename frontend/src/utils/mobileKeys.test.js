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

  it('기본 키셋의 빠른입력 버튼은 고정 영역이다 — 스크롤에 밀려 사라지면 안 된다', () => {
    const { pinnedKey } = splitPinnedAndScroll(DEFAULT_MOBILE_KEYS);
    expect(pinnedKey?.kind).toBe('cmdInput');
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
    expect(result).not.toBe(DEFAULT_MOBILE_KEYS);
    expect(result.some((k) => k.id === 'mykey')).toBe(true);
  });

  /* ⚠️ 도크가 상시 노출이던 시절엔 여기서 빠른입력 버튼을 **걷어냈다.** 도크를 되돌린
     지금 그대로 두면, 그 사이 설정이 한 번이라도 저장된 사용자는 배열에 버튼이 없고
     sanitize 가 넣어 주지도 않아 **모바일에서 입력할 방법이 아예 없다.** */
  it('빠른입력 버튼이 없는 저장된 설정에는 되돌려 넣는다', () => {
    const result = sanitizeMobileKeys([{ id: 'mykey', kind: 'send', label: 'MY', payload: 'x' }]);
    expect(result[0].kind).toBe('cmdInput');
    expect(result.some((k) => k.id === 'mykey')).toBe(true);
  });

  it('이미 있으면 하나뿐이고 자리도 그대로다', () => {
    const result = sanitizeMobileKeys([
      { id: 'mykey', kind: 'send', label: 'MY', payload: 'x' },
      { id: 'cmd', kind: 'cmdInput', tone: 'accent' },
    ]);
    expect(result.filter((k) => k.kind === 'cmdInput')).toHaveLength(1);
    expect(result[1].kind).toBe('cmdInput');   // 사용자가 둔 자리를 옮기지 않는다
  });

  it('빠른입력 버튼만 있던 설정은 그대로 둔다 — 그것만으로도 입력은 된다', () => {
    const result = sanitizeMobileKeys([{ id: 'cmd', kind: 'cmdInput' }]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('cmdInput');
  });

  it('DEFAULT_MOBILE_KEYS를 직접 수정하지 않고 새 배열을 반환한다 (비정상 입력)', () => {
    const result = sanitizeMobileKeys(null);
    expect(result).toBe(DEFAULT_MOBILE_KEYS);
  });
});


describe('맨 앞/뒤 구분자', () => {
  it('맨 앞 구분자를 걷어낸다 — 아무것도 나누지 않는 선이다', () => {
    /* ⚠️ 구분자 정리는 빠른입력 버튼을 되돌리기 **전에** 돈다. 뒤에 하면 되돌린
       버튼이 맨 앞을 차지해, 홀로 남은 선이 "가운데 구분자" 로 보여 영영 안 걷힌다. */
    const out = sanitizeMobileKeys([
      { id: 'sep1', kind: 'sep' },
      { id: 'left', kind: 'send', label: '←', payload: 'x' },
    ]);
    expect(out.some((k) => k.kind === 'sep')).toBe(false);
    expect(out.map((k) => k.kind)).toEqual(['cmdInput', 'send']);
  });

  it('맨 뒤 구분자도 걷어낸다', () => {
    const out = sanitizeMobileKeys([
      { id: 'left', kind: 'send', label: '←', payload: 'x' },
      { id: 'sepEnd', kind: 'sep' },
    ]);
    expect(out[out.length - 1].kind).not.toBe('sep');
  });

  it('가운데 구분자는 남긴다 — 거기서는 실제로 그룹을 나눈다', () => {
    const out = sanitizeMobileKeys([
      { id: 'a', kind: 'send', label: 'A', payload: 'a' },
      { id: 'mid', kind: 'sep' },
      { id: 'b', kind: 'send', label: 'B', payload: 'b' },
    ]);
    expect(out.some((k) => k.kind === 'sep')).toBe(true);
  });

  it('구분자만 있던 설정은 기본 키셋으로 — 빈 툴바를 만들지 않는다', () => {
    expect(sanitizeMobileKeys([{ id: 's', kind: 'sep' }])).toBe(DEFAULT_MOBILE_KEYS);
  });

  it('기본 키셋은 구분자로 시작하지도 끝나지도 않는다', () => {
    expect(DEFAULT_MOBILE_KEYS[0].kind).not.toBe('sep');
    expect(DEFAULT_MOBILE_KEYS[DEFAULT_MOBILE_KEYS.length - 1].kind).not.toBe('sep');
  });
});
