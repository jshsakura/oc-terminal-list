import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { styles as settingsStyles } from './settingsStyles';
import { Section } from './SettingsFields';
import { HELP_TOPICS } from './helpTopics';
import { sentenceLines, KEEP_WORDS_TOGETHER } from '../../utils/sentenceLines';

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
      ) : (
        /* Collapsible Sections are cards, and cards need the stack's gap. Rendered bare,
           eleven of them stand edge to edge and every seam shows two 1px borders — it
           reads as a broken grid under the search box, not as a list. */
        <div style={settingsStyles.cardStack}>
          {sections.map((section, index) => (
            <Section
              /* Remount only when entering or leaving search — Section keeps `open` in
                 its own state, so a changed defaultOpen does not reopen a mounted one.
                 Remounting per keystroke would flicker the list while typing, so only
                 "are we searching" rides the key. */
              key={`${section.id}-${searching ? 'q' : ''}`}
              title={section.title}
              collapsible
              // Everything opens while searching — a hit that stays folded is a miss.
              defaultOpen={index === 0 || searching}
            >
              <div style={S.list}>
                {section.entries.map((entry) => (
                  <div key={entry.key} style={S.item}>
                    <div style={S.term}>{entry.term}</div>
                    {/* A sentence per line. Korean offers no spaces to wrap on, so left
                        to the browser these break mid-word and read as typos. */}
                    {sentenceLines(entry.desc).map((line) => (
                      <div key={line} style={S.desc}>{line}</div>
                    ))}
                  </div>
                ))}
              </div>
            </Section>
          ))}
        </div>
      )}
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
    ...KEEP_WORDS_TOGETHER,
  },
};

export default HelpPanel;
