import { useState } from 'react';
import {
  Plus, Trash2, ArrowUp, ArrowDown, RotateCcw, Sparkles, ChevronUp,
  ChevronDown, MessageSquare, ClipboardPaste, Image as ImageIcon, X as XIcon,
  Copy, FileText, ArrowLeft, ArrowRight, CornerDownLeft, Home, Keyboard, Terminal,
  GripVertical,
} from 'lucide-react';
import { tokens } from '../styles/tokens';
import { DEFAULT_MOBILE_KEYS, KEY_PRESETS, decodeUserPayload } from '../utils/mobileKeys';
import IconPickerPopup from './IconPickerPopup';
import HostIcon from '../utils/hostIcons';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

const KIND_OPTIONS = [
  { value: 'send',     labelKey: 'kindSendKey',  fallback: 'Send key' },
  { value: 'mod',      labelKey: 'kindModifier', fallback: 'Modifier' },
  { value: 'cmdInput', labelKey: 'kindCmdInput', fallback: 'Quick Input' },
  { value: 'paste',    labelKey: 'kindPaste',    fallback: 'Paste' },
  { value: 'copy',     labelKey: 'kindCopy',     fallback: 'Copy' },
  { value: 'copyAll',  labelKey: 'kindCopyAll',  fallback: 'Copy all' },
  { value: 'sep',      labelKey: 'kindDivider',  fallback: 'Divider' },
];

const TONE_OPTIONS = [
  { value: '',       labelKey: 'toneDefault', fallback: 'Default' },
  { value: 'accent', labelKey: 'toneAccent',  fallback: 'Accent' },
  { value: 'danger', labelKey: 'toneDanger',  fallback: 'Danger' },
  { value: 'muted',  labelKey: 'toneMuted',   fallback: 'Muted' },
];

const newId = () => Math.random().toString(36).slice(2, 9);

// kind 변경 시 종류별 필수 필드를 채워주고 무관 필드는 비움.
// 모든 비-sep 종류는 icon + label 을 동시에 가질 수 있음 (택일 X).
const morphForKind = (kind, prev = {}) => {
  const base = { id: prev.id, kind, tone: prev.tone, icon: prev.icon || '', label: prev.label || '' };
  if (kind === 'send')     return { ...base, payload: prev.payload || '' };
  if (kind === 'mod')      return { ...base, modifier: prev.modifier || 'ctrl' };
  if (kind === 'cmdInput') return { ...base };
  if (kind === 'paste')    return { ...base };
  if (kind === 'copy')     return { ...base };
  if (kind === 'copyAll')  return { ...base };
  if (kind === 'sep')      return { id: prev.id, kind: 'sep' };
  return prev;
};

/* kind 별 기본 아이콘 — picker 에서 "기본" 선택 시 시각화용. 실제 fallback 은 MobileToolbar 에서. */
const DEFAULT_ICON_FOR_KIND = {
  cmdInput: MessageSquare,
  paste: ClipboardPaste,
  copy: Copy,
  copyAll: FileText,
};

const PAYLOAD_META = {
  '\x1b[D': { key: 'Left', Icon: ArrowLeft, code: '\\e[D' },
  '\x1b[A': { key: 'Up', Icon: ArrowUp, code: '\\e[A' },
  '\x1b[B': { key: 'Down', Icon: ArrowDown, code: '\\e[B' },
  '\x1b[C': { key: 'Right', Icon: ArrowRight, code: '\\e[C' },
  '\x1b[H': { key: 'Home', Icon: Home, code: '\\e[H' },
  '\x1b[F': { key: 'End', Icon: Home, code: '\\e[F' },
  '\x1b[5~': { key: 'PgUp', Icon: ChevronUp, code: '\\e[5~' },
  '\x1b[6~': { key: 'PgDn', Icon: ChevronDown, code: '\\e[6~' },
  '\x1b[2~': { key: 'Ins', Icon: Keyboard, code: '\\e[2~' },
  '\x1b[3~': { key: 'Del', Icon: XIcon, code: '\\e[3~' },
  '\x1b': { key: 'Esc', Icon: Keyboard, code: '\\e' },
  ' ': { key: 'Space', Icon: Keyboard, code: '␠' },
  '\t': { key: 'Tab', Icon: Keyboard, code: '\\t' },
  '\x1b[Z': { key: 'Shift+Tab', Icon: Keyboard, code: '\\e[Z' },
  '\r': { key: 'Enter', Icon: CornerDownLeft, code: '\\r' },
  '\n': { key: 'Shift+Enter', Icon: CornerDownLeft, code: '\\n' },
  '\x7f': { key: 'Backspace', Icon: XIcon, code: '\\x7f' },
  '\x1bOP': { key: 'F1', Icon: Keyboard, code: '\\eOP' },
  '\x1bOQ': { key: 'F2', Icon: Keyboard, code: '\\eOQ' },
  '\x1bOR': { key: 'F3', Icon: Keyboard, code: '\\eOR' },
  '\x1bOS': { key: 'F4', Icon: Keyboard, code: '\\eOS' },
  '\x1b[15~': { key: 'F5', Icon: Keyboard, code: '\\e[15~' },
  '\x1b[17~': { key: 'F6', Icon: Keyboard, code: '\\e[17~' },
  '\x1b[18~': { key: 'F7', Icon: Keyboard, code: '\\e[18~' },
  '\x1b[19~': { key: 'F8', Icon: Keyboard, code: '\\e[19~' },
  '\x1b[20~': { key: 'F9', Icon: Keyboard, code: '\\e[20~' },
  '\x1b[21~': { key: 'F10', Icon: Keyboard, code: '\\e[21~' },
  '\x1b[23~': { key: 'F11', Icon: Keyboard, code: '\\e[23~' },
  '\x1b[24~': { key: 'F12', Icon: Keyboard, code: '\\e[24~' },
};

