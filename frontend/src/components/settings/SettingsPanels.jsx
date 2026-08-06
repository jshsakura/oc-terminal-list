import { LogOut, Server, ChevronRight, Plus, Key as KeyIcon } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import ThemePicker from '../common/ThemePicker';
import HostIcon from '../../utils/hostIcons';
import OtpSection from '../OtpSection';
import PasskeySection from '../PasskeySection';
import PasswordSection from '../PasswordSection';
import MobileKeysEditor from '../MobileKeysEditor';
import useHostReorder from '../../hooks/useHostReorder';
import { DEFAULT_MOBILE_KEYS } from '../../utils/mobileKeys';
import { styles, shortcutStyles } from './settingsStyles';
import { Section, Divider, Field, Select, Toggle, FontSizeRow, ShortcutRow } from './SettingsFields';
import PushNotificationToggle from './PushNotificationToggle';
import TelegramSection from './TelegramSection';
import LlmWatcherSection from './LlmWatcherSection';

const { color, space } = tokens;

const HOST_DOT_PALETTE_FALLBACK = '#89b4fa';

export const GeneralPanel = ({ s, change, username, onLogout, t }) => (
  <>
    <Section title={t('account') || 'Account'}>
      {username && (
        <Field label={t('user')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space['2'] }}>
            <div style={{ ...styles.readonly, flex: 1 }}>
              {username}
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                style={styles.inlineLogoutBtn}
                onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; e.currentTarget.style.borderColor = color.muted; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; e.currentTarget.style.borderColor = color.border; }}
              >
                <LogOut size={11} strokeWidth={2} />
                <span>{t('logout') || 'Logout'}</span>
              </button>
            )}
          </div>
        </Field>
      )}
      <Field label={t('defaultShell')}>
        <Select value={s.defaultShell || 'bash'} onChange={(v) => change('defaultShell', v)}>
          <option value="bash">{t('shellBash')}</option>
          <option value="zsh">{t('shellZsh')}</option>
          <option value="sh">{t('shellSh')}</option>
          <option value="auto">{t('shellAuto')}</option>
        </Select>
      </Field>
      <Field
        label={t('localStartPath') || 'This machine — start path'}
        hint={t('localStartPathHint') || 'Workspace-relative path. Empty = workspace root.'}
      >
        <input
          type="text"
          value={s.localStartPath || ''}
          onChange={(e) => change('localStartPath', e.target.value)}
          placeholder="projects/my-app"
          style={styles.input}
        />
      </Field>
    </Section>

    <Divider />

    <Section title={t('changePassword') || 'Change password'}>
      <PasswordSection onLogout={onLogout} t={t} />
    </Section>

    <Divider />

    <Section title={t('twoFactorAuth') || 'Two-factor authentication'}>
      <OtpSection t={t} />
    </Section>

    <Divider />

    <Section title={t('passkeys') || 'Passkeys'}>
      <PasskeySection t={t} />
    </Section>

    <Divider />

    <Section title={t('appearance') || 'Appearance'}>
      <Field label={t('theme')}>
        <ThemePicker value={s.theme} onChange={(v) => change('theme', v)} t={t} columns={2} />
      </Field>
      <Field label={t('language')}>
        <Select value={s.language} onChange={(v) => change('language', v)}>
          <option value="en">{t('languageEnglish')}</option>
          <option value="ko">{t('languageKorean')}</option>
        </Select>
      </Field>
      <Field label={`${t('fontSize')} (PC) · ${s.fontSize ?? 12}px`}>
        <FontSizeRow
          value={s.fontSize ?? 12}
          onChange={(v) => change('fontSize', v)}
        />
      </Field>
      <Field
        label={t('textContrast') || 'Text contrast'}
        hint={t('textContrastHint') || 'High maximizes legibility but flattens theme colors. Original shows the theme palette as-is.'}
      >
        <Select value={s.terminalContrast ?? 'high'} onChange={(v) => change('terminalContrast', v)}>
          <option value="high">{t('textContrastHigh') || 'High (default)'}</option>
          <option value="balanced">{t('textContrastBalanced') || 'Balanced'}</option>
          <option value="original">{t('textContrastOriginal') || 'Original palette'}</option>
        </Select>
      </Field>
    </Section>

    <Divider />

    <Section title={t('notifications') || 'Notifications'}>
      <PushNotificationToggle t={t} />
      {/* 버튼이 붙는 알림은 텔레그램이 맡는다 — 웹푸시 액션 버튼은 iOS 에서 안 뜬다. */}
      <TelegramSection t={t} />
    </Section>

    <Divider />

    <Section title={t('llmUsageSection') || 'LLM usage'}>
      <LlmWatcherSection t={t} />
      {/* 통화 — 자동은 언어를 따른다(한국어 → 원). 환율은 서버가 하루 한 번 받아 캐시. */}
      <Field label={t('currency') || 'Currency'}>
        <Select value={s.currency || 'auto'} onChange={(v) => change('currency', v)}>
          <option value="auto">{t('currencyAuto') || 'Auto (follows language)'}</option>
          <option value="usd">USD ($)</option>
          <option value="krw">KRW (₩)</option>
        </Select>
      </Field>
    </Section>

    <Divider />

    <Section title={t('scrollBehavior') || 'Scroll'}>
      <Field label={t('autoScroll')}>
        <Select value={s.autoScroll} onChange={(v) => change('autoScroll', v)}>
          <option value="always">{t('autoScrollAlways') || 'Always'}</option>
          <option value="smart">{t('autoScrollSmart') || 'Smart'}</option>
          <option value="never">{t('autoScrollNever') || 'Manual'}</option>
        </Select>
      </Field>
      <Toggle
        label={t('smoothScroll')}
        checked={s.smoothScroll}
        onChange={(v) => change('smoothScroll', v)}
      />
      <Toggle
        label={t('predictiveEcho') || 'Predictive echo'}
        hint={t('predictiveEchoHint') || 'Show typed characters instantly without waiting for the server (mosh-style). Auto-disabled in editors and password prompts.'}
        checked={s.predictiveEcho !== false}
        onChange={(v) => change('predictiveEcho', v)}
      />
      <Field
        label={`${t('scrollSensitivity')} · ${(s.scrollSensitivity ?? 0.8).toFixed(1)}`}
        hint={t('scrollSensitivityHint')}
      >
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={s.scrollSensitivity ?? 0.8}
          onChange={(e) => change('scrollSensitivity', parseFloat(e.target.value))}
          style={styles.slider}
        />
      </Field>
    </Section>

  </>
);

