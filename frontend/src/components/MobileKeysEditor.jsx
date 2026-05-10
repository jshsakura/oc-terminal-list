import { useState } from 'react';
import {
  Plus, Trash2, ArrowUp, ArrowDown, RotateCcw, Sparkles, ChevronUp,
  MessageSquare, ClipboardPaste, Image as ImageIcon, X as XIcon,
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
  if (kind === 'sep')      return { id: prev.id, kind: 'sep' };
  return prev;
};

/* kind 별 기본 아이콘 — picker 에서 "기본" 선택 시 시각화용. 실제 fallback 은 MobileToolbar 에서. */
const DEFAULT_ICON_FOR_KIND = {
  cmdInput: MessageSquare,
  paste: ClipboardPaste,
};

const MobileKeysEditor = ({ keys = DEFAULT_MOBILE_KEYS, onChange, t }) => {
  const [presetsOpen, setPresetsOpen] = useState(false);
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
          {KEY_PRESETS.map((p) => (
            <button
              key={p.label + p.payload}
              type="button"
              onClick={() => addPreset(p)}
              style={S.presetBtn}
              title={JSON.stringify(p.payload)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Row = ({ k, idx, total, isFirst, isLast, onUp, onDown, onRemove, onPatch, onChangeKind, tt }) => {
  const isSep = k.kind === 'sep';
  return (
    <div style={S.row}>
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
          {(k.kind === 'cmdInput' || k.kind === 'paste') && (
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
  list: { display: 'flex', flexDirection: 'column', gap: '4px' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 6px',
    background: color.surface0,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    minWidth: 0,
  },
  badge: {
    flexShrink: 0,
    width: '18px',
    height: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color.crust,
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
    background: color.crust,
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
    background: color.crust,
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
    background: color.crust,
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
    background: color.crust,
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
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    padding: space['2'],
  },
  presetBtn: {
    height: '26px',
    minWidth: '36px',
    padding: '0 8px',
    background: color.surface0,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.xs,
    fontSize: fontSize['11'],
    fontFamily: font.mono,
    cursor: 'pointer',
  },
};

export default MobileKeysEditor;
