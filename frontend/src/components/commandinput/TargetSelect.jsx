import { createPortal } from 'react-dom';
import { AppWindow, Check, CheckSquare, Crosshair, Square, SquareTerminal } from 'lucide-react';
import GlassModal from '../common/GlassModal';
import { tokens } from '../../styles/tokens';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

// pane 색 칩 위에 얹는 아이콘 색 — 팔레트가 전부 밝은 색이라 어두운 글자색으로 고정.
const PANE_ICON_INK = '#0b0f14';

/**
 * "보낼 대상" 아이콘 버튼 + 그 팝업. pane 이 2개 이상일 때만 쓴다.
 * 선택 상태는 부모가 useSendTargets 로 들고 있고, 여기서는 그리기만 한다.
 *
 * 버튼에 앵커된 작은 드롭다운 대신 공용 GlassModal 을 document.body 로 포탈해
 * 독립된 중앙 팝업으로 띄운다 — 모달의 overflow:hidden / backdropFilter 에 잘리지 않고,
 * 모바일 ghost-click 방어(400ms 유예)와 터치 스크롤도 그대로 상속받는다.
 */
const TargetSelect = ({ targets, terminalKey, t }) => {
  const {
    targetKeys, groups, totalCount, selectedCount, allSelected,
    isPopupOpen, togglePopup, closePopup, toggleKey, toggleGroup, toggleAll,
  } = targets;

  const label = t?.('sendTarget') || 'Send to';

  // 배지 — 아무것도 안 고르면 "활성", 전부면 "전체", 아니면 개수.
  const badge = selectedCount === 0
    ? (t?.('sendToActive') || 'Active')
    : (allSelected ? (t?.('sendToAll') || 'All') : String(selectedCount));

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        // mousedown 에서 focus 안 뺏게 — 안 그러면 textarea 가 blur 되며 키보드가 내려간다.
        onMouseDown={(e) => e.preventDefault()}
        onClick={togglePopup}
        title={label}
        aria-label={label}
        aria-expanded={isPopupOpen}
        style={{ ...styles.btn, ...(isPopupOpen ? styles.btnActive : null) }}
      >
        <Crosshair size={13} strokeWidth={2} />
        <span style={styles.badge}>{badge}</span>
      </button>

      {isPopupOpen && createPortal(
        <GlassModal
          isOpen={isPopupOpen}
          onClose={closePopup}
          title={label}
          titleIcon={Crosshair}
          ariaLabel={label}
          closeTitle={t?.('close') || 'Close'}
          width="88%"
          maxWidth="340px"
          maxHeight="64vh"
          bodyStyle={{ padding: space['1'] }}
          afterHeader={(
            <div style={styles.popupHead}>
              <span style={styles.popupHint}>
                {selectedCount === 0
                  ? (t?.('sendToActiveNote') || '선택 없음 → 활성 pane 으로')
                  : `${selectedCount} / ${totalCount}`}
              </span>
              <button type="button" onClick={toggleAll} style={styles.allBtn}>
                {allSelected ? <CheckSquare size={13} strokeWidth={2} /> : <Square size={13} strokeWidth={2} />}
                {allSelected ? (t?.('deselectAll') || '전체 해제') : (t?.('selectAll') || '전체 선택')}
              </button>
            </div>
          )}
        >
          <div style={styles.list}>
            {groups.map((group) => (
              <TargetGroup
                key={group.tabId}
                group={group}
                targetKeys={targetKeys}
                terminalKey={terminalKey}
                onToggleGroup={toggleGroup}
                onToggleKey={toggleKey}
                t={t}
              />
            ))}
          </div>
        </GlassModal>,
        document.body,
      )}
    </div>
  );
};

// 탭 하나 = 그룹 헤더(탭 전체 토글) + 그 탭의 pane 행들.
const TargetGroup = ({ group, targetKeys, terminalKey, onToggleGroup, onToggleKey, t }) => {
  const groupChecked = group.items.every((p) => targetKeys.has(p.key));

  return (
    <div style={styles.group}>
      <button
        type="button"
        aria-pressed={groupChecked}
        onClick={() => onToggleGroup(group.items)}
        style={{ ...styles.groupHead, ...(group.isActiveTab ? styles.groupHeadActive : null) }}
      >
        <AppWindow size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
        <span style={styles.groupName}>{group.tabName}</span>
        <span style={styles.groupCount}>{group.items.length}</span>
        <span style={{ ...styles.check, ...(groupChecked ? styles.checkOn : null) }}>
          {groupChecked && <Check size={10} strokeWidth={3} />}
        </span>
      </button>

      {group.items.map((pane, i) => (
        <TargetRow
          key={pane.key}
          pane={pane}
          index={i}
          checked={targetKeys.has(pane.key)}
          isActivePane={pane.key === terminalKey}
          onToggle={() => onToggleKey(pane.key)}
          t={t}
        />
      ))}
    </div>
  );
};