export const MobilePanel = ({ s, change, t }) => (
  <>
    <Section title={t('appearance') || 'Appearance'}>
      <Field
        label={`${t('fontSizeMobile') || 'Font size (Mobile)'} · ${s.fontSizeMobile ?? 13}px`}
        hint={t('mobileTabHint') || 'Settings that only apply on mobile devices.'}
      >
        <FontSizeRow
          value={s.fontSizeMobile ?? 13}
          onChange={(v) => change('fontSizeMobile', v)}
        />
      </Field>
    </Section>

    <Divider />

    <Section title={t('mobileKeys') || 'Mobile shortcut bar'}>
      <MobileKeysEditor
        keys={s.mobileKeys ?? DEFAULT_MOBILE_KEYS}
        onChange={(next) => change('mobileKeys', next)}
        t={t}
      />
    </Section>
  </>
);

export const HostsPanel = ({ hosts, settings, refreshHosts, onAdd, onEdit, onEditLocal, t }) => {
  // 모든 사용처와 동일한 hook → 어디서 옮겨도 같은 서버 sort_index 로 동기.
  const { orderedHosts, rowPropsFor } = useHostReorder(hosts, refreshHosts);
  const localAccent = tokens.color.dotPalette[(settings?.localColorIndex ?? 0) % tokens.color.dotPalette.length] || HOST_DOT_PALETTE_FALLBACK;
  const localName = (settings?.localName || '').trim() || (t('thisMachine') || 'This machine');
  const localSub = [
    'localhost',
    (settings?.localStartPath || '').trim() || (t('noStartPath') || 'No start path'),
  ].join(' · ');
  return (
    <Section title={t('savedHosts') || 'Saved hosts'}>
      {/* 로컬 + 원격을 같은 list 컨테이너로 묶어 동일 4px gap — sectionBody 의 12px 간격으로 떨어지지 않게. */}
      <div style={styles.list}>
        <button
          type="button"
          onClick={() => onEditLocal?.()}
          style={styles.listRow}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; }}
        >
          <span style={{ ...styles.listIcon, color: localAccent }}>
            <HostIcon value={settings?.localIcon || ''} fallback={Server} size={14} />
          </span>
          <div style={styles.listText}>
            <div style={styles.listName}>{localName}</div>
            <div style={styles.listSub}>{localSub}</div>
          </div>
          <ChevronRight size={12} strokeWidth={1.8} style={{ color: color.muted, flexShrink: 0 }} />
        </button>

        {hosts.length === 0 && (
          <div style={styles.empty}>{t('noHostsYet') || 'No hosts yet. Add one to get started.'}</div>
        )}
        {orderedHosts.map((host) => {
          const palette = tokens.color.dotPalette || [HOST_DOT_PALETTE_FALLBACK];
          const accent = palette[(host.color_index || 0) % palette.length] || HOST_DOT_PALETTE_FALLBACK;
          const rp = rowPropsFor(host);
          return (
            <div
              key={host.id}
              data-host-row={rp['data-host-row']}
              onPointerDown={rp.onPointerDown}
              onClick={() => onEdit?.(host)}
              onMouseEnter={(e) => { if (!rp.isDragOver) e.currentTarget.style.background = color.surface1; }}
              onMouseLeave={(e) => { if (!rp.isDragOver) e.currentTarget.style.background = color.surface0; }}
              style={{
                ...styles.listRow,
                cursor: rp.isDragging ? 'grabbing' : 'pointer',
                border: rp.isDragging
                  ? `1px solid ${color.accent}`
                  : (rp.isDragOver ? `2px dashed ${color.accent}` : `1px solid ${color.border}`),
                background: rp.isDragging
                  ? color.surface2
                  : (rp.isDragOver ? color.surface2 : color.surface0),
                boxShadow: rp.isDragging ? `0 6px 18px ${color.accent}40` : 'none',
                transform: rp.isDragging ? 'translateY(-1px) scale(1.005)' : 'none',
                transition: 'background 120ms, border-color 120ms, box-shadow 120ms',
                touchAction: 'pan-y',
                userSelect: 'none',
              }}
            >
              <span style={{ ...styles.listIcon, color: accent }}>
                <HostIcon value={host.icon || ''} fallback={Server} size={14} />
              </span>
              <div style={styles.listText}>
                <div style={styles.listName}>{host.name}</div>
                <div style={styles.listSub}>
                  {host.ssh_user}@{host.hostname}
                  {host.port && host.port !== 22 ? `:${host.port}` : ''}
                </div>
              </div>
              <ChevronRight size={12} strokeWidth={1.8} style={{ color: color.muted, flexShrink: 0 }} />
            </div>
          );
        })}
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          style={styles.addRow}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; }}
        >
          <span style={{ ...styles.listIcon, color: color.accent }}>
            <Plus size={14} strokeWidth={2} />
          </span>
          <div style={styles.listText}>
            <div style={styles.listName}>{t('addHost') || 'Add host'}</div>
          </div>
        </button>
      )}
    </Section>
  );
};

