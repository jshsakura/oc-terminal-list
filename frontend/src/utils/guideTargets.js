/**
 * Buttons Terminator may point at ("where is X?"). The id is what `itl spotlight <id>`
 * sends; the element carries it as `data-guide`. The same ids are listed in
 * backend/cli/terminator/guide.md (topic 화면 안내 대상), which is what Terminator reads;
 * guideTargets.test.js keeps the two lists equal.
 */
export const GUIDE_TARGETS = {
  terminator: { ko: '터미네이터는 여기 있습니다', en: 'Terminator is here' },
  settings: { ko: '설정은 여기 있습니다', en: 'Settings are here' },
  'quick-input': { ko: '빠른입력은 여기 있습니다', en: 'Quick input is here' },
  'pane-files': { ko: '파일 패널은 여기를 누릅니다', en: 'Open the file panel here' },
  'files-changes-tab': { ko: '변경사항은 이 탭입니다', en: 'Changes are in this tab' },
  'files-search': { ko: '파일 검색은 여기 있습니다', en: 'Search files here' },
  'pane-split': { ko: '칸 나누기는 여기 있습니다', en: 'Split the pane here' },
  'pane-more': { ko: '닫기·새로고침 등은 이 메뉴에 있습니다', en: 'Close, reload and more are in this menu' },
};

export const guideCaption = (id, language = 'ko') => {
  const entry = GUIDE_TARGETS[id];
  if (!entry) return null;
  return entry[language] || entry.en;
};

/** The first visible element for this id (panes of hidden tabs are display:none). */
export const findGuideElement = (id, root = document) => {
  if (!GUIDE_TARGETS[id]) return null;
  const nodes = root.querySelectorAll(`[data-guide="${id}"]`);
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return node;
  }
  return null;
};
