/**
 * 도움말 패널의 내용 — "이 버튼이 뭘 하는 건가" 에 대한 답을 한곳에 모은 곳.
 *
 * 왜 데이터로 두는가: 문구가 컴포넌트 JSX 안에 흩어지면 (1) 한 언어만 고치고 지나가기
 * 쉽고 (2) 무엇을 설명하고 무엇을 빠뜨렸는지 한눈에 안 보인다. 여기 있으면 테스트가
 * **양쪽 로케일에 다 있는지**를 기계적으로 검사할 수 있다(helpTopics.test.js).
 *
 * 문구 규칙:
 *  - 한 항목 = 이름 + **한 줄 설명**. 두 문장을 넘기면 아무도 안 읽는다.
 *  - 기능 이름이 아니라 **그걸로 뭘 할 수 있는지**를 쓴다("핸들" ✗ / "끌어서 옮기고,
 *    누르면 주소가 복사돼요" ○).
 *  - 실제로 헷갈렸던 것만 넣는다(새로고침 vs 재시작, 붙여넣기가 어디로 가는지 등).
 *    전부 나열하면 목록이 길어져 정작 답이 필요한 항목이 묻힌다.
 */

export const HELP_TOPICS = [
  {
    id: 'basics',
    titleKey: 'helpSecBasics',
    entries: [
      { termKey: 'helpTabPaneTerm', descKey: 'helpTabPaneDesc' },
      { termKey: 'helpPersistTerm', descKey: 'helpPersistDesc' },
      { termKey: 'helpCloseTerm', descKey: 'helpCloseDesc' },
      { termKey: 'helpMultiDeviceTerm', descKey: 'helpMultiDeviceDesc' },
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
    ],
  },
  {
    id: 'itl',
    titleKey: 'helpSecItl',
    entries: [
      { termKey: 'helpItlWhatTerm', descKey: 'helpItlWhatDesc' },
      { termKey: 'helpItlAddrTerm', descKey: 'helpItlAddrDesc' },
      { termKey: 'helpItlRemoteTerm', descKey: 'helpItlRemoteDesc' },
      { termKey: 'helpItlReadTerm', descKey: 'helpItlReadDesc' },
    ],
  },
  {
    id: 'notify',
    titleKey: 'helpSecNotify',
    entries: [
      { termKey: 'helpPushTerm', descKey: 'helpPushDesc' },
      { termKey: 'helpTelegramTerm', descKey: 'helpTelegramDesc' },
      { termKey: 'helpStatusDotTerm', descKey: 'helpStatusDotDesc' },
    ],
  },
  {
    id: 'mobile',
    titleKey: 'helpSecMobile',
    entries: [
      { termKey: 'helpMobileKeysTerm', descKey: 'helpMobileKeysDesc' },
      { termKey: 'helpQuickInputTerm', descKey: 'helpQuickInputDesc' },
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

/** 이 파일이 참조하는 모든 번역 키 — 로케일 검사용(테스트가 이걸 돈다). */
export const helpTranslationKeys = () => HELP_TOPICS.flatMap((section) => [
  section.titleKey,
  ...section.entries.flatMap((entry) => [entry.termKey, entry.descKey]),
]);

export default HELP_TOPICS;