export const KeysPanel = ({ keys, onAdd, onEdit, t }) => (
  <Section title={t('sshKeys') || 'SSH Keys'}>
    {keys.length === 0 && (
      <div style={styles.empty}>{t('noKeys') || 'No SSH keys yet'}</div>
    )}
    <div style={styles.list}>
      {keys.map((key) => (
        <button
          key={key.id}
          type="button"
          onClick={() => onEdit?.(key)}
          style={styles.listRow}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; }}
        >
          <span style={{ ...styles.listIcon, color: color.accent }}>
            <KeyIcon size={14} strokeWidth={1.8} />
          </span>
          <div style={styles.listText}>
            <div style={styles.listName}>{key.name}</div>
            <div style={styles.listSub}>
              {key.public_key ? key.public_key.split(' ')[0] : (t('privateKey') || 'Private key')}
            </div>
          </div>
          <ChevronRight size={12} strokeWidth={1.8} style={{ color: color.muted, flexShrink: 0 }} />
        </button>
      ))}
    </div>
    {onAdd && (
      <button
        type="button"
        onClick={onAdd}
        style={styles.addRow}
        onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; }}
      >
        <span style={{ ...styles.listIcon, color: color.accent }}>
          <Plus size={14} strokeWidth={2} />
        </span>
        <div style={styles.listText}>
          <div style={styles.listName}>{t('addKey') || 'Add SSH key'}</div>
        </div>
      </button>
    )}
  </Section>
);

