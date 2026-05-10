import { useEffect, useState } from 'react';
import { X, Trash2, Network, ChevronDown, FolderOpen } from 'lucide-react';
import Button from './common/Button';
import { tokens } from '../styles/tokens';
import HostIcon from '../utils/hostIcons';
import IconPickerPopup from './IconPickerPopup';
import RemoteFolderPicker from './RemoteFolderPicker';

const { color, font, fontSize, fontWeight, radius, space, shadow, motion } = tokens;

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
  use_remote_tmux: true,
  remote_tmux_session: 'mobile',
  start_path: '',
  icon: '',
};


const HostEditor = ({ isOpen, host, sshKeys, onSave, onClose, onDelete, onKillTmuxServer, t }) => {
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [killing, setKilling] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [tsPicker, setTsPicker] = useState({ open: false, peers: [], loading: false, available: true });
  const [sessions, setSessions] = useState({ open: false, items: [], loading: false, error: null, killing: null });
  // 시작 경로 파일 탐색 모달 — 저장된 호스트 (id 있음) 만 SFTP 가능. 새 호스트면 안내.
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [isOpen, host?.id]);

  useEffect(() => {
    if (host) {
      setDraft({
        ...EMPTY,
        ...host,
        use_remote_tmux: !!host.use_remote_tmux,
      });
    } else {
      setDraft(EMPTY);
    }
    setError('');
  }, [host, isOpen]);

  if (!isOpen) return null;

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const openTailscalePicker = async () => {
    setTsPicker({ open: true, peers: [], loading: true, available: true });
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/tailscale/peers', { headers: { Authorization: `Bearer ${token}` } });
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
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/hosts/${host.id}/tmux-sessions`, {
        headers: { Authorization: `Bearer ${token}` },
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
      const token = localStorage.getItem('auth_token');
      await fetch(`/api/hosts/${host.id}/kill-tmux?session=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await refreshSessions();
    } catch {
      // ignore
    } finally {
      setSessions((s) => ({ ...s, killing: null }));
    }
  };

  const pickTailscalePeer = (peer) => {
    setDraft((d) => ({
      ...d,
      hostname: peer.dns_name || peer.ip || peer.hostname || d.hostname,
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

  return (
    <div style={styles.overlay}>
      <form onSubmit={submit} style={styles.modal}>
        <header style={styles.header}>
          <div style={styles.title}>{host ? (t('editHost') || 'Edit host') : (t('addHost') || 'Add host')}</div>
          <button type="button" onClick={onClose} style={styles.closeBtn}><X size={14} strokeWidth={2} /></button>
        </header>

        <div style={styles.body}>
          <Section title={t('connection') || 'Connection'}>
            <Field label={t('hostName') || 'Display name'}>
              <Input value={draft.name} onChange={(v) => set('name', v)} placeholder="prod-web-01" autoFocus />
            </Field>
            <Row>
              <Field label={t('hostnameLabel') || 'Hostname / IP'} flex={2}>
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
              <Field label={t('port') || 'Port'} flex={1}>
                <Input
                  type="number"
                  value={draft.port}
                  onChange={(v) => set('port', parseInt(v || '22', 10))}
                  placeholder="22"
                />
              </Field>
            </Row>
            <Field label={t('sshUser') || 'SSH user'}>
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
            {draft.auth_method === 'key' && (
              <Field label={t('sshKey') || 'SSH key'}>
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

          <Divider />

          <Section title={t('persistence') || 'Persistence'}>
            <Toggle
              label={t('useRemoteTmux') || 'Persist sessions across disconnects (tmux)'}
              hint={
                draft.use_remote_tmux
                  ? (t('useRemoteTmuxHintOn') || 'ON: 연결 끊겨도 원격 tmux 가 세션을 살려둠. 다시 붙으면 그대로. 원격에 tmux 설치 필요 (없으면 일반 셸로 폴백).')
                  : (t('useRemoteTmuxHintOff') || 'OFF: 일반 SSH 셸. 연결 끊기면 실행 중이던 작업 사라짐.')
              }
              checked={draft.use_remote_tmux}
              onChange={(v) => set('use_remote_tmux', v)}
            />
            {draft.use_remote_tmux && (
              <Field
                label={t('tmuxSessionName') || 'tmux session name'}
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
              hint={t('startPathHint') || 'Directory to enter on connect (absolute or ~). Empty = home.'}
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
                  title={host?.id ? (t('browseFolder') || 'Browse remote folders') : (t('errorSaveBeforeBrowse') || 'Save host first to browse')}
                  style={{
                    flexShrink: 0,
                    width: 32,
                    height: 32,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: color.mantle,
                    color: color.subtext,
                    border: `1px solid ${color.border}`,
                    borderRadius: radius.sm,
                    cursor: host?.id ? 'pointer' : 'not-allowed',
                    opacity: host?.id ? 1 : 0.5,
                    transition: `background ${motion.fast}, color ${motion.fast}`,
                    padding: 0,
                  }}
                  onMouseEnter={(e) => { if (host?.id) { e.currentTarget.style.background = color.surface1; e.currentTarget.style.color = color.text; } }}
                  onMouseLeave={(e) => { if (host?.id) { e.currentTarget.style.background = color.mantle; e.currentTarget.style.color = color.subtext; } }}
                >
                  <FolderOpen size={14} strokeWidth={2} />
                </button>
              </div>
            </Field>
            {host && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: space['2'], marginTop: space['2'] }}>
                {/* 세션 목록 + 개별 kill */}
                <div style={{ display: 'flex', alignItems: 'center', gap: space['2'] }}>
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={sessions.loading}
                    onClick={refreshSessions}
                    style={{ alignSelf: 'flex-start' }}
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

                {sessions.open && sessions.error && (
                  <div style={{ fontSize: fontSize['11'], color: color.danger }}>{sessions.error}</div>
                )}

                {sessions.open && !sessions.error && sessions.items.length === 0 && !sessions.loading && (
                  <div style={{ fontSize: fontSize['11'], color: color.muted, padding: `${space['1']} 0` }}>
                    {t('noRemoteSessions') || 'No tmux sessions running on this host.'}
                  </div>
                )}

                {sessions.open && sessions.items.length > 0 && (
                  <div style={{
                    border: `1px solid ${color.border}`,
                    borderRadius: radius.sm,
                    background: color.surface0,
                    overflow: 'hidden',
                  }}>
                    {sessions.items.map((s) => (
                      <div
                        key={s.name}
                        style={{
                          display: 'flex', alignItems: 'center', gap: space['2'],
                          padding: `${space['1.5']} ${space['2']}`,
                          borderBottom: `1px solid ${color.border}`,
                          fontSize: fontSize['12'],
                        }}
                      >
                        <div style={{
                          width: '8px', height: '8px', borderRadius: '50%',
                          background: s.attached ? color.success : color.muted,
                          flexShrink: 0,
                        }} />
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
                            padding: `2px ${space['2']}`,
                            background: 'transparent',
                            border: `1px solid ${color.border}`,
                            borderRadius: '3px',
                            color: color.danger,
                            cursor: 'pointer',
                            fontSize: fontSize['11'],
                            fontFamily: font.sans,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = color.danger; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = color.danger; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.danger; e.currentTarget.style.borderColor = color.border; }}
                        >
                          {sessions.killing === s.name ? '…' : 'Kill'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 전체 nuke */}
                {onKillTmuxServer && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: space['1'], marginTop: space['1'] }}>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={killing}
                      onClick={async () => {
                        if (!confirm(t('confirmKillTmuxServer') || 'Kill the entire tmux server on this host? All sessions there will die.')) return;
                        setKilling(true);
                        try { await onKillTmuxServer(); await refreshSessions(); } finally { setKilling(false); }
                      }}
                      style={{ alignSelf: 'flex-start', color: color.danger }}
                    >
                      {killing ? (t('saving') || '…') : (t('killTmuxServer') || 'Kill remote tmux server (nuke all)')}
                    </Button>
                    <div style={{ fontSize: fontSize['11'], color: color.muted }}>
                      {t('killTmuxServerHint') || '망가진 tmux 상태 한번에 청소. 다음 접속 시 새 서버에 새 세션이 만들어집니다.'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>

          <Divider />

          <Section title={t('appearance') || 'Appearance'}>
            <Field label={t('icon') || 'Icon'}>
              <IconButton value={draft.icon || ''} colorIndex={draft.color_index} onOpen={() => setIconPickerOpen(true)} t={t} />
            </Field>
            <Field label={t('color') || 'Color'}>
              <ColorPicker value={draft.color_index} onChange={(v) => set('color_index', v)} />
            </Field>
          </Section>

          <IconPickerPopup
            isOpen={iconPickerOpen}
            value={draft.icon || ''}
            onChange={(v) => set('icon', v)}
            onClose={() => setIconPickerOpen(false)}
            t={t}
          />

          {/* 시작 경로 SFTP 폴더 탐색 — 저장된 호스트(id 있음) 만 동작. 선택 시 draft.start_path 업데이트. */}
          <RemoteFolderPicker
            isOpen={folderPickerOpen && !!host?.id}
            host={host}
            onPick={(p) => { set('start_path', p); setFolderPickerOpen(false); }}
            onClose={() => setFolderPickerOpen(false)}
            title={t('pickStartPath') || 'Pick start path'}
            confirmLabel={t('useAsStartPath') || 'Use as start path'}
            t={t}
          />

          {error && <div style={styles.error}>{error}</div>}
        </div>

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

const Section = ({ title, children }) => (
  <section style={styles.section}>
    <div style={styles.sectionTitle}>{title}</div>
    <div style={styles.sectionBody}>{children}</div>
  </section>
);

const Divider = () => <div style={styles.divider} />;

const Row = ({ children }) => <div style={styles.row}>{children}</div>;

const Field = ({ label, hint, children, flex }) => (
  <div style={{ ...styles.field, flex: flex || 'unset' }}>
    <label style={styles.label}>{label}</label>
    {children}
    {hint && <div style={styles.hint}>{hint}</div>}
  </div>
);

const Input = ({ value, onChange, type = 'text', placeholder, autoFocus }) => {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...styles.input,
        borderColor: focused ? color.accentBorder : color.border,
        background: focused ? color.crust : color.mantle,
      }}
    />
  );
};

const Select = ({ value, onChange, children }) => {
  const [hover, setHover] = useState(false);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...styles.input, borderColor: hover ? color.borderStrong : color.border, cursor: 'pointer', appearance: 'none' }}
    >
      {children}
    </select>
  );
};

const SegmentedControl = ({ value, options, onChange }) => (
  <div style={styles.segment}>
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        onClick={() => onChange(opt.value)}
        style={{
          ...styles.segmentBtn,
          background: value === opt.value ? color.surface1 : 'transparent',
          color: value === opt.value ? color.text : color.muted,
        }}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const Toggle = ({ label, hint, checked, onChange }) => (
  <div style={styles.toggleRow}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: fontSize['13'], color: color.text }}>{label}</div>
      {hint && <div style={{ fontSize: fontSize['11'], color: color.muted, marginTop: '2px' }}>{hint}</div>}
    </div>
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        ...styles.toggle,
        background: checked ? color.accent : color.surface1,
      }}
    >
      <span style={{ ...styles.toggleKnob, transform: checked ? 'translateX(14px)' : 'translateX(0)' }} />
    </button>
  </div>
);

const IconButton = ({ value, colorIndex, onOpen, t }) => {
  const iconColor = color.dotPalette[(colorIndex || 0) % color.dotPalette.length];
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        height: '32px',
        padding: `0 10px`,
        background: color.mantle,
        color: color.text,
        border: `1px solid ${color.border}`,
        borderRadius: radius.sm,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: fontSize['12'],
        alignSelf: 'flex-start',
      }}
    >
      <span style={{ color: iconColor, display: 'inline-flex', alignItems: 'center' }}>
        <HostIcon value={value} size={16} />
      </span>
      <span style={{ color: value ? color.text : color.muted }}>
        {value || (t?.('chooseIcon') || 'Choose icon…')}
      </span>
      <ChevronDown size={12} strokeWidth={1.8} style={{ color: color.muted }} />
    </button>
  );
};

