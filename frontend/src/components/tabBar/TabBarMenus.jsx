import { useState, useEffect, useRef } from 'react';
import {
  Edit3, Copy, LayoutGrid,
  SquareSplitHorizontal, SquareSplitVertical, Grid2x2, Trash2,
  Settings as SettingsIcon, RefreshCw,
} from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { glassMenuStyle } from '../../styles/glass';
import { MenuItem } from './MenuItem';
import VncMenuItems from '../vnc/VncMenuItems';

const { color, font } = tokens;

// 기존 import 경로 유지 — 여러 메뉴가 여기서 MenuItem 을 가져다 쓴다.
export { MenuItem };

export const TabContextMenu = ({
  ctx, t, onClose, onCloseTab, onDuplicateTab, onRenameTab = null,
  paneCount = 1,
  // VNC pane 이 활성일 때만 채워지는 슬롯 — 보기 모드/화질(VncMenuItems).
  vncPaneId = null,
  canMoveLeft = false, canMoveRight = false, onMoveLeft = null, onMoveRight = null,
  canSplit = false, onSplit = null,
}) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: ctx.x, y: ctx.y });
  const [measured, setMeasured] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handle = (e) => {
      if (e.target?.closest?.('[data-more="true"]')) return;
      if (!ref.current?.contains(e.target)) onCloseRef.current();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle);
      document.addEventListener('touchstart', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const margin = 8;
      let nextX = ctx.x;
      let nextY = ctx.y;

      if (nextX + rect.width > window.innerWidth - margin) {
        nextX = window.innerWidth - rect.width - margin;
      }
      if (nextX < margin) nextX = margin;

      if (nextY + rect.height > window.innerHeight - margin) {
        nextY = window.innerHeight - rect.height - margin;
      }
      if (nextY < margin) nextY = margin;

      setPos({ x: nextX, y: nextY });
      setMeasured(true);
    }
  }, [ctx.x, ctx.y]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        ...glassMenuStyle(),
        zIndex: 200000,
        minWidth: '140px',
        fontFamily: font.sans,
        opacity: measured ? 1 : 0,
      }}
    >
      {/* VNC pane — 이 pane 에는 TerminalHeader 가 없어서 보기/화질을 둘 데가 여기뿐이다. */}
      {vncPaneId && (
        <>
          <VncMenuItems paneId={vncPaneId} onDone={onClose} t={t} />
          <div style={{ height: '1px', background: color.border, margin: '4px 2px' }} />
        </>
      )}
      {/* 왼쪽/오른쪽 이동 제거 — 이제 탭 드래그로 재정렬 가능해 메뉴 항목 불필요. */}
      {onRenameTab && (
        <MenuItem onClick={onRenameTab} icon={Edit3}>
          {t?.('rename') || 'Rename'}
        </MenuItem>
      )}
      {onDuplicateTab && (
        <MenuItem onClick={onDuplicateTab} icon={Copy}>
          {t?.('duplicateTab') || 'Duplicate (same path)'}
        </MenuItem>
      )}
      {canSplit && onSplit && (
        <>
          {/* 흔히 쓰는 세로/가로 분할 2개 + 2×2 만. 왼쪽/위로 분할은 거의 안 써 메뉴서 제외
              (오른쪽/아래로 분할 후 재배치로 대체 가능). */}
          <MenuItem onClick={() => onSplit('right')} icon={SquareSplitHorizontal}>
            {`${t?.('splitRight') || 'Split right'} (Ctrl+\\)`}
          </MenuItem>
          <MenuItem onClick={() => onSplit('down')} icon={SquareSplitVertical}>
            {`${t?.('splitDown') || 'Split down'} (Ctrl+Shift+\\)`}
          </MenuItem>
          <MenuItem onClick={() => onSplit('2x2')} icon={Grid2x2}>
            {t?.('layout2x2') || '2 × 2 grid'}
          </MenuItem>
        </>
      )}
      {/* 닫기 = 세션 종료임을 라벨에 명시 — pane 여러 개면 몇 개가 끝나는지까지 보여준다. */}
      <MenuItem onClick={onCloseTab} danger icon={Trash2}>
        {t?.('closeTab') || 'Close tab'}
        <span style={{ marginLeft: 'auto', paddingLeft: '10px', fontSize: '10.5px', color: color.muted, whiteSpace: 'nowrap' }}>
          {paneCount > 1
            ? `${t?.('endsSessions') || 'ends'} ${paneCount}`
            : (t?.('endsSession') || 'ends session')}
        </span>
      </MenuItem>
    </div>
  );
};

export const SettingsSubMenu = ({ anchor, t, isMobile = false, onClose, onSettings, onReload, onEqualize }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });
  const [measured, setMeasured] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) onCloseRef.current(); };
    const handleKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle);
      document.addEventListener('touchstart', handle);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const m = 8;
      let nx = anchor.x - rect.width;
      let ny = anchor.y;
      if (nx < m) nx = m;
      if (nx + rect.width > window.innerWidth - m) nx = window.innerWidth - rect.width - m;
      if (ny + rect.height > window.innerHeight - m) ny = window.innerHeight - rect.height - m;
      setPos({ x: nx, y: ny });
      setMeasured(true);
    }
  }, [anchor.x, anchor.y]);

  const iconSize = isMobile ? 15 : 12;
  const item = (Icon, label, action) => (
    <button
      type="button"
      onClick={action}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        width: '100%',
        minHeight: isMobile ? '42px' : '30px',
        padding: isMobile ? '0 12px' : '6px 9px',
        background: 'transparent', border: 'none', borderRadius: '5px',
        cursor: 'pointer', color: color.text,
        fontSize: isMobile ? '13px' : '11.5px', fontFamily: font.sans,
        transition: 'background 120ms, box-shadow 120ms',
      }}
      /* 호버는 "이 줄이 선택된다" 는 유일한 신호다 — 면만으로 애매하면 왼쪽 액센트 실마리가
         어느 줄인지 확실히 잡아준다(유리 위에서 반투명 면은 뒤에 비치는 것과 섞인다). */
      onMouseEnter={(e) => {
        e.currentTarget.style.background = glassMenuItemHover();
        e.currentTarget.style.boxShadow = `inset 2px 0 0 ${color.accent}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <Icon size={iconSize} strokeWidth={1.8} />
      {label}
    </button>
  );

  return (
    <div ref={ref} style={{
      position: 'fixed', top: pos.y, left: pos.x,
      ...glassMenuStyle(),
      zIndex: 200000,
      minWidth: isMobile ? '190px' : '160px',
      fontFamily: font.sans,
      opacity: measured ? 1 : 0,
      transition: 'opacity 120ms',
    }}>
      {item(SettingsIcon, t?.('settings') || 'Settings', onSettings)}
      {onEqualize && item(LayoutGrid, t?.('equalizePane') || 'Equalize panes', onEqualize)}
      {onReload && item(RefreshCw, t?.('reloadTerminals') || 'Reload terminals', onReload)}
    </div>
  );
};