export const InfoPanel = ({ t }) => (
  <Section title={t('infoShortcuts') || 'Shortcuts'}>
    <div style={shortcutStyles.group}>
      <ShortcutRow keys={[t('drag') || 'Drag']} desc={t('shortcutSelect') || 'Select text (auto-copy)'} />
      <ShortcutRow keys={[t('doubleClick') || 'Double-click']} desc={t('shortcutSelectWord') || 'Select word'} />
      <ShortcutRow keys={[t('tripleClick') || 'Triple-click']} desc={t('shortcutSelectLine') || 'Select line'} />
      <ShortcutRow keys={[t('rightClick') || 'Right-click']} desc={t('shortcutContextMenu') || 'Context menu'} />
      <ShortcutRow keys={[t('wheel') || 'Wheel']} desc={t('shortcutScroll') || 'Scroll terminal history'} />
    </div>
    <Divider />
    <div style={shortcutStyles.group}>
      <ShortcutRow keys={['Ctrl', 'V']} desc={t('shortcutPaste') || 'Paste (bracketed)'} />
      <ShortcutRow keys={['Ctrl', 'Shift', 'C']} desc={t('shortcutCopy') || 'Copy selection'} />
      <ShortcutRow keys={['Ctrl', 'C']} desc={t('shortcutSigint') || 'Interrupt (SIGINT)'} />
      <ShortcutRow keys={['Ctrl', 'Shift', 'F']} desc={t('shortcutSearch') || 'Find in terminal'} />
      <ShortcutRow keys={['F12']} desc={t('shortcutDevtools') || 'Open DevTools'} />
    </div>
    <Divider />
    <div style={shortcutStyles.group}>
      <ShortcutRow keys={['Ctrl', 'Shift', 'P']} desc={t('shortcutCommandPalette') || 'Command palette'} />
      <ShortcutRow keys={['Ctrl', 'Shift', 'Enter']} desc={t('shortcutQuickInput') || 'Quick Input'} />
      <ShortcutRow keys={['Ctrl', 'Shift', 'S']} desc={t('shortcutSnippets') || 'Snippet palette'} />
      <ShortcutRow keys={['Ctrl', 'T']} desc={t('shortcutNewTab') || 'New tab'} />
      <ShortcutRow keys={['Ctrl', 'W']} desc={t('shortcutCloseTab') || 'Close tab'} />
      <ShortcutRow keys={['Ctrl', '\\']} desc={t('shortcutSplitRight') || 'Split right'} />
      <ShortcutRow keys={['Ctrl', 'Shift', '\\']} desc={t('shortcutSplitDown') || 'Split down'} />
      <ShortcutRow keys={['Ctrl', 'P']} desc={t('shortcutQuickOpen') || 'Quick open files'} />
      <ShortcutRow keys={['Ctrl', 'S']} desc={t('shortcutSave') || 'Save file'} />
    </div>
  </Section>
);
