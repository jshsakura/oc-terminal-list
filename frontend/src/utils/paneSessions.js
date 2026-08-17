import { derivePaneLabel } from './paneLabel';
import { normalizeCwd } from './llmSessionPane';
import { apiFetch } from './apiFetch';
import { authHeaders } from './auth';

/**
 * 세션 간 명령 복사 픽커를 위한 "다른 살아있는 터미널" 목록.
 *
 * App 의 Quick Input 타깃 집계(`key = sessionId || pane.id`)와 같은 키 규칙을 쓴다 —
 * 그 키가 곧 `window.terminalSessions[key]`(전송)와 커맨드 히스토리 조회(복사 원본)의 키다.
 *
 * 제외: 현재 pane 자신과 같은 세션 키를 가진 pane, 빈 pane, VNC/editor pane.
 * 같은 세션이 여러 pane 에 붙어 있으면 첫 pane 하나만(중복 행이 명령 목록도 중복시킨다).
 */
export const collectOtherPaneSessions = (allTabs, {
  excludePaneId = null,
  excludeKey = null,
  hosts = [],
  settings = {},
  t = null,
} = {}) => {
  const seen = new Set();
  const sessions = [];
  const tabs = allTabs || [];
  for (let tIdx = 0; tIdx < tabs.length; tIdx += 1) {
    const tab = tabs[tIdx];
    const panes = tab?.panes || [];
    for (let pIdx = 0; pIdx < panes.length; pIdx += 1) {
      const pane = panes[pIdx];
      if (pane?.id === excludePaneId) continue;
      if (pane?.mode && pane.mode !== 'terminal') continue;   // VNC / editor pane
      if (!pane?.sessionId && !pane?.hostId) continue;        // 빈 pane — 히스토리도 전송도 없다
      const key = pane.sessionId || pane.id;
      if (!key || key === excludeKey) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      sessions.push({
        key,
        // 백엔드로 보낼 때 쓰는 **신원** — 로컬은 세션 ID, 원격은 tmux 세션명
        // (itl_targets 가 정확일치로 찾는 그 값). `key` 와 다른 이유: 원격 pane 은
        // sessionId 가 없어 key 가 프론트 pane id 이고, 그건 서버가 모르는 값이다.
        sessionKey: pane.sessionId || pane.tmuxSessionName || '',
        tabId: tab?.id || null,
        tabName: tab?.name || '',
        label: derivePaneLabel(pane, { hosts, settings, t }),
        isLocal: !!pane.sessionId && !pane.hostId,
        // 전역 좌표(1-based) — 탭바 순서 × 탭 내 팬 순서. itl 주소 체계(tabIdx.paneIdx,
        // itl_targets.py)와 같은 규칙이라 서브탭에 적힌 번호 그대로와 대응한다.
        // 탭 위치까지 합치면 목록 안에서 항상 유일 — "옆창"을 가리키는 확정 좌표.
        tabIndex: tIdx + 1,
        paneIndex: pIdx + 1,
        address: `${tIdx + 1}.${pIdx + 1}`,
        // 중복 라벨("This machine" 두 개) 식별용 맥락 — llmSessionPane 와 같은 규칙으로
        // pane 의 cwd 우선, 없으면 탭의 것(단일 pane 탭은 탭에만 있다).
        // App 상태에는 채워지지 않는 때가 많아 화면 표시는 fetchPaneCwdHints 를 따른다.
        cwd: normalizeCwd(pane?.cwd || tab?.cwd || ''),
      });
    }
  }
  // 같은 라벨("This machine" 등)이 여러 개면 어느 쪽인지 구분이 안 된다 —
  // 중복 라벨에만 탭 이름을 덧대서 보여준다(호출부가 duplicated 플래그로 판단).
  const labelCounts = new Map();
  for (const s of sessions) {
    labelCounts.set(s.label, (labelCounts.get(s.label) || 0) + 1);
  }
  return sessions.map((s) => ({ ...s, labelDuplicated: labelCounts.get(s.label) > 1 }));
};

/**
 * 로컬 세션들의 실제 tmux cwd 를 배치로 얻어 {key: 표시경로} 맵으로 반환.
 * App 탭 상태에는 pane.cwd 가 없는 때가 많아(자동탭명 갱신에만 쓰임) 식별 힌트는
 * 서버가 아는 진짜 cwd 를 써야 한다. 원격 pane 은 라벨 중복이 드물어 제외.
 * 실패 시 빈 객체 — 힌트 없이 라벨만 표시하는 것으로 조용히 강등된다.
 */
export const fetchPaneCwdHints = async (sessions) => {
  const ids = (sessions || []).filter((s) => s?.isLocal && s.key).map((s) => s.key);
  if (ids.length === 0) return {};
  const res = await apiFetch(`/api/sessions/cwd/batch?ids=${encodeURIComponent(ids.join(','))}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return {};
  const data = await res.json();
  const cwds = data?.cwds || {};
  const hints = {};
  for (const s of sessions) {
    const info = cwds[s.key];
    if (!info) continue;
    const display = info.in_workspace && info.workspace_relative
      ? info.workspace_relative
      : (info.cwd || '');
    const normalized = normalizeCwd(display || '');
    if (normalized) hints[s.key] = normalized;
  }
  return hints;
};

export default collectOtherPaneSessions;