const TargetRow = ({ pane, index, checked, isActivePane, onToggle, t }) => (
  <button
    type="button"
    onClick={onToggle}
    style={{ ...styles.row, ...(checked ? styles.rowOn : null) }}
  >
    <span style={{ ...styles.check, ...(checked ? styles.checkOn : null) }}>
      {checked && <Check size={11} strokeWidth={3} />}
    </span>
    {/* 색 점 대신 pane 색으로 채운 아이콘 칩 — 식별력은 유지하면서 아이콘을 적극적으로 쓴다. */}
    <span style={{ ...styles.icon, background: pane.color }}>
      <SquareTerminal size={12} strokeWidth={2} color={PANE_ICON_INK} />
    </span>
    {/* 이름 + 호스트를 한 줄에 욱여넣지 않고 2줄로 — 좁은 팝업에서 둘 다 잘리는 걸 막는다. */}
    <span style={styles.text}>
      <span style={styles.name}>{t?.('pane') || 'Pane'} {index + 1}</span>
      {pane.host && <span style={styles.host} title={pane.host}>{pane.host}</span>}
    </span>
    {/* "활성" 은 이름 뒤에 붙이지 않고 행 끝 칩으로 — ellipsis 와 겹치지 않게. */}
    {isActivePane && (
      <span style={styles.activeTag}>{t?.('active') || '활성'}</span>
    )}
  </button>
);

const styles = {
  // 아이콘 + 현재값 배지. 공간 최소.
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    height: '30px',
    padding: `0 ${space['1.5']}`,
    borderRadius: radius.sm,
    border: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 80%, transparent)`,
    background: `var(--ui-surface0, ${color.surface0})`,
    color: `var(--ui-subtext, ${color.subtext})`,
    cursor: 'pointer',
    flexShrink: 0,
  },
  btnActive: {
    borderColor: `var(--ui-accent, ${color.accent})`,
    color: `var(--ui-accent, ${color.accent})`,
  },
  badge: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    fontFamily: font.mono,
    color: `var(--ui-text, ${color.text})`,
    lineHeight: 1,
  },
  // 메인 헤더(아이콘+제목+X)와 동일한 세로 패딩/최소높이 — 서브헤더만 얇아 보이지 않게.
  popupHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    minHeight: '38px',
    padding: `${space['2']} ${space['3']}`,
    fontSize: fontSize['11'], fontWeight: fontWeight.semibold,
    color: `var(--ui-subtext, ${color.subtext})`,
    background: `color-mix(in srgb, var(--ui-base, ${color.base}) 30%, transparent)`,
    borderBottom: `1px solid color-mix(in srgb, var(--ui-border, ${color.border}) 70%, transparent)`,
  },
  popupHint: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  allBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0,
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: `var(--ui-accent, ${color.accent})`, fontSize: fontSize['11'], fontWeight: fontWeight.medium,
    padding: `${space['1']} ${space['1.5']}`, marginRight: `-${space['1.5']}`, borderRadius: radius.sm,
  },
  // 고정 maxHeight 대신 flex:1 로 팝업(동적으로 계산된 maxHeight)의 남는 공간을 전부 차지 —
  // 헤더/노트를 뺀 나머지 안에서만 스크롤돼 항목이 잘리지 않는다.
  list: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: space['1'], display: 'flex', flexDirection: 'column', gap: '6px' },
  group: { display: 'flex', flexDirection: 'column', gap: '2px' },
  groupHead: {
    display: 'flex', alignItems: 'center', gap: space['1.5'], width: '100%',
    padding: `${space['1']} ${space['2']}`, background: 'transparent',
    border: 'none', borderRadius: radius.sm, cursor: 'pointer', textAlign: 'left',
    fontSize: '10.5px', fontWeight: fontWeight.semibold, letterSpacing: '0.02em',
    color: `var(--ui-muted, ${color.muted})`, textTransform: 'uppercase',
  },
  groupHeadActive: { color: `var(--ui-accent, ${color.accent})` },
  groupName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  groupCount: {
    flexShrink: 0, fontFamily: font.mono, fontSize: '10px', lineHeight: 1,
    padding: '2px 5px', borderRadius: '999px',
    background: `color-mix(in srgb, var(--ui-surface1, ${color.surface1}) 60%, transparent)`,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: space['2'], width: '100%',
    padding: `${space['1.5']} ${space['2']}`, paddingLeft: space['4'], background: 'transparent',
    border: 'none', borderRadius: radius.sm, cursor: 'pointer', textAlign: 'left',
  },
  rowOn: { background: `color-mix(in srgb, var(--ui-accent, ${color.accent}) 12%, transparent)` },
  check: {
    width: '16px', height: '16px', flexShrink: 0, borderRadius: '4px',
    border: `1px solid var(--ui-border, ${color.border})`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff',
  },
  checkOn: {
    background: `var(--ui-accent, ${color.accent})`,
    borderColor: `var(--ui-accent, ${color.accent})`,
  },
  icon: {
    width: '20px', height: '20px', borderRadius: '6px', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  // 이름/호스트 2줄 컬럼 — 남는 가로폭을 전부 쓰고 각 줄이 독립적으로 ellipsis.
  text: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px', overflow: 'hidden' },
  name: {
    minWidth: 0, fontSize: fontSize['12'], fontWeight: fontWeight.medium,
    color: `var(--ui-text, ${color.text})`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  host: {
    minWidth: 0, fontSize: '10.5px', fontFamily: font.mono,
    color: `var(--ui-muted, ${color.muted})`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  // 행 끝에 붙는 "활성" 칩 — 이름 ellipsis 와 분리돼 절대 겹치지 않는다.
  activeTag: {
    flexShrink: 0, lineHeight: 1, whiteSpace: 'nowrap',
    fontSize: '10px', fontWeight: fontWeight.semibold,
    padding: '3px 6px', borderRadius: '999px',
    color: `var(--ui-accent, ${color.accent})`,
    background: `color-mix(in srgb, var(--ui-accent, ${color.accent}) 16%, transparent)`,
    border: `1px solid color-mix(in srgb, var(--ui-accent, ${color.accent}) 32%, transparent)`,
  },
};

export default TargetSelect;
