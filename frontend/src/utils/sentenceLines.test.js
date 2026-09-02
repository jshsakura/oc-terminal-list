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

  /* ⚠️ **줄 수를 세지 않는다.** 한때 "두 줄로 갈린다" 를 못 박았는데, 그 문구를 한 줄로
     줄이자(`87fe590`) 함수는 멀쩡한데 테스트만 빨개졌다. 문구는 앞으로도 다듬어질 값이다
     — 여기서 지켜야 하는 것은 **쪼개는 과정에서 글자가 사라지지 않는다** 는 쪽이다. */
  it('실제 메뉴 문구를 쪼개도 내용이 사라지지 않는다 — 이 함수가 쓰이는 자리', () => {
    const squash = (t) => t.trim().replace(/\s+/g, ' ');
    const hints = Object.entries(ko).filter(
      ([key, value]) => key.endsWith('Hint') && typeof value === 'string' && value.trim());

    expect(hints.length, '검사할 문구가 없다 — 키 이름 규칙이 바뀌었나').toBeGreaterThan(5);
    for (const [key, text] of hints) {
      const lines = sentenceLines(text);
      expect(lines.length, key).toBeGreaterThan(0);
      expect(lines.every((line) => line.trim()), `${key}: 빈 줄`).toBe(true);
      expect(lines.join(' '), key).toBe(squash(text));
    }
  });

  it('한 문장이면 한 줄, 두 문장이면 두 줄', () => {
    expect(sentenceLines('화면만 다시 그립니다')).toHaveLength(1);
    expect(sentenceLines('셸을 새로 엽니다. 작업은 종료됩니다.')).toHaveLength(2);
  });
});
