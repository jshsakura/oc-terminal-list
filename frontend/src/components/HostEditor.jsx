import { useEffect, useState, useCallback, useRef } from 'react';
import { X, Trash2, Network, FolderOpen, Globe, Terminal as TerminalIcon, Palette, AlertTriangle, Copy, Check } from 'lucide-react';
import Button from './common/Button';
import { tokens } from '../styles/tokens';
import SkeletonRow from './common/SkeletonRow';
import IconPickerPopup from './IconPickerPopup';
import ThemePicker from './common/ThemePicker';
import RemoteFolderPicker from './RemoteFolderPicker';
import { authHeaders } from '../utils/auth';
import { copyToClipboard } from '../utils/clipboard';
import { fromHost as multiplexerFromHost, normalize as normalizeMultiplexer, HINTS as MUX_HINTS } from '../utils/multiplexer';
import { heStyles, styles } from './hostEditor/hostEditorStyles';
import { Section, Divider, Row, Field, Input, Select, SegmentedControl, Toggle } from './hostEditor/HostEditorFields';
import { IconButton, ColorPicker, TailscalePicker } from './hostEditor/HostEditorPickers';

const { color, font, fontSize, radius, space, motion } = tokens;

const EMPTY = {
  name: '',
  hostname: '',
  port: 22,
  ssh_user: '',
  auth_method: 'key',
  key_id: null,
  password: '',
  color_index: 0,
  group_name: null,
  multiplexer: 'tmux',
  remote_tmux_session: 'mobile',
  start_path: '',
  icon: '',
  theme: '',
};


const HE_TABS = [
  { id: 'connection', icon: Globe, labelKey: 'connection' },
  { id: 'session', icon: TerminalIcon, labelKey: 'session' },
  { id: 'appearance', icon: Palette, labelKey: 'appearance' },
];

