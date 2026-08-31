import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HelpPanel from './HelpPanel';
import { HELP_TOPICS } from './helpTopics';
import { ko } from '../../i18n/locales/ko';
import { sentenceLines } from '../../utils/sentenceLines';

// 설명은 **문장마다 한 줄**로 그려진다(한국어가 단어 중간에서 잘리지 않게).
// 그래서 조회는 첫 문장으로 한다 — 통째로 찾으면 여러 요소에 걸쳐 있어 못 찾는다.
const firstLine = (text) => sentenceLines(text)[0];

// 실제 한국어 사전을 그대로 쓴다 — 문구가 빠지면 여기서 키 이름이 화면에 나온다.
const t = (key) => ko[key] || key;

describe('HelpPanel', () => {
  it('첫 섹션은 펼쳐서 보여준다 — 전부 접혀 있으면 뭐가 들어 있는지 알 수 없다', () => {
    render(<HelpPanel t={t} />);
    expect(screen.getByText(ko.helpSecCore)).toBeTruthy();
    expect(screen.getByText(ko.helpCoreRelayTerm)).toBeTruthy();
    expect(screen.getByText(firstLine(ko.helpCoreRelayDesc))).toBeTruthy();
  });

  /* The order is the pitch: what only this app can do comes before "tabs and panes".
     Reorder the list and this fails on purpose — the difference is a product decision, not a
     layout detail. */
  it('맨 앞은 이 앱만 할 수 있는 것 — 기본 설명은 그 다음이다', () => {
    render(<HelpPanel t={t} />);
    expect(HELP_TOPICS[0].titleKey).toBe('helpSecCore');
    expect(HELP_TOPICS.findIndex((s) => s.id === 'tools'))
      .toBeLessThan(HELP_TOPICS.findIndex((s) => s.id === 'pane'));
    // 접힌 섹션은 제목만 보인다 — 첫 섹션만 펼쳐 두는 규칙이 지켜지는지.
    expect(screen.getByText(ko.helpSecBasics)).toBeTruthy();
    expect(screen.queryByText(firstLine(ko.helpTabPaneDesc))).toBeNull();
  });

  it('검색은 설명 본문까지 훑는다 — 사람은 기능 이름을 모르는 채로 찾는다', () => {
    render(<HelpPanel t={t} />);
    const box = screen.getByPlaceholderText(ko.helpSearchPlaceholder);
    // "재시작" 이라는 낱말은 helpReloadRestartTerm/Desc 에만 있다.
    fireEvent.change(box, { target: { value: '재시작' } });
    expect(screen.getByText(ko.helpReloadRestartTerm)).toBeTruthy();
    expect(screen.queryByText(ko.helpTabPaneTerm)).toBeNull();
  });

  it('검색 결과는 펼친 채로 나온다 — 접힌 결과는 못 찾은 것과 같다', () => {
    render(<HelpPanel t={t} />);
    fireEvent.change(screen.getByPlaceholderText(ko.helpSearchPlaceholder), {
      target: { value: '붙여넣' },
    });
    expect(screen.getByText(firstLine(ko.helpPasteDesc))).toBeTruthy();
  });

  it('아무것도 안 맞으면 그렇다고 말한다', () => {
    render(<HelpPanel t={t} />);
    fireEvent.change(screen.getByPlaceholderText(ko.helpSearchPlaceholder), {
      target: { value: 'zzzzz-없는-말' },
    });
    expect(screen.getByText(ko.helpNoMatch)).toBeTruthy();
  });

  it('t 가 없어도 죽지 않는다 — 폴백 문구로 그린다', () => {
    render(<HelpPanel t={null} />);
    expect(screen.getByPlaceholderText('Search help')).toBeTruthy();
  });
});
