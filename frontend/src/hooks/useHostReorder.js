/**
 * 호스트 정렬 공유 훅 — HomeDashboard / HostManager / EmptyPane / Settings 가
 * 모두 동일한 DnD 로직 + 서버 sort_index 가 단일 진실의 출처.
 *
 *   const { orderedHosts, rowPropsFor } = useHostReorder(hosts, refreshHosts);
 *   {orderedHosts.map(h => <Row {...rowPropsFor(h)} ... />)}
 *
 * rowPropsFor(host) → row container 에 spread:
 *   - 'data-host-row' (drop 타깃 매칭)
 *   - isDragging / isDragOver (시각)
 *   - onPointerDown (행 전체에 박음. 5px 미만 이동 = 클릭, 그 이상 = 드래그.
 *     드래그 발생 시 그 다음 click 이벤트 capture 단계에서 swallow → onClick 안 발동)
 *
 * grip 핸들은 시각용 decoration — 실제 드래그 트리거는 행 전체.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authHeaders } from '../utils/auth';

const persistOrder = async (ids) => {
  try {
    await fetch('/api/hosts/reorder', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ids }),
    });
  } catch { /* 네트워크 실패 무시 — 다음 새로고침에 서버 정답 */ }
};

const DRAG_THRESHOLD_PX2 = 5 * 5; // 5px 이내 이동 = 클릭, 초과 = 드래그

const findRowId = (clientX, clientY) => {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const row = el.closest('[data-host-row]');
  return row?.getAttribute('data-host-row') || null;
};

export const useHostReorder = (hosts = [], refreshHosts = null) => {
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [localOrder, setLocalOrder] = useState(null);

  useEffect(() => { setLocalOrder(null); }, [hosts]);

  const orderedHosts = useMemo(() => {
    if (!localOrder) return hosts;
    const map = new Map(hosts.map((h) => [h.id, h]));
    const ordered = localOrder.map((id) => map.get(id)).filter(Boolean);
    const known = new Set(localOrder);
    const extra = hosts.filter((h) => !known.has(h.id));
    return [...ordered, ...extra];
  }, [hosts, localOrder]);

  // 최신 ordered 를 클로저 외부에서 참조 (pointermove 콜백이 stale 안 되게).
  const orderedRef = useRef(orderedHosts);
  orderedRef.current = orderedHosts;

  const reorder = useCallback((fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const ids = orderedRef.current.map((h) => h.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...ids];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setLocalOrder(next);
    persistOrder(next).then(() => refreshHosts?.());
  }, [refreshHosts]);

  const rowPropsFor = useCallback((host) => ({
    'data-host-row': host.id,
    isDragging: draggingId === host.id,
    isDragOver: overId === host.id && draggingId !== host.id,
    onPointerDown: (e) => {
      // primary button (mouse) 또는 touch/pen 만.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // input/textarea 안 클릭은 무시 — 폼 입력 가로채지 않게.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const start = { x: e.clientX, y: e.clientY };
      let drag = false;
      let lastOver = null;

      const onMove = (ev) => {
        if (!drag) {
          const dx = ev.clientX - start.x;
          const dy = ev.clientY - start.y;
          if (dx * dx + dy * dy <= DRAG_THRESHOLD_PX2) return;
          drag = true;
          setDraggingId(host.id);
        }
        ev.preventDefault();
        const id = findRowId(ev.clientX, ev.clientY);
        if (id !== lastOver) {
          lastOver = id;
          setOverId(id && id !== host.id ? id : null);
        }
      };

      const onUp = (ev) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        if (drag) {
          const id = findRowId(ev.clientX, ev.clientY);
          setDraggingId(null);
          setOverId(null);
          // 드래그 끝난 직후 합성 click 은 무조건 swallow.
          // row 밖(모달 오버레이 등)에서 떨어지면 그 click 이 overlay onClose 까지 올라가서 팝업이 닫혀버렸음.
          const swallow = (clickEv) => {
            clickEv.stopPropagation();
            clickEv.preventDefault();
          };
          document.addEventListener('click', swallow, { capture: true });
          setTimeout(() => {
            try { document.removeEventListener('click', swallow, { capture: true }); } catch { /* ignore */ }
          }, 50);
          if (id && id !== host.id) reorder(host.id, id);
        }
      };

      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    },
  }), [draggingId, overId, reorder]);

  return { orderedHosts, rowPropsFor };
};

export default useHostReorder;
