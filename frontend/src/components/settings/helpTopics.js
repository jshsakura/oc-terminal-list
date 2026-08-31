/**
 * The contents of the help panel — the answers to "what does this button do".
 *
 * Why keep it as data: copy scattered through JSX (1) gets fixed in one language and
 * left broken in the other, and (2) hides what is explained and what is missing. Here a
 * test can walk it and check **both locales mechanically** (helpTopics.test.js).
 *
 * Copy rules:
 *  - One entry = a name + **one or two sentences**. Longer and nobody reads it.
 *  - Say what you can DO with it, not what it is called ("handle" ✗ / "drag to move it,
 *    click to copy the address" ○).
 *  - Plain declarative voice (합니다체 in Korean) — the register the rest of the app uses.
 *
 * Order is an argument. The first section is what this app does that others cannot:
 * relaying a command from one machine's agent to another's, over sessions that outlive
 * the browser. Filed fifth, behind "tabs and panes", the reader never learns why they
 * would pick this over any other web terminal — so it leads, and the basics follow
 * rather than trailing the feature list.
 */

export const HELP_TOPICS = [
  {
    id: 'core',
    titleKey: 'helpSecCore',
    entries: [
      { termKey: 'helpCoreRelayTerm', descKey: 'helpCoreRelayDesc' },
      { termKey: 'helpCoreTmuxTerm', descKey: 'helpCoreTmuxDesc' },
      { termKey: 'helpCoreFleetTerm', descKey: 'helpCoreFleetDesc' },
      { termKey: 'helpFleetTerm', descKey: 'helpFleetDesc' },
    ],
  },
  {
    id: 'basics',
    titleKey: 'helpSecBasics',
    entries: [
      { termKey: 'helpTabPaneTerm', descKey: 'helpTabPaneDesc' },
      { termKey: 'helpPersistTerm', descKey: 'helpPersistDesc' },
      { termKey: 'helpCloseTerm', descKey: 'helpCloseDesc' },
      { termKey: 'helpMultiDeviceTerm', descKey: 'helpMultiDeviceDesc' },
      { termKey: 'helpHomeTerm', descKey: 'helpHomeDesc' },
      { termKey: 'helpTabNameTerm', descKey: 'helpTabNameDesc' },
    ],
  },
  {
    id: 'tools',
    titleKey: 'helpSecTools',
    entries: [
      { termKey: 'helpToolsTerm', descKey: 'helpToolsDesc' },
      { termKey: 'helpToolsCheckTerm', descKey: 'helpToolsCheckDesc' },
      { termKey: 'helpStatusDotTerm', descKey: 'helpStatusDotDesc' },
    ],
  },
  {
    id: 'pane',
    titleKey: 'helpSecPane',
    entries: [
      { termKey: 'helpRailHistoryTerm', descKey: 'helpRailHistoryDesc' },
      { termKey: 'helpRailSendTerm', descKey: 'helpRailSendDesc' },
      { termKey: 'helpRailFilesTerm', descKey: 'helpRailFilesDesc' },
      { termKey: 'helpRailSplitTerm', descKey: 'helpRailSplitDesc' },
      { termKey: 'helpRailHandleTerm', descKey: 'helpRailHandleDesc' },
      { termKey: 'helpReloadRestartTerm', descKey: 'helpReloadRestartDesc' },
      { termKey: 'helpPaneSearchTerm', descKey: 'helpPaneSearchDesc' },
    ],
  },
  {
    id: 'hosts',
    titleKey: 'helpSecHosts',
    entries: [
      { termKey: 'helpHostAddTerm', descKey: 'helpHostAddDesc' },
      { termKey: 'helpHostTmuxTerm', descKey: 'helpHostTmuxDesc' },
      { termKey: 'helpVncTerm', descKey: 'helpVncDesc' },
    ],
  },
  {
    id: 'files',
    titleKey: 'helpSecFiles',
    entries: [
      { termKey: 'helpPasteTerm', descKey: 'helpPasteDesc' },
      { termKey: 'helpEditorTerm', descKey: 'helpEditorDesc' },
      { termKey: 'helpFileLinkTerm', descKey: 'helpFileLinkDesc' },
      { termKey: 'helpFileSearchTerm', descKey: 'helpFileSearchDesc' },
    ],
  },
  {
    id: 'handy',
    titleKey: 'helpSecHandy',
    entries: [
      { termKey: 'helpPaletteTerm', descKey: 'helpPaletteDesc' },
      { termKey: 'helpQuickOpenTerm', descKey: 'helpQuickOpenDesc' },
      { termKey: 'helpSnippetTerm', descKey: 'helpSnippetDesc' },
      { termKey: 'helpPredictiveTerm', descKey: 'helpPredictiveDesc' },
    ],
  },
  {
    id: 'mobile',
    titleKey: 'helpSecMobile',
    entries: [
      { termKey: 'helpMobileKeysTerm', descKey: 'helpMobileKeysDesc' },
      { termKey: 'helpQuickInputTerm', descKey: 'helpQuickInputDesc' },
      { termKey: 'helpVncTouchTerm', descKey: 'helpVncTouchDesc' },
    ],
  },
  {
    id: 'security',
    titleKey: 'helpSecSecurity',
    entries: [
      { termKey: 'helpAuthTerm', descKey: 'helpAuthDesc' },
      { termKey: 'helpSecretsTerm', descKey: 'helpSecretsDesc' },
    ],
  },
  {
    id: 'usage',
    titleKey: 'helpSecUsage',
    entries: [
      { termKey: 'helpUsageTerm', descKey: 'helpUsageDesc' },
      { termKey: 'helpThemeTerm', descKey: 'helpThemeDesc' },
    ],
  },
];

/** Every translation key this file references — the locale check walks this. */
export const helpTranslationKeys = () => HELP_TOPICS.flatMap((section) => [
  section.titleKey,
  ...section.entries.flatMap((entry) => [entry.termKey, entry.descKey]),
]);

export default HELP_TOPICS;
