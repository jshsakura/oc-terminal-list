import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MOBILE_KEYS,
  KEY_PRESETS,
  TMUX_KEYS,
  mobileKeysFor,
  migrateMobileKeys,
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


describe('DEFAULT_MOBILE_KEYS — 짧게 유지한다', () => {
  const byLabel = (label) => DEFAULT_MOBILE_KEYS.find((k) => k.label === label);

  /* ⚠️ 폰의 바는 짧다. 스크롤 뒤로 밀린 키는 없는 키다 — 한때 줄편집·세션·PgUp/PgDn·ALT
     까지 전부 실었다가 "쓸데없는 키가 많다" 로 되돌렸다. 전부 프리셋에 있다. */
  it('은퇴한 키는 기본에 없다 — 프리셋에서 골라 넣는 것이다', () => {
    for (const label of ['^A', '^E', '^U', '^W', '^R', '^L', '^D', '^Z', 'PgUp', 'PgDn', 'ALT']) {
      expect(byLabel(label), `${label} 이 기본에 남아 있다`).toBeUndefined();
    }
  });

  it('은퇴한 키는 프리셋에 그대로 있다 — 되찾을 길이 있어야 한다', () => {
    for (const label of ['^A', '^E', '^U', '^W', '^R', '^L', '^D', '^Z', 'PgUp', 'PgDn']) {
      expect(KEY_PRESETS.some((p) => p.label === label), `${label} 프리셋 없음`).toBe(true);
    }
  });

  it('없으면 아예 못 하는 것만 남는다', () => {
    const ids = DEFAULT_MOBILE_KEYS.map((k) => k.id);
    for (const id of ['cmd', 'left', 'up', 'down', 'right',
                      'esc', 'tab', 'enter', 'bs', 'ctrlc', 'ctrl', 'copy', 'paste']) {
      expect(ids, `${id} 가 빠졌다`).toContain(id);
    }
  });

  it('조합키는 ^C 와 CTRL 뿐이다 — 둘 다 없으면 폰에서 못 하는 일이 생긴다', () => {
    const combos = DEFAULT_MOBILE_KEYS.filter(
      (k) => k.kind === 'mod' || (k.label || '').startsWith('^'));
    expect(combos.map((k) => k.id)).toEqual(['ctrlc', 'ctrl']);
  });

  it('^C는 danger tone이고 중복되지 않는다', () => {
    const ctrlc = DEFAULT_MOBILE_KEYS.filter((k) => k.label === '^C');
    expect(ctrlc.length).toBe(1);
    expect(ctrlc[0].payload).toBe('\x03');
    expect(ctrlc[0].tone).toBe('danger');
  });

  it('구분자가 연달아 오지 않는다 — 아무것도 안 나누는 선', () => {
    DEFAULT_MOBILE_KEYS.forEach((k, i) => {
      if (i === 0) return;
      expect(k.kind === 'sep' && DEFAULT_MOBILE_KEYS[i - 1].kind === 'sep').toBe(false);
    });
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
 * ⚠️ **한때 이중 프리픽스(`^B^B`)를 잠그던 자리다.** 그 전제("이 앱의 pane 은 바깥
 * tmux 클라이언트 안")가 사라졌다 — 팬이 붙는 tmux 가 유일한 tmux 다. 프리픽스는 하나다.
 *
 * 이 실수는 어느 방향이든 **조용하다** — 키를 눌러도 아무 일이 안 일어날 뿐이라 사용자는
 * 멀티플렉서 설정을 의심한다. 그래서 양쪽 다 여기서 막는다.
 */
describe('멀티플렉서 프리픽스 키', () => {
  const all = [...TMUX_KEYS];

  it('프리셋이 실제로 들어 있다', () => {
    expect(TMUX_KEYS.length).toBeGreaterThan(0);
  });

  /* 다른 멀티플렉서의 프리픽스 키는 싣지 않는다. 같은 `C-b` 라도 뒤 글자가 달라 섞어 두면
     눌러도 아무 일이 없는 키가 바에 남고 그 실패는 조용하다. 커스텀 키로 넣는다. */
  it('tmux 가 아닌 멀티플렉서 프리셋은 싣지 않는다', () => {
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
 * 바에 tmux 가 모르는 키가 남으면 눌러도 아무 일이 없다. 그 실패는 조용하므로
 * 여기서 막는다.
 */
describe('mobileKeysFor', () => {
  /* ⚠️ **멀티플렉서 키는 기본에 없다.** 한때 tmux 프리픽스 키 여섯 개를 심었는데, 폰의
     짧은 바에서 정작 자주 쓰는 것(엔터·화살표·^C)을 스크롤 뒤로 밀어냈다. 필요하면
     프리셋에서 골라 넣는다 — 고른 사람의 바에만 있는 것이 맞다. */
  it('어떤 멀티플렉서에도 프리픽스 키를 싣지 않는다', () => {
    for (const mux of ['tmux', 'none', 'zellij', undefined]) {   // zellij = 모르는 값
      expect(mobileKeysFor(mux)).toEqual(DEFAULT_MOBILE_KEYS);
    }
  });

  it('엔터와 지우기가 기본에 있다 — 없으면 퀵바만으로 줄을 끝내지도 고치지도 못한다', () => {
    expect(DEFAULT_MOBILE_KEYS.find((k) => k.id === 'enter'))
      .toMatchObject({ kind: 'send', payload: '\r' });
    expect(DEFAULT_MOBILE_KEYS.find((k) => k.id === 'bs'))
      .toMatchObject({ kind: 'send', payload: '\x7f' });
  });

  it('id 가 겹치지 않는다 — 겹치면 React key 가 무너진다', () => {
    const ids = mobileKeysFor('tmux').map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('기본 키셋이 sanitize 를 통과한다', () => {
    expect(sanitizeMobileKeys(mobileKeysFor())).toEqual(DEFAULT_MOBILE_KEYS);
  });
});

/* ── 이미 저장된 바 정리 ───────────────────────────────────────────────────
 * 기본값만 바꾸면 **이미 저장된 사용자에게는 영영 반영되지 않는다**(`mobileKeys` 는 첫
 * 실행에 저장된다). 초기화로 밀면 손본 배열이 날아가므로 한 번만 훑어 고친다.
 */
describe('migrateMobileKeys', () => {
  const saved = [
    { id: 'cmd', kind: 'cmdInput' },
    { id: 'esc', kind: 'send', label: 'ESC', payload: '\x1b' },
    { id: 'tab', kind: 'send', label: 'TAB', payload: '\t' },
    { id: 'sep_mux', kind: 'sep' },
    { id: 'mux_T·c', kind: 'send', label: 'T·c', payload: '\x02c' },
    { id: 'mux_T·z', kind: 'send', label: 'T·z', payload: '\x02z' },
  ];

  it('은퇴한 키와 그 구분자도 걷어낸다 — 옛 기본값이 계속 남아 있으면 안 된다', () => {
    const old = [
      { id: 'cmd', kind: 'cmdInput' },
      { id: 'sep_line', kind: 'sep' },
      { id: 'ctrla', kind: 'send', label: '^A', payload: '\x01' },
      { id: 'pgup', kind: 'send', label: 'PgUp', payload: '\x1b[5~' },
      { id: 'alt', kind: 'mod', label: 'ALT' },
    ];
    const { keys } = migrateMobileKeys(old, null);
    for (const id of ['ctrla', 'pgup', 'alt', 'sep_line']) {
      expect(keys.some((k) => k.id === id), `${id} 가 남았다`).toBe(false);
    }
  });

  it('묶음을 걷어낸 자리에 빈 구분자가 연달아 남지 않는다', () => {
    const old = [
      { id: 'cmd', kind: 'cmdInput' },
      { id: 'sep_line', kind: 'sep' },
      { id: 'ctrla', kind: 'send', label: '^A', payload: '\x01' },
      { id: 'sep_ses', kind: 'sep' },
      { id: 'ctrlr', kind: 'send', label: '^R', payload: '\x12' },
      { id: 'sep3', kind: 'sep' },
      { id: 'copy', kind: 'copy' },
    ];
    const { keys } = migrateMobileKeys(old, null);
    keys.forEach((k, i) => {
      if (i === 0) return;
      expect(k.kind === 'sep' && keys[i - 1].kind === 'sep').toBe(false);
    });
  });

  it('우리가 심었던 멀티플렉서 키와 그 구분자를 걷어낸다', () => {
    const { keys } = migrateMobileKeys(saved, null);
    expect(keys.some((k) => String(k.id).startsWith('mux_'))).toBe(false);
    expect(keys.some((k) => k.id === 'sep_mux')).toBe(false);
  });

  it('엔터와 지우기가 없으면 TAB 뒤에 넣는다', () => {
    const { keys } = migrateMobileKeys(saved, null);
    const at = keys.findIndex((k) => k.id === 'enter');
    expect(at).toBeGreaterThan(-1);
    expect(keys[at - 1].id).toBe('tab');
    expect(keys[at + 1].id).toBe('bs');
  });

  it('길게 눌러 연타되려면 kind 가 send 여야 한다', () => {
    /* 반복은 `send` 키에만 붙는다(MobileToolbar) — kind 를 바꾸면 조용히 안 된다. */
    const { keys } = migrateMobileKeys(saved, null);
    for (const id of ['enter', 'bs']) {
      expect(keys.find((k) => k.id === id).kind).toBe('send');
    }
  });

  it('사용자가 손수 넣은 키는 하나도 안 잃는다', () => {
    const mine = [...saved, { id: 'custom1', kind: 'send', label: 'X', payload: 'x' }];
    const { keys } = migrateMobileKeys(mine, null);
    expect(keys).toContainEqual({ id: 'custom1', kind: 'send', label: 'X', payload: 'x' });
    expect(keys[0]).toEqual(mine[0]);          // 순서도 그대로
  });

  it('한 번 정리했으면 다시 안 건드린다', () => {
    /* ⚠️ 매번 돌면 사용자가 지운 엔터가 계속 되살아나 **지울 방법이 없어진다.** */
    const first = migrateMobileKeys(saved, null);
    const again = migrateMobileKeys(first.keys, first.seededFor);
    expect(again.keys).toBe(first.keys);       // 같은 참조 = 리렌더도 없다
  });

  it('이미 갖고 있으면 두 개로 만들지 않는다', () => {
    const mine = [
      { id: 'enter', kind: 'send', label: '⏎', payload: '\r' },
      { id: 'bs', kind: 'send', label: '⌫', payload: '\x7f' },
    ];
    const { keys } = migrateMobileKeys(mine, null);
    expect(keys.filter((k) => k.id === 'enter')).toHaveLength(1);
    expect(keys.filter((k) => k.id === 'bs')).toHaveLength(1);
  });

  it('정리 결과가 sanitize 를 통과한다', () => {
    const { keys } = migrateMobileKeys(saved, null);
    expect(sanitizeMobileKeys(keys).some((k) => k.id === 'enter')).toBe(true);
  });

  it('배열이 아니면 그대로 둔다', () => {
    expect(migrateMobileKeys(null, null).keys).toBe(null);
  });
});