const CONTROL_KEY_LABELS = {
  '\x00': 'Ctrl+Space',
  '\x01': 'Ctrl+A',
  '\x02': 'Ctrl+B',
  '\x03': 'Ctrl+C',
  '\x04': 'Ctrl+D',
  '\x05': 'Ctrl+E',
  '\x06': 'Ctrl+F',
  '\x0b': 'Ctrl+K',
  '\x0c': 'Ctrl+L',
  '\x0e': 'Ctrl+N',
  '\x10': 'Ctrl+P',
  '\x12': 'Ctrl+R',
  '\x14': 'Ctrl+T',
  '\x15': 'Ctrl+U',
  '\x17': 'Ctrl+W',
  '\x19': 'Ctrl+Y',
  '\x1a': 'Ctrl+Z',
  '\x1c': 'Ctrl+\\',
};

const ALT_KEY_LABELS = {
  '\x1bb': 'Alt+B',
  '\x1bf': 'Alt+F',
  '\x1bd': 'Alt+D',
  '\x1b.': 'Alt+.',
};

const MobileKeysEditor = ({ keys = DEFAULT_MOBILE_KEYS, onChange, t }) => {
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const tt = (key, fb) => (t?.(key) || fb);

  const list = Array.isArray(keys) && keys.length ? keys : DEFAULT_MOBILE_KEYS;

  const update = (idx, patch) => onChange?.(list.map((k, i) => (i === idx ? { ...k, ...patch } : k)));
  const replace = (idx, next) => onChange?.(list.map((k, i) => (i === idx ? next : k)));
  const remove = (idx) => onChange?.(list.filter((_, i) => i !== idx));
  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange?.(next);
  };
  const moveTo = (from, to) => {
    if (from == null || to == null || from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange?.(next);
  };
  const clearDrag = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };
  const addPreset = (preset) => {
    // preset.kind 가 명시되어 있으면 (예: 'sep') 그걸 사용, 없으면 'send'.
    const { kind: presetKind, ...rest } = preset;
    const kind = presetKind || 'send';
    if (kind === 'sep') {
      onChange?.([...list, { id: newId(), kind: 'sep' }]);
      return;
    }
    onChange?.([...list, { id: newId(), kind, ...rest }]);
  };
  const addEmpty = () => {
    onChange?.([...list, { id: newId(), kind: 'send', label: 'X', payload: '' }]);
  };
  const reset = () => onChange?.(DEFAULT_MOBILE_KEYS);

  return (
    <>
    <style>{`
      @media (max-width: 640px) {
        .iterm-mobile-key-drag-handle { display: none !important; }
      }
    `}</style>
    <div style={S.wrap}>
      <div style={S.list}>
        {list.map((k, idx) => (
          <Row
            key={k.id}
            k={k}
            idx={idx}
            total={list.length}
            isFirst={idx === 0}
            isLast={idx === list.length - 1}
            onUp={() => move(idx, -1)}
            onDown={() => move(idx, 1)}
            onRemove={() => remove(idx)}
            onPatch={(patch) => update(idx, patch)}
            onChangeKind={(nextKind) => replace(idx, morphForKind(nextKind, k))}
            isDragging={dragIndex === idx}
            isDragOver={dragOverIndex === idx && dragIndex !== idx}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(idx));
              setDragIndex(idx);
              setDragOverIndex(idx);
            }}
            onDragOver={(e) => {
              if (dragIndex == null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (idx !== dragOverIndex) setDragOverIndex(idx);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const fromRaw = e.dataTransfer.getData('text/plain');
              const from = dragIndex ?? (fromRaw ? Number(fromRaw) : null);
              moveTo(from, idx);
              clearDrag();
            }}
            onDragEnd={clearDrag}
            tt={tt}
          />
        ))}
      </div>

      <div style={S.actions}>
        <button type="button" onClick={addEmpty} style={S.addBtn} title={tt('addEmptyKey', 'Add empty')}>
          <Plus size={12} strokeWidth={2.4} />
          <span>{tt('addEmptyKey', 'Add empty')}</span>
        </button>
        <button
          type="button"
          onClick={() => setPresetsOpen((v) => !v)}
          style={{ ...S.secondaryBtn, ...(presetsOpen ? S.secondaryBtnActive : null) }}
          title={tt('presets', 'Presets')}
        >
          {presetsOpen
            ? <ChevronUp size={12} strokeWidth={2.2} />
            : <Sparkles size={12} strokeWidth={2.2} />}
          <span>{tt('presets', 'Presets')}</span>
        </button>
        <button type="button" onClick={reset} style={S.secondaryBtn} title={tt('restoreDefaults', 'Restore defaults')}>
          <RotateCcw size={12} strokeWidth={2.2} />
          <span>{tt('restoreDefaults', 'Restore defaults')}</span>
        </button>
      </div>

      {presetsOpen && (
        <div style={S.presetGrid}>
          {KEY_PRESETS.map((p, idx) => (
            <PresetButton
              key={`${p.kind || 'send'}-${p.label || ''}-${p.payload || ''}-${idx}`}
              preset={p}
              onClick={() => addPreset(p)}
              tt={tt}
            />
          ))}
        </div>
      )}
    </div>
    </>
  );
};

