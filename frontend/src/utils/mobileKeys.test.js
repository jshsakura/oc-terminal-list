import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MOBILE_KEYS,
  KEY_PRESETS,
  TMUX_KEYS,
  mobileKeysFor,
  syncMuxKeys,
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

/* ── 멀티플렉서 프리픽스 키 ─────────────────────────────────────────────────
 * ⚠️ **한때 이중 프리픽스(`^B^B`)를 잠그던 자리다.** 그 전제("이 앱의 pane 은 언제나
 * tmux 클라이언트 안")가 사라졌다 — 지금은 고른 멀티플렉서 하나만 깔고, herdr 를 고르면
 * 팬이 herdr 를 직접 실행한다. 바깥 tmux 가 없으므로 프리픽스는 하나다.
 *
 * 이 실수는 어느 방향이든 **조용하다** — 키를 눌러도 아무 일이 안 일어날 뿐이라 사용자는
 * 멀티플렉서 설정을 의심한다. 그래서 양쪽 다 여기서 막는다.
 */
describe('멀티플렉서 프리픽스 키', () => {
  const all = [...TMUX_KEYS];

  it('프리셋이 실제로 들어 있다', () => {
    expect(TMUX_KEYS.length).toBeGreaterThan(0);
  });

  /* herdr 도 프리픽스가 `C-b` 로 같지만 **뒤 글자가 다르다**(`H·c`=new_tab vs
     `T·c`=새 윈도우). 섞어 두면 눌러도 아무 일이 없는 키가 바에 남고 그 실패는 조용하다.
     herdr 를 쓰는 사람은 커스텀 키로 넣는다. */
  it('herdr 프리셋은 싣지 않는다', () => {
    expect(KEY_PRESETS.some((k) => String(k.label).startsWith('H·'))).toBe(false);
  });

  it('프리픽스는 하나다 — 바깥 tmux 가 없다', () => {
    for (const k of all) {
      expect(k.payload.startsWith('\x02'), `${k.label} 이 ^B 로 시작하지 않는다`).toBe(true);
      expect(k.payload.startsWith('\x02\x02'), `${k.label} 이 이중 프리픽스다 — 안쪽이 두 번째를 명령 키로 읽는다`)
        .toBe(false);
    }
  });

  it('프리픽스 뒤에 키가 정확히 하나다', () => {
    for (const k of all) {
      expect(k.payload.slice(1), `${k.label} 의 키가 한 글자가 아니다`).toHaveLength(1);
    }
  });

  it('한 묶음 안에서 같은 키를 두 번 등록하지 않는다', () => {
    for (const group of [TMUX_KEYS]) {
      const keys = group.map((k) => k.payload);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

/* ── 기본 퀵바가 고른 멀티플렉서를 따라간다 ────────────────────────────────
 * tmux 사용자의 바에 herdr 키가 남으면 눌러도 아무 일이 없다. 그 실패는 조용하므로
 * 여기서 막는다.
 */
describe('mobileKeysFor', () => {
  const labels = (mux) => mobileKeysFor(mux).map((k) => k.label);

  it('tmux 면 tmux 키가 실린다', () => {
    expect(labels('tmux').some((l) => l?.startsWith('T·'))).toBe(true);
  });

  it('herdr 는 프리셋이 없다 — 눌러도 아무 일이 없는 키를 싣지 않는다', () => {
    expect(mobileKeysFor('herdr')).toEqual(DEFAULT_MOBILE_KEYS);
  });

  it('none 은 프리픽스라는 개념이 없다 — 공통 키만', () => {
    expect(mobileKeysFor('none')).toEqual(DEFAULT_MOBILE_KEYS);
  });

  it('모르는 값이면 저장소 기본(tmux)으로 접는다', () => {
    expect(labels('zellij')).toEqual(labels('tmux'));
  });

  it('공통 키를 잃지 않는다 — 붙이는 것이지 갈아치우는 것이 아니다', () => {
    for (const base of DEFAULT_MOBILE_KEYS) {
      expect(mobileKeysFor('tmux')).toContainEqual(base);
    }
  });

  it('붙인 키가 sanitize 를 통과한다', () => {
    const out = sanitizeMobileKeys(mobileKeysFor('tmux'));
    expect(out.some((k) => k.label?.startsWith('T·'))).toBe(true);
  });

  it('id 가 겹치지 않는다 — 겹치면 React key 가 무너진다', () => {
    const ids = mobileKeysFor('herdr').map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ── 이미 저장된 바에 심기 ─────────────────────────────────────────────────
 * 기본값만 바꾸면 **이미 저장된 사용자에게는 영영 안 나온다**(`mobileKeys` 는 첫 실행에
 * 저장된다). 실제로 그래서 "퀵바 단축키 왜 안 들어가냐" 가 나왔다. 초기화로 밀면 손본
 * 배열이 날아가므로, 덧붙이기만 한다.
 */
describe('syncMuxKeys', () => {
  const saved = [
    { id: 'cmd', kind: 'cmdInput' },
    { id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' },
  ];

  it('아직 안 심었으면 심는다', () => {
    const { keys, seededFor } = syncMuxKeys(saved, 'tmux', null);
    expect(seededFor).toBe('tmux');
    expect(keys.some((k) => k.label?.startsWith('T·'))).toBe(true);
  });

  it('사용자가 손본 키는 하나도 안 잃는다 — 덧붙이는 것이지 갈아치우는 게 아니다', () => {
    const { keys } = syncMuxKeys(saved, 'herdr', null);
    for (const k of saved) expect(keys).toContainEqual(k);
    expect(keys.slice(0, saved.length)).toEqual(saved);   // 순서도 그대로
  });

  it('같은 멀티플렉서로 다시 부르면 아무것도 안 한다', () => {
    /* ⚠️ 매번 심으면 사용자가 지운 키가 계속 되살아나 **지울 방법이 없어진다.** */
    const first = syncMuxKeys(saved, 'tmux', null);
    const again = syncMuxKeys(first.keys, 'tmux', first.seededFor);
    expect(again.keys).toBe(first.keys);                  // 같은 참조 = 리렌더도 없다
  });

  it('멀티플렉서를 바꾸면 옛 키를 걷는다', () => {
    /* herdr 에는 프리셋이 없다 — tmux 키가 **걷혀야** 한다. 남겨 두면 눌러도 아무 일이
       없는 키가 바에 남고, 그 실패는 조용하다. */
    const first = syncMuxKeys(saved, 'tmux', null);
    expect(first.keys.some((k) => k.label?.startsWith('T·'))).toBe(true);
    const { keys } = syncMuxKeys(first.keys, 'herdr', first.seededFor);
    expect(keys.some((k) => k.label?.startsWith('T·'))).toBe(false);
    for (const k of saved) expect(keys).toContainEqual(k);
  });

  it('none 으로 바꾸면 걷어내기만 한다', () => {
    const first = syncMuxKeys(saved, 'tmux', null);
    const { keys, seededFor } = syncMuxKeys(first.keys, 'none', first.seededFor);
    expect(keys.some((k) => k.label?.startsWith('T·'))).toBe(false);
    expect(seededFor).toBe('none');
    expect(keys).toEqual(saved);
  });

  it('사용자가 프리셋에서 손수 넣은 같은 키는 안 건드린다', () => {
    /* 우리가 심은 것은 `mux_` id 로 알아본다. 사용자가 넣은 것은 id 가 다르다. */
    const mine = [...saved, { id: 'custom1', kind: 'send', label: 'H·c', payload: '\x02c' }];
    const { keys } = syncMuxKeys(mine, 'herdr', 'tmux');
    expect(keys).toContainEqual({ id: 'custom1', kind: 'send', label: 'H·c', payload: '\x02c' });
  });

  it('심은 결과가 sanitize 를 통과한다', () => {
    const { keys } = syncMuxKeys(saved, 'tmux', null);
    expect(sanitizeMobileKeys(keys).some((k) => k.label?.startsWith('T·'))).toBe(true);
  });

  it('배열이 아니면 그대로 돌려준다', () => {
    expect(syncMuxKeys(null, 'herdr', null).keys).toBe(null);
  });
});
