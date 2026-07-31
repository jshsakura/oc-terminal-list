import { describe, it, expect } from 'vitest';
import { derivePaneLabel, isEmptyPane } from './paneLabel';

const hosts = [{ id: 'h1', name: 'web-app-01' }];
// 실제 앱의 t 처럼 키를 번역해 돌려준다. 폴백 인자 없이 호출되는 자리가 있어서
// (k, f) => f || k 식 더미로는 "번역기가 없는 상황"을 흉내내게 된다.
// 주석에 번역 호출 문법을 그대로 적으면 locales 테스트가 그걸 실제 키로 긁어간다 — 쓰지 말 것.
const DICT = { thisMachine: 'This machine', startSession: 'Empty' };
const t = (k, f) => DICT[k] || f || k;

describe('derivePaneLabel', () => {
  it('사용자가 직접 지은 이름이 최우선', () => {
    expect(derivePaneLabel({ manualName: true, name: '내 작업', hostId: 'h1' }, { hosts, t })).toBe('내 작업');
  });

  it('호스트 pane 은 호스트 이름', () => {
    expect(derivePaneLabel({ hostId: 'h1' }, { hosts, t })).toBe('web-app-01');
  });

  it('로컬 pane 은 This machine 설정 이름', () => {
    expect(derivePaneLabel({ sessionId: 's1' }, { settings: { localName: '내 서버' }, t })).toBe('내 서버');
  });

  it('로컬 이름이 비어 있으면 폴백', () => {
    expect(derivePaneLabel({ sessionId: 's1' }, { settings: { localName: '   ' }, t })).toBe('This machine');
  });

  it('모르는 호스트면 폴백까지 내려간다 (빈 문자열 반환 금지)', () => {
    expect(derivePaneLabel({ hostId: 'gone' }, { hosts, t })).toBe('Empty');
  });

  it('인자가 비어도 터지지 않는다', () => {
    expect(derivePaneLabel(null)).toBe('Empty');
  });
});

describe('isEmptyPane', () => {
  it('세션도 호스트도 없으면 빈 pane', () => {
    expect(isEmptyPane({ id: 'p1' })).toBe(true);
    expect(isEmptyPane({ id: 'p1', sessionId: 's1' })).toBe(false);
    expect(isEmptyPane({ id: 'p1', hostId: 'h1' })).toBe(false);
  });
});