const PresetButton = ({ preset, onClick, tt }) => {
  const meta = getPresetMeta(preset, tt);
  const Icon = meta.Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      style={S.presetBtn}
      title={`${meta.key} · ${meta.detail}`}
    >
      <span style={S.presetIconSlot} aria-hidden="true">
        {preset.icon ? (
          <HostIcon value={preset.icon} size={15} strokeWidth={2.1} />
        ) : Icon ? (
          <Icon size={15} strokeWidth={2.1} />
        ) : (
          <span style={S.presetDividerIcon}>│</span>
        )}
      </span>
      <span style={S.presetCopy}>
        <span style={S.presetKey}>{meta.key}</span>
        <span style={S.presetDetail}>{meta.detail}</span>
      </span>
    </button>
  );
};

const Row = ({
  k, idx, total, isFirst, isLast, onUp, onDown, onRemove, onPatch, onChangeKind,
  isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd, tt,
}) => {
  const isSep = k.kind === 'sep';
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ ...S.row, ...(isDragging ? S.rowDragging : null), ...(isDragOver ? S.rowDragOver : null) }}
    >
      <button
        type="button"
        className="iterm-mobile-key-drag-handle"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title={tt('dragToReorder', 'Drag to reorder')}
        style={S.dragHandle}
      >
        <GripVertical size={13} strokeWidth={2} />
      </button>

      {/* index badge */}
      <span style={S.badge}>{idx + 1}</span>

      {/* kind */}
      <KindSelect value={k.kind} onChange={onChangeKind} tt={tt} />

      {isSep ? (
        <span style={S.sepLabel}>— {tt('kindDivider', 'Divider')}</span>
      ) : (
        <>
          {/* icon picker */}
          <IconButton value={k.icon || ''} kind={k.kind} onChange={(icon) => onPatch({ icon })} tt={tt} />

          {/* label */}
          <input
            type="text"
            value={k.label || ''}
            onChange={(e) => onPatch({ label: e.target.value })}
            placeholder={tt('fieldLabel', 'Label')}
            style={{ ...S.input, width: 64 }}
          />

          {/* payload / modifier */}
          {k.kind === 'send' && (
            <input
              type="text"
              value={displayPayload(k.payload)}
              onChange={(e) => onPatch({ payload: decodeUserPayload(e.target.value) })}
              placeholder={tt('payloadHint', '\\e, \\n…')}
              style={{ ...S.input, flex: 1, fontFamily: font.mono }}
            />
          )}
          {k.kind === 'mod' && (
            <select
              value={k.modifier || 'ctrl'}
              onChange={(e) => onPatch({ modifier: e.target.value })}
              style={{ ...S.select, width: 72 }}
            >
              <option value="ctrl">ctrl</option>
              <option value="alt">alt</option>
            </select>
          )}
          {(['cmdInput', 'paste', 'copy', 'copyAll'].includes(k.kind)) && (
            <span style={{ flex: 1 }} />
          )}

          {/* tone */}
          <select
            value={k.tone || ''}
            onChange={(e) => onPatch({ tone: e.target.value || undefined })}
            style={{ ...S.select, width: 80 }}
          >
            {TONE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{tt(o.labelKey, o.fallback)}</option>
            ))}
          </select>
        </>
      )}

      <RowActions {...{ isFirst, isLast, onUp, onDown, onRemove, tt }} />
    </div>
  );
};

