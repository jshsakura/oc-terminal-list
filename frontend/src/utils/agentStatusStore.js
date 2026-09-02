/**
 * 세션ID → 에이전트 상태. 모듈 레벨 단일 스토어.
 *
 * 두 곳에서 채워진다:
 *  1. xterm `onTitleChange` — 보고 있는 pane. 즉각적이고, **원격 호스트 pane 도 포함**.
 *  2. 백엔드 SSE(`type:'agentStatus'`) — 로컬 tmux 폴링. 아무도 안 보고 있는 세션까지 커버.
 *
 * 왜 컨텍스트가 아니라 모듈 스토어인가: SSE 는 "디바이스당 EventSource 1개" 불변식
 * (useWorkspaceTabs.js) 아래 이미 한 곳에서만 열린다. 그 핸들러가 상태를 흘려보낼
 * 통로가 필요한데, 프로바이더를 새로 끼우면 트리 전체가 리렌더 대상이 된다.
 * useSyncExternalStore 로 구독한 컴포넌트만 다시 그린다.
 */
import { detectAgentStatus, agentDisplayTitle, isSpinnerOnlyChange } from './agentTitle';

// sessionId → { status, title, rawTitle, command, cwd, updatedAt }
let state = {};
const listeners = new Set();

const emit = () => {
  // 새 참조로 교체 — useSyncExternalStore 가 얕은 비교로 변경을 감지한다.
  state = { ...state };
  listeners.forEach((fn) => fn());
};

export const subscribeAgentStatus = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getAgentStatusSnapshot = () => state;

/**
 * xterm 이 관측한 원시 타이틀 한 건.
 * 스피너 프레임만 바뀐 경우는 조용히 무시한다 — 초당 10~12회 리렌더를 막는다.
 */
export const reportTerminalTitle = (sessionId, rawTitle) => {
  if (!sessionId) return;
  const prev = state[sessionId];
  const status = detectAgentStatus(rawTitle);
  if (prev && prev.status === status && isSpinnerOnlyChange(prev.rawTitle, rawTitle)) {
    // 다음 비교 기준이 프레임 하나만큼 흐르지 않게 raw 만 갱신 (리렌더 없음).
    prev.rawTitle = rawTitle;
    return;
  }
  state[sessionId] = {
    ...(prev || {}),
    status,
    rawTitle,
    title: agentDisplayTitle(rawTitle),
    updatedAt: Date.now(),
  };
  emit();
};

/** 백엔드 SSE 변경분 적용. */
export const applyAgentStatusChanges = (changes) => {
  if (!Array.isArray(changes) || changes.length === 0) return;
  let dirty = false;
  changes.forEach((change) => {
    const id = change?.sessionId;
    if (!id) return;
    if (change.gone) {
      if (state[id]) { delete state[id]; dirty = true; }
      return;
    }
    const prev = state[id];
    // 프론트가 방금 본 타이틀이 더 최신이다 — 폴링(최대 5s 지연)이 덮어쓰지 않게 한다.
    // ⚠️ **cwd 도 비교에 넣는다.** 타이틀이 안 변하는 셸에서 `cd` 만 한 경우가 정확히
    // 여기서 걸러졌다 — 그러면 상단 주소가 영영 안 따라온다.
    if (prev && prev.rawTitle === change.rawTitle && prev.status === change.status
        && (prev.cwd || '') === (change.cwd || '')) return;
    state[id] = {
      status: change.status ?? null,
      title: change.title || '',
      rawTitle: change.rawTitle || '',
      command: change.command || '',
      // tmux 가 아는 **지금** 경로. 폴링이 이미 읽고 있던 값이라 이걸 싣는 데 드는 왕복이
      // 없다(backend/agent_status_watcher.PANE_FORMAT).
      cwd: change.cwd || '',
      updatedAt: Date.now(),
    };
    dirty = true;
  });
  if (dirty) emit();
};

/** GET /api/agent-status 전체 스냅샷으로 하이드레이션 (재연결 시). */
export const hydrateAgentStatus = (sessions) => {
  if (!sessions || typeof sessions !== 'object') return;
  Object.entries(sessions).forEach(([id, value]) => {
    const prev = state[id];
    // 이미 라이브 관측이 있으면 그게 우선 — 폴링 스냅샷은 뒤처져 있을 수 있다.
    if (prev && prev.updatedAt) return;
    state[id] = {
      status: value?.status ?? null,
      title: value?.title || '',
      rawTitle: value?.rawTitle || '',
      command: value?.command || '',
      cwd: value?.cwd || '',
      updatedAt: 0,
    };
  });
  emit();
};

/** pane 이 사라졌을 때 — 죽은 세션이 영원히 working 으로 남지 않게. */
export const forgetAgentStatus = (sessionId) => {
  if (sessionId && state[sessionId]) {
    delete state[sessionId];
    emit();
  }
};

/** 테스트 전용 — 스토어 초기화. */
export const _resetAgentStatus = () => { state = {}; listeners.clear(); };


/**
 * 이 세션의 **살아있는 cwd** — tmux 가 방금 보고한 절대 경로. 없으면 빈 문자열.
 *
 * 원시값(문자열)을 돌려주는 것이 중요하다: `useSyncExternalStore` 는 스냅샷을 참조로
 * 비교하므로, 객체를 새로 만들어 돌려주면 매 렌더가 변경으로 읽혀 무한 루프가 된다.
 *
 * ⚠️ **로컬 tmux pane 만 채워진다.** 백엔드 폴링은 이 기계의 tmux 만 볼 수 있다 —
 * 원격 pane 의 tmux 는 그 호스트에 있고, herdr 에는 이 폴링 자체가 없다. 그쪽은 빈
 * 문자열이고, 호출부는 그걸 "모른다" 로 읽어 원래 하던 대로 한다.
 */
export const getAgentCwd = (sessionId) => (sessionId ? (state[sessionId]?.cwd || '') : '');
