import { describe, it, expect } from 'vitest';
import { sentenceLines } from './sentenceLines';
import { ko } from '../i18n/locales/ko';

describe('sentenceLines', () => {
  it('구두점 뒤에서 끊는다', () => {
    expect(sentenceLines('화면만 다시 그립니다. 실행 중인 작업은 그대로입니다.'))
      .toEqual(['화면만 다시 그립니다.', '실행 중인 작업은 그대로입니다.']);
  });

  it('소수점과 말줄임표는 문장 끝이 아니다 — 뒤에 공백이 없다', () => {
    expect(sentenceLines('12.5초 걸립니다.')).toEqual(['12.5초 걸립니다.']);
    expect(sentenceLines('불러오는 중… 잠시만요.')).toEqual(['불러오는 중… 잠시만요.']);
  });

  it('빈 값은 빈 목록', () => {
    expect(sentenceLines('')).toEqual([]);
    expect(sentenceLines(null)).toEqual([]);
    expect(sentenceLines('   ')).toEqual([]);
  });

  it('실제 메뉴 문구가 두 줄로 갈린다 — 이 함수가 쓰이는 자리', () => {
    expect(sentenceLines(ko.refreshTerminalHint)).toHaveLength(2);
    expect(sentenceLines(ko.restartSessionHint)).toHaveLength(2);
  });
});