const IconButton = ({ value, kind, onChange, tt }) => {
  const [open, setOpen] = useState(false);
  const FallbackIcon = DEFAULT_ICON_FOR_KIND[kind];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={value ? tt('changeIcon', 'Change icon') : tt('pickIcon', 'Pick icon')}
        style={S.iconPickerBtn}
      >
        {value ? (
          <HostIcon value={value} size={14} strokeWidth={2} />
        ) : FallbackIcon ? (
          <span style={{ display: 'inline-flex', color: color.muted }}>
            <FallbackIcon size={14} strokeWidth={2} />
          </span>
        ) : (
          <ImageIcon size={13} strokeWidth={1.8} style={{ color: color.muted, opacity: 0.6 }} />
        )}
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          title={tt('clearIcon', 'Clear icon')}
          style={S.iconClearBtn}
        >
          <XIcon size={10} strokeWidth={2.4} />
        </button>
      )}
      <IconPickerPopup
        isOpen={open}
        value={value}
        onChange={(key) => onChange(key || '')}
        onClose={() => setOpen(false)}
        t={tt}
      />
    </>
  );
};


const KindSelect = ({ value, onChange, tt }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    style={S.kindSelect}
    title={tt('fieldKind', 'Type')}
  >
    {KIND_OPTIONS.map((o) => (
      <option key={o.value} value={o.value}>{tt(o.labelKey, o.fallback)}</option>
    ))}
  </select>
);

// payload → \\e, \\n 같은 사용자 친화 표기 (편집창)
const displayPayload = (p) => {
  if (typeof p !== 'string') return '';
  return p
    .replace(/\\/g, '\\\\')
    .replace(/\x1b/g, '\\e')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x1f\x7f]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));
};

const getPresetMeta = (preset, tt) => {
  const kind = preset.kind || 'send';
  if (kind === 'copy') {
    return { key: tt('copy', 'Copy'), detail: tt('presetAction', 'Action'), Icon: Copy };
  }
  if (kind === 'copyAll') {
    return { key: tt('copyAll', 'Copy all'), detail: tt('presetAction', 'Action'), Icon: FileText };
  }
  if (kind === 'paste') {
    return { key: tt('paste', 'Paste'), detail: tt('presetAction', 'Action'), Icon: ClipboardPaste };
  }
  if (kind === 'sep') {
    return { key: tt('kindDivider', 'Divider'), detail: tt('presetSeparator', 'Separator'), Icon: null };
  }

  const payload = preset.payload || '';
  if (PAYLOAD_META[payload]) {
    const meta = PAYLOAD_META[payload];
    return { key: meta.key, detail: meta.code, Icon: meta.Icon };
  }
  if (CONTROL_KEY_LABELS[payload]) {
    return { key: CONTROL_KEY_LABELS[payload], detail: displayPayload(payload), Icon: Keyboard };
  }
  if (ALT_KEY_LABELS[payload]) {
    return { key: ALT_KEY_LABELS[payload], detail: displayPayload(payload), Icon: Keyboard };
  }

  const key = preset.label || displayPayload(payload) || '?';
  const isSubmitText = payload.endsWith('\r') && payload.length > 1;
  return {
    key,
    detail: isSubmitText ? tt('presetTextEnter', 'Text + Enter') : tt('presetText', 'Text'),
    Icon: Terminal,
  };
};

const RowActions = ({ isFirst, isLast, onUp, onDown, onRemove, tt }) => (
  <div style={S.rowActions}>
    <IconBtn disabled={isFirst} onClick={onUp} title={tt('moveUp', 'Move up')}>
      <ArrowUp size={11} strokeWidth={2} />
    </IconBtn>
    <IconBtn disabled={isLast} onClick={onDown} title={tt('moveDown', 'Move down')}>
      <ArrowDown size={11} strokeWidth={2} />
    </IconBtn>
    <IconBtn onClick={onRemove} title={tt('removeRow', 'Remove')} tone="danger">
      <Trash2 size={11} strokeWidth={2} />
    </IconBtn>
  </div>
);