const HostEditor = ({ isOpen, host, sshKeys, onSave, onClose, onDelete, onKillTmuxServer, t, globalThemeId = 'default', defaultMultiplexer = 'tmux', zIndex = null }) => {
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [killing, setKilling] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [tsPicker, setTsPicker] = useState({ open: false, peers: [], loading: false, available: true });
  const [sessions, setSessions] = useState({ open: false, items: [], loading: false, error: null, killing: null });
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [heTab, setHeTab] = useState('connection');
  const [muxWarning, setMuxWarning] = useState('');
  const [muxChecking, setMuxChecking] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [isOpen, host?.id]);

  useEffect(() => {
    if (host) {
      setDraft({
        ...EMPTY,
        ...host,
        // 옛 행에는 `multiplexer` 칸이 없다 — 되짚기는 백엔드와 **같은 규칙**이어야 한다
        // (backend/multiplexer.from_host_row). 두 곳이 다르게 되짚으면 화면과 실제 동작이
        // 어긋나고, 그건 저장할 때까지 안 드러난다.
        multiplexer: multiplexerFromHost(host, normalizeMultiplexer(defaultMultiplexer)),
      });
    } else {
      // 새 호스트는 설정의 기본값으로 시작한다 — 고정 'tmux' 로 시작하면 설정을 바꿔 둔
      // 의미가 없다. 유효하지 않은 값이면 normalize 가 기본으로 접는다.
      setDraft({ ...EMPTY, multiplexer: normalizeMultiplexer(defaultMultiplexer) });
    }
    setError('');
  }, [host, isOpen, defaultMultiplexer]);

  const probeTmux = useCallback(async (choice, hostId) => {
    setMuxWarning('');
    if (choice !== 'tmux' || !hostId) return;
    setMuxChecking(true);
    try {
      const res = await fetch(`/api/hosts/${hostId}/tmux-check`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.platform === 'windows') {
          /* "tmux not found" is true but useless here — nothing else on this host will
             work either, and the fix is a different kind of host, not a package. */
          setMuxWarning(t('windowsUnsupported') || 'This host looks like Windows — persistent sessions, file paste and tool installs all assume a POSIX shell.');
        } else if (!data.available) {
          setMuxWarning(t('tmuxNotAvailable') || 'tmux not found on this host — sessions will not persist.');
        }
      }
    } catch {
      // 못 물어봤다 = 모른다. 모르는 것을 경고로 그리지 않는다(host_tools 의 규칙과 같다).
    }
    setMuxChecking(false);
  }, [t]);

  /* 세션 탭을 열 때 한 번만 물어본다. 폴링이 아니다 — SSH 왕복 하나다. */
  useEffect(() => {
    if (!isOpen || heTab !== 'session') return;
    probeTmux(draft.multiplexer, host?.id);
  }, [isOpen, heTab, draft.multiplexer, host?.id, probeTmux]);

  if (!isOpen) return null;

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  /**
   * 멀티플렉서를 고른다. tmux 는 고르는 순간 **그 호스트에 있는지 물어본다.**
   *
   * ⚠️ 없다고 해서 되돌리지 않는다 — 고른 값은 그대로 두고 경고만 붙인다. 이 앱은
   * 없으면 평범한 셸로 떨어지므로 터미널 자체는 열리고, 사용자는 도구 설치로 가서
   * 깔면 된다. 골랐는데 화면이 제멋대로 되돌아가는 쪽이 훨씬 나쁘다.
   */
  const openTailscalePicker = async () => {
    setTsPicker({ open: true, peers: [], loading: true, available: true });
    try {
      const res = await fetch('/api/tailscale/peers', { headers: authHeaders() });
      const data = await res.json();
      const list = [...(data.self ? [data.self] : []), ...(data.peers || [])];
      setTsPicker({ open: true, peers: list, loading: false, available: !!data.available });
    } catch (e) {
      setTsPicker({ open: true, peers: [], loading: false, available: false });
    }
  };

  const refreshSessions = async () => {
    if (!host) return;
    setSessions((s) => ({ ...s, open: true, loading: true, error: null }));
    try {
      const res = await fetch(`/api/hosts/${host.id}/tmux-sessions`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions((s) => ({ ...s, loading: false, items: data.sessions || [] }));
    } catch (err) {
      setSessions((s) => ({ ...s, loading: false, error: err.message || 'failed' }));
    }
  };

  const killOneSession = async (name) => {
    if (!host) return;
    if (!confirm((t('confirmKillSession') || 'Kill session') + ` "${name}"?`)) return;
    setSessions((s) => ({ ...s, killing: name }));
    try {
      await fetch(`/api/hosts/${host.id}/kill-tmux?session=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: authHeaders(),
      });
      await refreshSessions();
    } catch {
      // ignore
    } finally {
      setSessions((s) => ({ ...s, killing: null }));
    }
  };


  // useIp=true 면 100.x.x.x 테일넷 IP, false 면 MagicDNS 호스트명을 hostname 필드에 채움.
  // 사용자가 명시적으로 골라야 — fallback 체인은 한 형식이 비어있는 경우만.
  const pickTailscalePeer = (peer, useIp = false) => {
    const target = useIp
      ? (peer.ip || peer.dns_name || peer.hostname)
      : (peer.dns_name || peer.ip || peer.hostname);
    setDraft((d) => ({
      ...d,
      hostname: target || d.hostname,
      name: d.name || peer.hostname || '',
    }));
    setTsPicker((p) => ({ ...p, open: false }));
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    setError('');
    if (!draft.name.trim()) return setError(t('errorNameRequired') || 'Name is required.');
    if (!draft.hostname.trim()) return setError(t('errorHostRequired') || 'Hostname is required.');
    if (!draft.ssh_user.trim()) return setError(t('errorUserRequired') || 'SSH user is required.');
    if (draft.auth_method === 'key' && !draft.key_id) return setError(t('errorKeyRequired') || 'Pick an SSH key (or add one first).');
    if (draft.auth_method === 'password' && !draft.password && !host) return setError(t('errorPasswordRequired') || 'Password required.');

    setSaving(true);
    try {
      await onSave(draft);
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const overlayStyle = zIndex != null ? { ...styles.overlay, zIndex } : styles.overlay;
  return (
    <div style={overlayStyle}>
      <form onSubmit={submit} style={styles.modal}>
        <header style={styles.header}>
          <div style={styles.title}>{host ? (t('editHost') || 'Edit host') : (t('addHost') || 'Add host')}</div>
          <button
            type="button"
            onClick={onClose}
            style={styles.closeBtn}
            onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; e.currentTarget.style.color = color.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.subtext; }}
          ><X size={14} strokeWidth={2} /></button>
        </header>

        <nav style={heStyles.tabBar}>
          {HE_TABS.map((td) => {
            const Icon = td.icon;
            const active = heTab === td.id;
            return (
              <button
                key={td.id}
                type="button"
                onClick={() => setHeTab(td.id)}
                style={{
                  ...heStyles.tabBtn,
                  background: active ? color.surface1 : 'transparent',
                  color: active ? color.text : color.subtext,
                  borderColor: active ? color.borderStrong : 'transparent',
                  transition: `background ${motion.fast}, color ${motion.fast}, border-color ${motion.fast}`,
                }}
                onMouseEnter={(e) => {
                  if (active) return;
                  e.currentTarget.style.background = color.surface0;
                  e.currentTarget.style.color = color.text;
                }}
                onMouseLeave={(e) => {
                  if (active) return;
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = color.subtext;
                }}
              >
                <Icon size={12} strokeWidth={1.8} />
                <span>{t(td.labelKey) || td.labelKey}</span>
              </button>
            );
          })}
        </nav>

        <div style={styles.body}>
          {heTab === 'connection' && (
            <>
              <Section title={t('connection') || 'Connection'}>
                <Field label={t('hostName') || 'Display name'} hint={t('hostNameFieldHint') || 'The name you will see in the list. It seeds the tab name.'}>
                  <Input value={draft.name} onChange={(v) => set('name', v)} placeholder="prod-web-01" autoFocus />
                </Field>
                <Row>
                  <Field label={t('hostnameLabel') || 'Hostname / IP'} flex={2} hint={t('hostnameFieldHint') || 'An IP or a domain.'}>
                    <div style={{ position: 'relative', display: 'flex', gap: '4px' }}>
                      <Input value={draft.hostname} onChange={(v) => set('hostname', v)} placeholder="example.com" />
                      <button
                        type="button"
                        onClick={openTailscalePicker}
                        title={t('pickFromTailscale') || 'Pick from Tailscale'}
                        style={{
                          width: '32px', height: '30px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: color.surface0,
                          border: `1px solid ${color.border}`,
                          borderRadius: radius.sm,
                          cursor: 'pointer',
                          color: color.subtext,
                          flexShrink: 0,
                          padding: 0,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = color.surface1; e.currentTarget.style.color = color.text; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = color.surface0; e.currentTarget.style.color = color.subtext; }}
                      >
                        <Network size={13} strokeWidth={1.8} />
                      </button>
                      {tsPicker.open && (
                        <TailscalePicker
                          data={tsPicker}
                          onPick={pickTailscalePeer}
                          onClose={() => setTsPicker((p) => ({ ...p, open: false }))}
                          t={t}
                        />
                      )}
                    </div>
                  </Field>
                  <Field label={t('port') || 'Port'} flex={1} hint={t('portFieldHint') || 'Defaults to 22.'}>
                    <Input
                      type="number"
                      value={draft.port}
                      onChange={(v) => set('port', parseInt(v || '22', 10))}
                      placeholder="22"
                    />
                  </Field>
                </Row>
                <Field label={t('sshUser') || 'SSH user'} hint={t('sshUserFieldHint') || 'The account you log in as.'}>
                  <Input value={draft.ssh_user} onChange={(v) => set('ssh_user', v)} placeholder="root" />
                </Field>
              </Section>
              <Divider />
              <Section title={t('authentication') || 'Authentication'}>
                <SegmentedControl
                  value={draft.auth_method}
                  options={[
                    { value: 'key', label: t('authKey') || 'SSH key' },
                    { value: 'password', label: t('authPassword') || 'Password' },
                    { value: 'tailscale', label: t('authTailscale') || 'Tailscale' },
                  ]}
                  onChange={(v) => set('auth_method', v)}
                />
                {/* The real question on this screen is not which radio to press but
                    where the secret ends up. Say it once, under the choice. */}
                <div style={{ fontSize: fontSize['11'], color: color.muted, lineHeight: 1.5, marginTop: space['1'], wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                  {t('authMethodHint') || 'Keys and passwords are stored encrypted on this server and never shown again after saving.'}
                </div>
                {draft.auth_method === 'key' && (
                  <Field label={t('sshKey') || 'SSH key'} hint={t('sshKeyPickHint') || 'Pick one of the private keys you saved under SSH keys.'}>
                    <Select value={draft.key_id || ''} onChange={(v) => set('key_id', v || null)}>
                      <option value="">— {t('chooseKey') || 'Choose a key'} —</option>
                      {sshKeys.map((k) => (
                        <option key={k.id} value={k.id}>{k.name}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                {draft.auth_method === 'password' && (
                  <Field label={t('password') || 'Password'} hint={host ? (t('leaveBlankToKeep') || 'Leave blank to keep saved password.') : undefined}>
                    <Input
                      type="password"
                      value={draft.password || ''}
                      onChange={(v) => set('password', v)}
                      placeholder="••••••••"
                    />
                  </Field>
                )}
                {draft.auth_method === 'tailscale' && (
                  <div style={{ fontSize: fontSize['11'], color: color.subtext, padding: `0 ${space['1']}`, lineHeight: 1.5 }}>
                    {t('tailscaleAuthHint') || 'Authenticated by Tailscale itself — no SSH key needed. Server must be logged in to tailscale.'}
                  </div>
                )}
              </Section>
            </>
          )}

          {heTab === 'session' && (
            <>
              <Section title={t('persistence') || 'Persistence'}>
                {/* ⚠️ **여기서 고르지 않는다.** 설정 한 곳(설정 → 세션 멀티플렉서)이
                    이 서버와 모든 호스트를 함께 정한다. 호스트마다 또 고르게 두면 같은
                    결정이 두 자리에 생기고,
                    전역 값을 바꿔도 옛 호스트들이 따라오지 않는다. */}
                <Field
                  label={t('multiplexer') || 'Session multiplexer'}
                  hint={muxChecking
                    ? (t('tmuxChecking') || 'Checking tmux on remote host…')
                    : (MUX_HINTS[draft.multiplexer]?.(t) || '')}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    padding: `${space['2']} ${space['2.5']}`,
                    borderRadius: radius.md,
                    background: 'var(--ui-surface0)',
                    border: `1px solid var(--ui-border)`,
                    fontFamily: font.mono, fontSize: fontSize['12'], color: 'var(--ui-text)',
                  }}>
                    {draft.multiplexer}
                    <span style={{ fontFamily: font.sans, color: color.muted, marginLeft: space['2'] }}>
                      {t('changeInSettings') || '설정에서 변경'}
                    </span>
                  </div>
                </Field>
                {muxWarning && (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: space['2'],
                    padding: space['2'], borderRadius: radius.md,
                    background: 'var(--ui-surface1)', border: `1px solid var(--ui-border)`,
                    fontSize: fontSize['12'], color: 'var(--ui-subtext)', lineHeight: 1.4,
                  }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1, color: 'var(--ui-warning, #f9e2af)' }} />
                    <span>{muxWarning}</span>
                  </div>
                )}
                {draft.multiplexer !== 'none' && (
                  <Field
                    label={t('sessionName') || 'Session name'}
                    hint={t('tmuxSessionNameHint') || '같은 이름이면 다른 탭/디바이스에서도 같은 화면 공유.'}
                  >
                    <Input
                      value={draft.remote_tmux_session || ''}
                      onChange={(v) => set('remote_tmux_session', v)}
                      placeholder="mobile"
                    />
                  </Field>
                )}
                <Field
                  label={t('startPath') || 'Start path'}
                  hint={t('startPathHint') || 'Directory to enter on connect.'}
                >
                  <div style={{ display: 'flex', gap: space['1.5'], alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Input
                        value={draft.start_path || ''}
                        onChange={(v) => set('start_path', v)}
                        placeholder="~/projects/my-app"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!host?.id) {
                          setError(t('errorSaveBeforeBrowse') || 'Save host first to browse remote folders.');
                          return;
                        }
                        setError('');
                        setFolderPickerOpen(true);
                      }}
                      title={host?.id ? (t('browseFolder') || 'Browse remote folders') : (t('errorSaveBeforeBrowse') || 'Save host first')}
                      style={{
                        flexShrink: 0, width: 32, height: 32,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: color.mantle, color: color.subtext,
                        border: `1px solid ${color.border}`, borderRadius: radius.sm,
                        cursor: host?.id ? 'pointer' : 'not-allowed', opacity: host?.id ? 1 : 0.5,
                        padding: 0,
                      }}
                      onMouseEnter={(e) => { if (host?.id) { e.currentTarget.style.background = color.surface1; e.currentTarget.style.color = color.text; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = color.mantle; e.currentTarget.style.color = color.subtext; }}
                    >
                      <FolderOpen size={14} strokeWidth={2} />
                    </button>
                  </div>
                </Field>
              </Section>

              {host && (
                <Section title={t('remoteSessions') || 'Remote sessions'}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: space['2'] }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: space['2'] }}>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={sessions.loading}
                        onClick={refreshSessions}
                      >
                        {sessions.loading
                          ? (t('loading') || 'Loading…')
                          : (sessions.open
                              ? (t('refreshSessions') || 'Refresh')
                              : (t('viewRemoteSessions') || 'View remote sessions'))}
                      </Button>
                      {sessions.open && (
                        <span style={{ fontSize: fontSize['11'], color: color.muted }}>
                          {sessions.items.length} {t('sessions') || 'sessions'}
                        </span>
                      )}
                    </div>
                    {sessions.open && sessions.loading && sessions.items.length === 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: `${space['2']} 0` }}>
                        {[0, 1, 2].map((i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: space['2'], padding: `${space['1.5']} ${space['2']}` }}>
                            <SkeletonRow width="8px" height="8px" borderRadius="50%" />
                            <SkeletonRow width={`${55 + ((i * 13) % 25)}%`} height="13px" />
                          </div>
                        ))}
                      </div>
                    )}
                    {sessions.open && sessions.error && (
                      <div style={{ fontSize: fontSize['11'], color: color.danger }}>{sessions.error}</div>
                    )}
                    {sessions.open && !sessions.error && sessions.items.length === 0 && !sessions.loading && (
                      <div style={{ fontSize: fontSize['11'], color: color.muted }}>
                        {t('noRemoteSessions') || 'No tmux sessions running on this host.'}
                      </div>
                    )}
                    {sessions.open && sessions.items.length > 0 && (
                      <div style={{
                        border: `1px solid ${color.border}`, borderRadius: radius.sm,
                        background: color.surface0, overflow: 'hidden',
                      }}>
                        {sessions.items.map((s) => (
                          <div key={s.name} style={{
                            display: 'flex', alignItems: 'center', gap: space['2'],
                            padding: `${space['1.5']} ${space['2']}`,
                            borderBottom: `1px solid ${color.border}`,
                            fontSize: fontSize['12'],
                          }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.attached ? color.success : color.muted, flexShrink: 0 }} />
                            <span style={{ flex: 1, color: color.text, fontFamily: font.mono, fontSize: fontSize['11'] }}>
                              {s.name}
                              {s.attached && <span style={{ marginLeft: 6, color: color.success, fontSize: '10px' }}>● {t('attached') || 'attached'}</span>}
                            </span>
                            <button
                              type="button"
                              disabled={sessions.killing === s.name}
                              onClick={() => killOneSession(s.name)}
                              title={t('killSession') || 'Kill this session'}
                              style={{
                                padding: `2px ${space['2']}`, background: 'transparent',
                                border: `1px solid ${color.border}`, borderRadius: '3px',
                                color: color.danger, cursor: 'pointer', fontSize: fontSize['11'],
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = color.danger; e.currentTarget.style.color = '#fff'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.danger; }}
                            >
                              {sessions.killing === s.name ? '…' : 'Kill'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {onKillTmuxServer && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: space['1'] }}>
                        <Button
                          variant="ghost"
                          type="button"
                          disabled={killing}
                          onClick={async () => {
                            if (!confirm(t('confirmKillTmuxServer') || 'Kill the entire tmux server?')) return;
                            setKilling(true);
                            try { await onKillTmuxServer(); await refreshSessions(); } finally { setKilling(false); }
                          }}
                          style={{ alignSelf: 'flex-start', color: color.danger }}
                        >
                          {killing ? (t('saving') || '…') : (t('killTmuxServer') || 'Kill tmux server (nuke all)')}
                        </Button>
                        <div style={{ fontSize: fontSize['11'], color: color.muted }}>
                          {t('killTmuxServerHint') || '모든 원격 세션을 종료합니다.'}
                        </div>
                      </div>
                    )}
                  </div>
                </Section>
              )}
            </>
          )}

          {heTab === 'appearance' && (
            <Section title={t('appearance') || 'Appearance'}>
              <Field label={t('icon') || 'Icon'}>
                <IconButton value={draft.icon || ''} colorIndex={draft.color_index} onOpen={() => setIconPickerOpen(true)} t={t} />
              </Field>
              <Field label={t('color') || 'Color'}>
                <ColorPicker value={draft.color_index} onChange={(v) => set('color_index', v)} />
              </Field>
              <Field label={t('terminalTheme') || 'Terminal color'}>
                <ThemePicker
                  value={draft.theme || ''}
                  onChange={(v) => set('theme', v)}
                  allowEmpty
                  markedId={globalThemeId}
                  t={t}
                  columns={2}
                  showRandom
                />
              </Field>
            </Section>
          )}

          {error && <div style={styles.error}>{error}</div>}
        </div>

        <IconPickerPopup
          isOpen={iconPickerOpen}
          value={draft.icon || ''}
          onChange={(v) => set('icon', v)}
          onClose={() => setIconPickerOpen(false)}
          t={t}
        />

        <RemoteFolderPicker
          isOpen={folderPickerOpen && !!host?.id}
          host={host}
          onPick={(p) => { set('start_path', p); setFolderPickerOpen(false); }}
          onClose={() => setFolderPickerOpen(false)}
          title={t('pickStartPath') || 'Pick start path'}
          confirmLabel={t('useAsStartPath') || 'Use as start path'}
          t={t}
        />

        <footer style={styles.footer}>
          {host && onDelete && (
            !confirmingDelete ? (
              <Button variant="ghost" onClick={() => setConfirmingDelete(true)} type="button" icon={Trash2} style={{ color: color.danger, marginRight: 'auto' }}>
                {t('delete') || 'Delete'}
              </Button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: space['1.5'], marginRight: 'auto' }}>
                <span style={{ fontSize: fontSize['12'], color: color.danger }}>
                  {t('confirmDeleteHostInline') || 'Delete this host?'}
                </span>
                <Button variant="ghost" onClick={() => setConfirmingDelete(false)} type="button" style={{ height: '26px' }}>
                  {t('cancel') || 'Cancel'}
                </Button>
                <Button variant="primary" onClick={onDelete} type="button" style={{ height: '26px', background: color.danger, borderColor: color.danger }}>
                  {t('delete') || 'Delete'}
                </Button>
              </div>
            )
          )}
          <Button variant="secondary" onClick={onClose} type="button">{t('cancel')}</Button>
          <Button variant="primary" onClick={submit} disabled={saving} type="submit">
            {saving ? (t('saving') || 'Saving…') : (host ? (t('save') || 'Save') : (t('add') || 'Add'))}
          </Button>
        </footer>
      </form>
    </div>
  );
};


export default HostEditor;
