import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { styles as settingsStyles } from './settingsStyles';
import { Section } from './SettingsFields';
import { HELP_TOPICS } from './helpTopics';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

/**
 * 도움말 — "이 버튼이 뭘 하는 건가" 의 답이 모여 있는 곳.
 *
 * 왜 필요했나: 아이콘 위의 `title` 은 **터치 기기에서 아예 안 뜬다.** 폰으로 처음 열어본
 * 사람에게 이 앱은 설명이 하나도 없는 화면이었다. 검색 가능한 목록 하나면 적어도
 * "어디서 찾지" 가 없어진다.
 *
 * 첫 섹션만 펼쳐 둔다 — 전부 펼치면 스크롤 벽이고, 전부 접으면 뭐가 들어 있는지 안 보인다.
 */
const HelpPanel = ({ t }) => {
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  // 검색은 **번역된 문구** 위에서 한다 — 사용자가 기억하는 건 키가 아니라 화면의 말이다.
  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return HELP_TOPICS.map((section) => {
      const entries = section.entries
        .map((entry) => ({
          key: entry.termKey,
          term: t?.(entry.termKey) || entry.termKey,
          desc: t?.(entry.descKey) || '',
        }))
        .filter((entry) => !needle
          || entry.term.toLowerCase().includes(needle)
          || entry.desc.toLowerCase().includes(needle));
      return { ...section, title: t?.(section.titleKey) || section.titleKey, entries };
    }).filter((section) => section.entries.length > 0);
  }, [query, t]);

  return (
    <>
      <div style={S.searchRow}>
        <Search size={13} strokeWidth={2} style={{ color: color.subtext, flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t?.('helpSearchPlaceholder') || 'Search help'}
          aria-label={t?.('helpSearchPlaceholder') || 'Search help'}
          style={S.searchInput}
        />
      </div>

      {sections.length === 0 ? (
        <div style={settingsStyles.empty}>{t?.('helpNoMatch') || 'Nothing matched.'}</div>
      ) : sections.map((section, index) => (
        <Section
          /* 검색 모드에 들어가고 나올 때만 remount — Section 의 open 은 내부 state 라
             defaultOpen 이 바뀌어도 이미 마운트된 것은 안 열린다. 매 글자마다 remount
             하면 입력 중 목록이 깜빡이므로 "검색 중인가" 여부만 key 에 싣는다. */
          key={`${section.id}-${searching ? 'q' : ''}`}
          title={section.title}
          collapsible
          // 검색 중에는 전부 펼친다 — 찾은 결과가 접힌 채로 있으면 못 찾은 것과 같다.
          defaultOpen={index === 0 || searching}
        >
          <div style={S.list}>
            {section.entries.map((entry) => (
              <div key={entry.key} style={S.item}>
                <div style={S.term}>{entry.term}</div>
                <div style={S.desc}>{entry.desc}</div>
              </div>
            ))}
          </div>
        </Section>
      ))}
    </>
  );
};

const S = {
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: space['2'],
    padding: `0 ${space['3']}`,
    height: '32px',
    marginBottom: space['3'],
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: color.text,
    fontFamily: font.sans,
    fontSize: fontSize['12'],
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: space['3'],
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  term: {
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  desc: {
    fontSize: fontSize['11'],
    lineHeight: 1.55,
    color: color.subtext,
  },
};

export default HelpPanel;
