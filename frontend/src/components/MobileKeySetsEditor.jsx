import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import MobileKeysEditor from './MobileKeysEditor';
import IconPickerPopup from './IconPickerPopup';
import HostIcon from '../utils/hostIcons';
import { MOBILE_KEY_SET_PRESETS, activeMobileKeySet, newMobileKeySetId, resolveMobileKeySets } from '../utils/mobileKeySets';
import { tokens } from '../styles/tokens';
import { Select } from './settings/SettingsFields';
import { styles as settingsStyles } from './settings/settingsStyles';

const { color, radius, space, fontSize } = tokens;

export default function MobileKeySetsEditor({ settings, onChange, t }) {
  const [iconOpen, setIconOpen] = useState(false);
  const sets = resolveMobileKeySets(settings);
  const active = activeMobileKeySet(settings, sets);
  const nameOf = set => set.name || t(set.nameKey || 'keySetCustom');
  const save = (next, selected = active.id) => onChange({ mobileKeySets: next, activeMobileKeySetId: selected });
  const update = patch => save(sets.map(set => set.id === active.id ? { ...set, ...patch } : set));
  const add = preset => {
    const set = { ...(preset || { nameKey: 'keySetCustom', keys: [{ id: 'input', kind: 'cmdInput', tone: 'accent' }] }),
      id: newMobileKeySetId(), label: String(Math.max(0, ...sets.map(set => Number(set.label) || 0)) + 1) };
    save([...sets, set], set.id);
  };

  return <div style={styles.wrap}>
    <label style={{ ...styles.field, flex: 'none' }}>{t('keySets')}
      <Select aria-label={t('keySets')} value={active.id}
        onChange={value => save(sets, value)}>
        {sets.map((set, index) => <option key={set.id} value={set.id}>{set.label || index + 1} · {nameOf(set)}</option>)}
      </Select>
    </label>
    <p style={styles.hint}>{t('keySetsHint')}</p>
    <div style={styles.row}>
      <label style={styles.field}>{t('keySetName')}
        <input aria-label={t('keySetName')} value={active.name ?? t(active.nameKey || 'keySetCustom')} style={styles.input}
          onChange={event => update({ name: event.target.value })} />
      </label>
      <label style={{ ...styles.field, flex: '0 1 100px' }}>{t('keySetLabel')}
        <input aria-label={t('keySetLabel')} value={active.label} maxLength={8} style={styles.input}
          onChange={event => update({ label: event.target.value })} />
      </label>
      <button type="button" aria-label={t('pickIcon')} title={t('pickIcon')} style={styles.button} onClick={() => setIconOpen(true)}>
        <HostIcon value={active.icon || 'Keyboard'} size={14} />
      </button>
      <button type="button" disabled={sets.length === 1} aria-label={t('deleteKeySet')} title={t('deleteKeySet')}
        style={styles.button} onClick={() => { const next = sets.filter(set => set.id !== active.id); save(next, next[0].id); }}><Trash2 size={16} /></button>
    </div>
    <div style={styles.row}>
      <button type="button" style={styles.button} onClick={() => add()}><Plus size={14} />{t('addKeySet')}</button>
      <label style={styles.field}>{t('addPresetSet')}
        <Select aria-label={t('addPresetSet')} value=""
          onChange={value => { const preset = MOBILE_KEY_SET_PRESETS.find(set => set.id === value); if (preset) add(preset); }}>
          <option value="">{t('presets')}</option>
          {MOBILE_KEY_SET_PRESETS.map(set => <option key={set.id} value={set.id}>{t(set.nameKey)}</option>)}
        </Select>
      </label>
    </div>
    <MobileKeysEditor key={active.id} keys={active.keys} multiplexer={settings.defaultMultiplexer}
      onChange={keys => update({ keys })} t={t} />
    <IconPickerPopup isOpen={iconOpen} value={active.icon} onChange={icon => update({ icon })}
      onClose={() => setIconOpen(false)} t={t} />
  </div>;
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: space['3'] },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: space['2'] },
  field: { display: 'flex', flexDirection: 'column', gap: space['1'], flex: '1 1 0px', minWidth: 0,
    color: color.subtext, fontSize: fontSize['12'] },
  input: { ...settingsStyles.input, boxSizing: 'border-box', minWidth: 0 },
  button: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: space['1'], height: settingsStyles.input.height,
    border: `1px solid ${color.border}`, borderRadius: radius.sm, background: color.surface0,
    color: color.text, padding: `0 ${space['2']}`, cursor: 'pointer', fontSize: fontSize['12'] },
  hint: { margin: 0, color: color.subtext, fontSize: fontSize['12'], lineHeight: 1.5 },
};