const ColorPicker = ({ value, onChange }) => (
  <div style={{ display: 'flex', gap: space['1.5'], flexWrap: 'wrap' }}>
    {color.dotPalette.map((c, i) => (
      <button
        key={c}
        type="button"
        onClick={() => onChange(i)}
        style={{
          width: '22px',
          height: '22px',
          padding: 0,
          background: c,
          border: i === value ? `2px solid ${color.text}` : `2px solid transparent`,
          borderRadius: radius.full,
          cursor: 'pointer',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)',
          transition: `border-color ${motion.fast}, transform ${motion.fast}`,
        }}
      />
    ))}
  </div>
);

const TailscalePicker = ({ data, onPick, onClose, t }) => {
  useEffect(() => {
    const handle = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
      <div style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        right: 0,
        zIndex: 51,
        background: color.base,
        border: `1px solid ${color.borderStrong}`,
        borderRadius: radius.md,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        maxHeight: '260px',
        overflow: 'auto',
        fontFamily: font.sans,
      }}>
        {!data.available ? (
          <div style={{ padding: '12px', fontSize: fontSize['12'], color: color.subtext, textAlign: 'center' }}>
            {t?.('tailscaleUnavailable') || 'Tailscale not available on the server.'}
          </div>
        ) : data.loading ? (
          <div style={{ padding: '12px', fontSize: fontSize['12'], color: color.subtext, textAlign: 'center' }}>
            {t?.('loading') || 'Loading…'}
          </div>
        ) : data.peers.length === 0 ? (
          <div style={{ padding: '12px', fontSize: fontSize['12'], color: color.subtext, textAlign: 'center' }}>
            {t?.('tailscaleNoPeers') || 'No tailnet peers found.'}
          </div>
        ) : (
          data.peers.map((peer) => (
            <button
              key={peer.id || peer.ip}
              type="button"
              onClick={() => onPick(peer)}
              disabled={peer.is_self}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                width: '100%', padding: '8px 12px',
                background: 'transparent', border: 'none',
                borderBottom: `1px solid ${color.border}`,
                cursor: peer.is_self ? 'default' : 'pointer',
                textAlign: 'left', fontFamily: font.sans,
                opacity: peer.is_self ? 0.5 : 1,
              }}
              onMouseEnter={(e) => { if (!peer.is_self) e.currentTarget.style.background = color.surface0; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: peer.online ? color.success : color.muted,
                flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: fontSize['12'], fontWeight: fontWeight.medium, color: color.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {peer.hostname}
                  {peer.is_self && ` (${t?.('thisMachine') || 'this machine'})`}
                </div>
                <div style={{ fontSize: '10.5px', color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {peer.dns_name || peer.ip} · {peer.os}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: color.scrim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10010,
    backdropFilter: 'blur(2px)',
    fontFamily: font.sans,
  },
  modal: {
    width: '92%',
    maxWidth: '480px',
    maxHeight: '88vh',
    background: color.base,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space['3']} ${space['4']}`,
    borderBottom: `1px solid ${color.border}`,
  },
  title: {
    fontSize: fontSize['14'],
    fontWeight: fontWeight.semibold,
    color: color.text,
  },
  closeBtn: {
    width: '24px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: color.muted,
    border: 'none',
    borderRadius: radius.xs,
    cursor: 'pointer',
  },
  body: {
    padding: `${space['3']} ${space['4']}`,
    overflowY: 'auto',
  },
  section: { display: 'flex', flexDirection: 'column', gap: space['2'], paddingTop: space['1'], paddingBottom: space['1'] },
  sectionTitle: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.medium,
    color: color.muted,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    marginBottom: space['1'],
  },
  sectionBody: { display: 'flex', flexDirection: 'column', gap: space['3'] },
  row: { display: 'flex', gap: space['2'] },
  divider: { height: '1px', background: color.border, margin: `${space['3']} 0` },
  field: { display: 'flex', flexDirection: 'column', gap: space['1'] },
  label: {
    fontSize: fontSize['12'],
    color: color.subtext,
    fontWeight: fontWeight.medium,
  },
  input: {
    width: '100%',
    height: '32px',
    padding: `0 ${space['3']}`,
    background: color.mantle,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['13'],
    fontFamily: 'inherit',
    outline: 'none',
    transition: `border-color ${motion.fast}, background ${motion.fast}`,
  },
  hint: { fontSize: fontSize['11'], color: color.muted, marginTop: space['0.5'] },
  error: {
    fontSize: fontSize['12'],
    color: color.danger,
    background: 'rgba(243, 139, 168, 0.08)',
    border: `1px solid rgba(243, 139, 168, 0.18)`,
    borderRadius: radius.sm,
    padding: `${space['2']} ${space['3']}`,
    marginTop: space['2'],
  },
  segment: {
    display: 'flex',
    gap: '2px',
    background: color.crust,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    padding: '2px',
  },
  segmentBtn: {
    flex: 1,
    height: '26px',
    border: 'none',
    background: 'transparent',
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    color: color.muted,
    fontFamily: 'inherit',
    cursor: 'pointer',
    borderRadius: radius.xs,
    transition: `background ${motion.fast}, color ${motion.fast}`,
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: space['3'],
  },
  toggle: {
    position: 'relative',
    width: '30px',
    height: '16px',
    border: 'none',
    borderRadius: radius.full,
    cursor: 'pointer',
    transition: `background ${motion.fast}`,
    padding: 0,
    flexShrink: 0,
  },
  toggleKnob: {
    position: 'absolute',
    top: '2px',
    left: '2px',
    width: '12px',
    height: '12px',
    background: '#fff',
    borderRadius: radius.full,
    transition: `transform ${motion.fast}`,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space['1.5'],
    padding: `${space['3']} ${space['4']}`,
    borderTop: `1px solid ${color.border}`,
    background: color.mantle,
  },
};

export default HostEditor;
