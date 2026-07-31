/**
 * pane 하나의 표시 이름 — 모바일 서브탭바의 라벨과 pane 우상단 주소 배지가 **같은 값**을 써야 한다.
 * (분할 화면에서 "저 pane 이름이 뭐였지"를 두 곳에서 다르게 답하면 주소로 부를 수가 없다.)
 *
 * 우선순위: 사용자가 직접 지은 이름 → pane 이름 → 호스트 이름 → This machine 설정값 → 폴백.
 */
export const derivePaneLabel = (pane, { hosts = [], settings = {}, t = null } = {}) => {
  if (pane?.manualName) return pane.name || '';
  const host = pane?.hostId ? hosts.find((h) => h.id === pane.hostId) : null;
  const isLocal = !!pane?.sessionId && !pane?.hostId;
  return pane?.name
    || host?.name
    || (isLocal
      ? ((settings.localName || '').trim() || (t?.('thisMachine') || 'Local'))
      : (t?.('startSession') || 'Empty'));
};

/** 아직 아무것도 안 붙은 pane(picker 상태) — 배지에 "Empty" 를 띄우는 건 노이즈다. */
export const isEmptyPane = (pane) => !pane?.sessionId && !pane?.hostId;

export default derivePaneLabel;
