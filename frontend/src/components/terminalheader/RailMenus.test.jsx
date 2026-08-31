import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommandHistoryPopover } from './RailMenus';

// 히스토리 조회/클립보드는 util 을 mock — popover 의 모드 전이/push·pull 배선만 검증.
vi.mock('../../utils/commandHistory', () => ({
  fetchPage: vi.fn(),
  removeCommand: vi.fn(),
  clearCommandsFor: vi.fn(),
  COMMAND_HISTORY_EVENT: 'iterm:commandHistory:updated',
}));
vi.mock('../../utils/clipboard', () => ({ copyToClipboard: vi.fn() }));
// cwd 힌트는 util 을 mock — 픽커 배선(1회 fetch, 접미 렌더)만 검증한다.
vi.mock('../../utils/paneSessions', () => ({ fetchPaneCwdHints: vi.fn() }));
vi.mock('../../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
vi.mock('../../utils/auth', () => ({ authHeaders: () => ({ Authorization: 'Bearer t' }) }));
import { fetchPage } from '../../utils/commandHistory';
import { copyToClipboard } from '../../utils/clipboard';
import { fetchPaneCwdHints } from '../../utils/paneSessions';
import { apiFetch } from '../../utils/apiFetch';

// fetchPaneCwdHints 는 모든 describe 에서 enterPicker 가 돌 때마다 불린다 —
// 기본값은 빈 힌트(프라미스여야 컴포넌트의 .then 이 살아있다).
beforeEach(() => {
  vi.mocked(fetchPaneCwdHints).mockReset();
  vi.mocked(fetchPaneCwdHints).mockResolvedValue({});
});

const t = (key) => ({
  historyTitle: 'Recent commands',
  historyEmpty: 'No history yet',
  historyEnd: 'End of history',
  loading: 'Loading…',
  clearHistory: 'Clear history',
  confirmClearHistory: 'Clear command history for this terminal?',
  cancel: 'Cancel',
  clickToResend: 'click to re-send',
  copyFromSession: 'Copy a command from another session',
  pickerSessionsTitle: 'Pick a session',
  pickerNoSessions: 'No other sessions',
  pickerBackToSessions: 'Back to sessions',
  clickToSendHere: 'click to send to this terminal',
  pickerPushPlaceholder: 'Send a command to this session',
  pickerSendToSession: 'Send to this session',
  pickerPushFailed: 'Send failed',
  pickerSkipSessionGone: 'That session is gone',
  pickerSkipHostUnreachable: 'Could not reach that host',
  copy: 'Copy',
  remove: 'Remove',
}[key] || key);

const ui = {
  base: '#1e1e2e', surface0: '#11111b', surface1: '#45475a', surface2: '#585b70',
  border: '#cdd6f4', text: '#cdd6f4', subtext: '#a6adc8', accent: '#89b4fa',
  green: '#a6e3a1', danger: '#f38ba8', crust: '#11111b',
};

const ownHistory = [
  { text: 'echo own-one', ts: 9 },
  { text: 'echo own-two', ts: 8 },
];
const otherHistory = [
  { text: 'kubectl get pods', ts: 5 },
  { text: 'git status', ts: 4 },
];
const sessions = [
  { key: 'sess-build', sessionKey: 'sess-build', tabId: 'tab-a', tabName: 'work', label: 'This machine', isLocal: true, labelDuplicated: false },
  // 원격 pane: key(프론트 pane id) 와 sessionKey(원격 tmux 세션명)가 다르다 —
  // 백엔드가 아는 것은 후자뿐이다.
  { key: 'p-host', sessionKey: 'mobile-a1', address: '2.1', tabId: 'tab-b', tabName: 'server', label: 'nas', isLocal: false, labelDuplicated: false },
];

const renderPopover = (props = {}) => render(
  <CommandHistoryPopover
    anchor={{ x: 400, y: 40 }}
    terminalKey="own"
    sessions={sessions}
    ui={ui}
    onClose={vi.fn()}
    onSelect={vi.fn()}
    t={t}
    {...props}
  />
);

describe('CommandHistoryPopover modes', () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(copyToClipboard).mockReset();
    vi.mocked(fetchPage).mockImplementation(async (key) => (
      key === 'own'
        ? { items: ownHistory, hasMore: false }
        : { items: otherHistory, hasMore: false }
    ));
    window.terminalSessions = {};
  });

  it('기본은 자기 히스토리 — 제목/개수/픽커 진입 버튼이 함께 그려진다', async () => {
    renderPopover();
    expect(screen.getByText('Recent commands')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('echo own-one')).toBeTruthy());
    expect(screen.getByTitle('Copy a command from another session')).toBeTruthy();
    expect(screen.getByTitle('Clear history')).toBeTruthy();
  });

  it('다른 세션이 없으면 픽커 진입 버튼이 없다', async () => {
    renderPopover({ sessions: [] });
    await waitFor(() => expect(screen.getByText('echo own-one')).toBeTruthy());
    expect(screen.queryByTitle('Copy a command from another session')).toBeNull();
  });

  it('토글 → 세션 목록, 다시 ← → 자기 히스토리로 복귀', async () => {
    renderPopover();
    await waitFor(() => expect(screen.getByText('echo own-one')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Copy a command from another session'));
    expect(screen.getByText('Pick a session')).toBeTruthy();
    expect(screen.getByText('nas')).toBeTruthy();
    // 픽커 모드에서는 휴지통이 없다
    expect(screen.queryByTitle('Clear history')).toBeNull();
    fireEvent.click(screen.getByTitle('Back to sessions'));
    expect(screen.getByText('Recent commands')).toBeTruthy();
    expect(screen.getByText('echo own-one')).toBeTruthy();
  });

  it('세션 선택 → 그 세션의 히스토리, ← 로 세션 목록으로', async () => {
    renderPopover();
    fireEvent.click(screen.getByTitle('Copy a command from another session'));
    fireEvent.click(screen.getByText('nas'));
    await waitFor(() => expect(screen.getByText('kubectl get pods')).toBeTruthy());
    expect(fetchPage).toHaveBeenCalledWith('p-host', { before: null });
    fireEvent.click(screen.getByTitle('Back to sessions'));
    expect(screen.getByText('Pick a session')).toBeTruthy();
    expect(screen.queryByText('kubectl get pods')).toBeNull();
  });

  // 라벨/접미가 서로 다른 span 에 흩어져 있어 span 전체 textContent 로 잡는다.
  const rowSpanText = (rowText) => screen.getByText(
    (_, el) => el?.tagName === 'SPAN' && el?.textContent === rowText,
  );

  it('모든 행에 #탭.팬 주소 접두가 붙는다 — 중복 라벨이 아니어도, cwd 힌트 없이도', async () => {
    renderPopover({
      sessions: [
        { key: 's1', tabId: 't1', tabName: 'work', label: 'This machine', isLocal: true, labelDuplicated: true, tabIndex: 1, paneIndex: 1, address: '1.1' },
        { key: 's2', tabId: 't1', tabName: 'work', label: 'This machine', isLocal: true, labelDuplicated: true, tabIndex: 1, paneIndex: 2, address: '1.2' },
        { key: 'uniq', tabId: 't2', tabName: 'docs', label: 'nas', isLocal: false, labelDuplicated: false, tabIndex: 2, paneIndex: 1, address: '2.1' },
      ],
    });
    fireEvent.click(screen.getByTitle('Copy a command from another session'));
    // 주소 접두는 라벨 span 밖의 독립 span — 텍스트 노드 그대로 잡는다.
    expect(screen.getByText('#1.1')).toBeTruthy();
    expect(screen.getByText('#1.2')).toBeTruthy();
    // 비중복 행에도 붙는다 — 탭 위치는 항상 유일한 식별자다.
    expect(screen.getByText('#2.1')).toBeTruthy();
    // 접미는 중복 라벨에만: 탭 이름. (#n 접미는 v3 에서 접두로 대체돼 사라졌다)
    // s1/s2 두 행의 라벨 span 이 같은 텍스트라 getAll 로 2건을 확인한다.
    expect(screen.getAllByText(
      (_, el) => el?.tagName === 'SPAN' && el?.textContent === 'This machine · work',
    ).length).toBe(2);
  });

  it('로컬 세션은 배치 cwd 힌트를 얹는다 — 28자 클램프/호버 전체 경로/없으면 생략, fetch 는 1회', async () => {
    vi.mocked(fetchPaneCwdHints).mockResolvedValue({
      s1: '/home/u/proj-a',
      s2: '/home/u/very/long/path/that/gets/clamped/proj-b',
    });
    renderPopover({
      sessions: [
        { key: 's1', tabId: 't1', tabName: 'work', label: 'This machine', isLocal: true, labelDuplicated: true, tabIndex: 1, paneIndex: 1, address: '1.1' },
        { key: 's2', tabId: 't1', tabName: 'work', label: 'This machine', isLocal: true, labelDuplicated: true, tabIndex: 1, paneIndex: 2, address: '1.2' },
        { key: 's3', tabId: 't1', tabName: 'work', label: 'This machine', isLocal: true, labelDuplicated: true, tabIndex: 1, paneIndex: 3, address: '1.3' },
      ],
    });
    fireEvent.click(screen.getByTitle('Copy a command from another session'));
    expect(await screen.findByTitle('/home/u/proj-a')).toBeTruthy();
    // 정규식은 행 전체(button) 텍스트로 — 주소 접두와 경로 접미는 서로 다른 span 이다.
    expect(screen.getByTitle('/home/u/very/long/path/that/gets/clamped/proj-b').closest('button').textContent)
      .toMatch(/#1\.2.*….*proj-b$/);
    // 힌트가 없는 s3 행에는 경로 접미가 없다 — 라벨 접미는 탭 이름까지만
    expect(screen.getByText(
      (_, el) => el?.tagName === 'SPAN' && el?.textContent === 'This machine · work',
    )).toBeTruthy();
    expect(screen.getByText('#1.3')).toBeTruthy();
    // 왕복 재진입해도 popover 라이프사이클당 1회
    fireEvent.click(screen.getByTitle('Back to sessions'));
    fireEvent.click(screen.getByTitle('Copy a command from another session'));
    expect(fetchPaneCwdHints).toHaveBeenCalledTimes(1);
  });

  it('cwd 힌트 조회가 실패해도 픽커는 깨지지 않는다', async () => {
    vi.mocked(fetchPaneCwdHints).mockRejectedValue(new Error('net'));
    renderPopover({
      sessions: [
        { key: 's1', tabId: 't1', tabName: 'w', label: 'This machine', isLocal: true, labelDuplicated: true, tabIndex: 1, paneIndex: 1, address: '1.1' },
      ],
    });
    fireEvent.click(screen.getByTitle('Copy a command from another session'));
    expect(screen.getByText(
      (_, el) => el?.tagName === 'SPAN' && el?.textContent === 'This machine · w',
    )).toBeTruthy();
    expect(screen.getByText('#1.1')).toBeTruthy();
  });
});

describe('CommandHistoryPopover pull / copy (다른 세션 히스토리 행)', () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(copyToClipboard).mockReset();
    vi.mocked(fetchPage).mockImplementation(async (key) => (
      key === 'own' ? { items: ownHistory, hasMore: false } : { items: otherHistory, hasMore: false }
    ));
    window.terminalSessions = {};
  });

  it('행 클릭은 onSelect(text) — 현재 pane 으로 pull (기존 선택 경로 재사용)', async () => {
    const onSelect = vi.fn();
    renderPopover({ onSelect });
    fireEvent.click(screen.getByTitle('Copy a command from another session'));
    fireEvent.click(screen.getByText('nas'));
    await waitFor(() => expect(screen.getByText('kubectl get pods')).toBeTruthy());
    fireEvent.click(screen.getByText('kubectl get pods'));
    expect(onSelect).toHaveBeenCalledWith('kubectl get pods');
  });

  it('클립보드 아이콘은 copyToClipboard 로 복사한다', async () => {
    vi.mocked(copyToClipboard).mockResolvedValue(true);
    renderPopover();
    fireEvent.click(screen.getByTitle('Copy a command from another session'));
    fireEvent.click(screen.getByText('nas'));
    await waitFor(() => expect(screen.getByText('git status')).toBeTruthy());
    // 행마다 복사 버튼이 하나씩 — 첫 행(kubectl get pods) 것을 누른다.
    fireEvent.click(screen.getAllByTitle('Copy')[0]);
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('kubectl get pods'));
  });
});