const IconBtn = ({ children, onClick, disabled, title, tone }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      ...S.iconBtn,
      color: tone === 'danger' ? color.danger : color.subtext,
      opacity: disabled ? 0.3 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
  >
    {children}
  </button>
);

const S = {
  wrap: { display: 'flex', flexDirection: 'column', gap: space['2'] },
  // 모바일 좁은 화면에서 row 가 쪼그라들지 않도록 가로 스크롤. 데스크탑은 자연스럽게 100% 폭.
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'thin',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 6px',
    background: `color-mix(in srgb, ${color.surface0} var(--glass-fill, 82%)%, transparent)`,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    // 가로 최소폭 — 좁은 화면에서 이 폭 유지하고 부모가 스크롤.
    minWidth: '460px',
    transition: 'background 120ms, border-color 120ms, opacity 120ms, transform 120ms',
  },
  rowDragging: {
    opacity: 0.58,
    borderColor: color.accentBorder,
  },
  rowDragOver: {
    borderColor: color.accent,
    background: `color-mix(in srgb, ${color.accent} 10%, ${color.surface0})`,
    transform: 'translateY(-1px)',
  },
  dragHandle: {
    width: '20px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '3px',
    color: color.muted,
    cursor: 'grab',
    flexShrink: 0,
    padding: 0,
    touchAction: 'none',
  },
  badge: {
    flexShrink: 0,
    width: '18px',
    height: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.mantle,
    border: `1px solid ${color.border}`,
    borderRadius: '3px',
    fontSize: '10px',
    color: color.muted,
    fontFamily: font.mono,
  },
  sepLabel: {
    flex: 1,
    fontSize: fontSize['11'],
    color: color.muted,
    fontFamily: font.mono,
    letterSpacing: '0.1em',
  },
  iconPickerBtn: {
    width: '26px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.mantle,
    border: `1px solid ${color.border}`,
    borderRadius: '3px',
    color: color.text,
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
  },
  iconClearBtn: {
    width: '14px',
    height: '14px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: color.muted,
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
    marginLeft: '-4px',
  },
  kindSelect: {
    height: '24px',
    padding: '0 4px',
    background: color.mantle,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: '3px',
    fontSize: '11px',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
    flexShrink: 0,
    width: 90,
  },
  input: {
    height: '24px',
    padding: '0 6px',
    background: color.mantle,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: '3px',
    fontSize: fontSize['12'],
    fontFamily: 'inherit',
    outline: 'none',
    minWidth: 0,
  },
  select: {
    height: '24px',
    padding: '0 4px',
    background: color.mantle,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: '3px',
    fontSize: fontSize['12'],
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
    flexShrink: 0,
  },
  rowActions: { display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0, marginLeft: 'auto' },
  iconBtn: {
    width: '22px',
    height: '22px',
    background: 'transparent',
    border: 'none',
    borderRadius: '3px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  actions: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  addBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '4px 10px',
    background: color.accentSubtle,
    color: color.accent,
    border: `1px solid ${color.accentBorder}`,
    borderRadius: radius.sm,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  secondaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '4px 10px',
    background: 'transparent',
    color: color.subtext,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['12'],
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  secondaryBtnActive: {
    background: color.surface1,
    color: color.text,
    borderColor: color.borderStrong,
  },
  presetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))',
    gap: '6px',
    background: `color-mix(in srgb, ${color.surface0} var(--glass-fill, 72%)%, transparent)`,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    padding: space['2'],
  },
  presetBtn: {
    height: '44px',
    width: '100%',
    minWidth: 0,
    padding: '0 8px',
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr)',
    alignItems: 'center',
    gap: '7px',
    textAlign: 'left',
    background: `color-mix(in srgb, ${color.mantle} var(--glass-fill, 88%)%, transparent)`,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    fontSize: fontSize['11'],
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  presetIconSlot: {
    width: '24px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    color: color.accent,
    flexShrink: 0,
  },
  presetDividerIcon: {
    fontFamily: font.mono,
    fontSize: fontSize['13'],
    lineHeight: 1,
    color: color.muted,
  },
  presetCopy: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: '2px',
  },
  presetKey: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: font.mono,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.semibold,
    lineHeight: 1.05,
  },
  presetDetail: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: font.mono,
    fontSize: '10px',
    lineHeight: 1,
    color: color.muted,
  },
};

export default MobileKeysEditor;
