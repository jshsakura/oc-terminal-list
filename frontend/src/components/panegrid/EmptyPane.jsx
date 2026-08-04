/**
 * 빈 pane 의 홈 화면 — 호스트/로컬 대시보드 + "다른 열린 탭 미러" 섹션.
 * PaneGrid.jsx 에서 로직 변경 없이 추출. EmptyPane 만 외부로 노출하고 나머지는 내부 전용.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowRightLeft, Copy, Cpu, Monitor, Plus, Power, Server, Terminal as TerminalIcon, X, Zap } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { authHeaders } from '../../utils/auth';
import { computeCreateGeometry } from '../../utils/vncResize';
import { isPhoneViewport } from '../../utils/tabModel';
import useLocalVncAvailable from '../../hooks/useLocalVncAvailable';
import HomeDashboard, { HostRow } from '../HomeDashboard';
import HostIcon from '../../utils/hostIcons';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

// 호스트 카드 subtitle 한 줄 truncate + block — 멀티라인 안에서 각 라인 ellipsis 적용용.
const SUB_LINE = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

const EmptyPane = ({
  onActivate, hosts = [], tab, allTabs = [], settings = {}, t,
  onConfirm, onNotify, onTerminateHostSession, busyTabIds,
  onPickHostPath = null, onPickLocalPath = null, onEditHost = null, onEditLocal = null, refreshHosts = null,
  isVisible = true,
}) => {
  // VNC 디스플레이 픽커 — 어느 호스트의 픽커가 열려 있는지(host 객체) 추적.
  const [vncPickerHost, setVncPickerHost] = useState(null);
  // 로컬 원격 데스크톱 버튼 노출 여부 — App 홈과 같은 훅(모듈 캐시)이라 조회는 한 번.
  const localVncAvailable = useLocalVncAvailable();
  // pane 컨테이너 실측 — VNC 생성 시 초기 해상도를 pane 크기에 맞추기 위해.
  const paneContainerRef = useRef(null);

  // 현재 탭 자신은 후보에서 제외 — 다른 열린 탭의 활성 pane 을 미러.
  // index 는 상단 탭바와 동일한 1-base 순번 (Ctrl+N 단축키와 짝).
  const otherTabs = (allTabs || [])
    .map((tt, idx) => ({ tab: tt, index: idx + 1 }))
    .filter(({ tab: tt }) =>
      tt && tt.id && tt.id !== tab?.id && (tt.panes || []).some((p) => p.sessionId || p.hostId),
    );
  /* 로컬 카드 메타 — 홈 대시보드 동일 출처(settings.localXxx). */
  const localCard = {
    name: (settings.localName || '').trim() || (t?.('thisMachine') || 'This machine'),
    icon: settings.localIcon || '',
    accent: color.dotPalette[(settings.localColorIndex ?? 0) % color.dotPalette.length],
    startPath: settings.localStartPath || '',
  };

  // 다른 탭 흡수 섹션 — HomeDashboard 의 extraTopSlot 으로 넘김.
  const openTabsSlot = otherTabs.length > 0 ? (
    <Section icon={ArrowRightLeft} title={t?.('mirrorOpenTab') || 'Open tabs'}>
      <OpenTabPicker
        tabs={otherTabs}
        hosts={hosts}
        t={t}
        onPick={(tabId) => onActivate?.({ type: 'tab', sourceTabId: tabId })}
        emptySlotCount={(tab?.panes || []).filter((p) => !p.sessionId && !p.hostId).length}
        embedded
      />
    </Section>
  ) : null;

  return (
    <div ref={paneContainerRef} onClick={(e) => e.stopPropagation()} style={{ width: '100%', height: '100%', overflow: 'auto' }}>
      <HomeDashboard
        isVisible={isVisible}
        hosts={hosts}
        settings={settings}
        localCard={localCard}
        // host/local 열기 — HomeDashboard 시그니처를 onActivate 로 변환.
        onOpenHost={(target) => {
          if (target?.isLocal || target?.id === 'local') {
            onActivate?.({ type: 'local' });
          } else if (target?.id) {
            onActivate?.({ type: 'host', hostId: target.id });
          }
        }}
        onOpenHostAtPath={onPickHostPath || null}
        // VNC 원격 데스크톱 — 호스트 카드의 ScreenShare 버튼 → 디스플레이 픽커 오픈.
        onOpenVnc={(host) => setVncPickerHost(host)}
        // 홈과 동일하게 로컬 카드에도 원격 데스크톱 버튼을 준다(있을 때만).
        showLocalVnc={localVncAvailable}
        onEditLocal={onEditLocal || null}
        onPickLocalPath={onPickLocalPath || null}
        // 빈 패널에서는 호스트 추가/편집 진입은 부모 콜백 사용. 없으면 EmptyRow 가 빈 핸들러로 동작.
        onAddHost={() => { /* 호스트 관리는 사이드바 HostManager 에서 — 여기서는 추가 진입 미제공 */ }}
        onEditHost={onEditHost || null}
        // 영속 세션 — 빈 슬롯에 attach (새 탭이 아니라 이 슬롯 채움).
        tabs={allTabs}
        busyTabIds={busyTabIds}
        onJumpTab={() => { /* 빈 패널에서는 점프 대신 Open tabs 섹션을 통한 미러 사용 */ }}
        onResumeHostSession={(host, sessionName) => {
          onActivate?.({ type: 'host', hostId: host.id, tmuxSessionName: sessionName });
        }}
        onTerminateHostSession={onTerminateHostSession}
        onConfirm={onConfirm}
        onNotify={onNotify}
        refreshHosts={refreshHosts}
        embedded
        showUsageStats
        extraTopSlot={openTabsSlot}
        t={t}
      />
      {vncPickerHost && (
        <VncDisplayPicker
          host={vncPickerHost}
          t={t}
          onConfirm={onConfirm}
          paneSize={paneContainerRef.current
            ? { width: paneContainerRef.current.clientWidth, height: paneContainerRef.current.clientHeight }
            : null}
          onPick={(display) => {
            onActivate?.({ type: 'vnc', hostId: vncPickerHost.id, display });
            setVncPickerHost(null);
          }}
          onClose={() => setVncPickerHost(null)}
        />
      )}
    </div>
  );
};

/**
 * VNC 디스플레이 픽커 — 호스트 카드의 "Remote desktop" 버튼으로 열린다.
 * GET /api/hosts/{id}/vnc/displays 로 가용 디스플레이 목록을 조회하고,
 * 사용자가 하나를 고르면 onPick(displayNumber) 로 활성화한다.
 *
 * 백엔드 응답 형태:
 *   { installed: bool, available: bool, displays: [{ display: N, geometry: "WxH" }] }
 * installed=false → VNC 미설치 메시지. available=false → 오류 메시지.
 */
const VNC_GEOMETRY_PRESETS = ['1280x800', '1920x1080', '2560x1440', '1024x768'];
const _GEOMETRY_RE = /^\d+x\d+$/;

const VncDisplayPicker = ({ host, t, onPick, onClose, onConfirm, paneSize }) => {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  // 생성/종료 액션 전용 에러 — fetch 에러와 분리.
  const [actionError, setActionError] = useState('');
  const [creating, setCreating] = useState(false);
  const [killingDisplay, setKillingDisplay] = useState(null);
  // VNC 비밀번호 설정 — 값은 컴포넌트 state 에만 두고 저장 후 즉시 비운다.
  // 서버 응답에도 담기지 않는다(백엔드는 호스트의 ~/.vnc/passwd 에만 쓴다).
  const [pwValue, setPwValue] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  // 해상도 선택 — presets 또는 custom.
  const [geometry, setGeometry] = useState('1280x800');
  const [useCustom, setUseCustom] = useState(false);
  const [customGeometry, setCustomGeometry] = useState('');

  // 주 액션용 동적 해상도 — pane 실측이 있으면 그것을, 없으면 뷰포트를 기준.
  // paneSize 가 명시적으로 null 이면(측정 전/불가) '1280x800' 폴백.
  // 폰에서는 실측을 쓰지 않는다 — 폰 크기로 만든 데스크탑은 창이 잘린 채 세션에 남는다.
  const dynamicGeometry = computeCreateGeometry({
    width: paneSize?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 0),
    height: paneSize?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 0),
    isPhone: isPhoneViewport(),
  });

  // 디스플레이 목록 조회. host 가 바뀌면 useEffect 가 다시 부른다.
  const refresh = useCallback(async () => {
    setState({ loading: true, data: null, error: '' });
    try {
      const res = await fetch(`/api/hosts/${host?.id}/vnc/displays`, {
        headers: authHeaders(),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(8000)
          : undefined,
      });
      if (!res.ok) {
        setState({ loading: false, data: null, error: `${res.status}` });
        return;
      }
      const json = await res.json();
      setState({ loading: false, data: json, error: '' });
    } catch (err) {
      setState({ loading: false, data: null, error: err?.message || String(err) });
    }
  }, [host?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Esc → 닫기 (RemoteFolderPicker 와 동일한 동선).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── 새 가상 데스크탑 만들기 ──────────────────────────────────────────────
  // overrideGeom: 주 액션(0-displays "create and connect")이 기본 해상도로 강제 호출할 때 사용.
  const handleSetPassword = async () => {
    setPwError('');
    setPwSaving(true);
    try {
      const res = await fetch(`/api/hosts/${host?.id}/vnc/password`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwValue }),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(20000)
          : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwError(json?.detail || `${res.status}`);
        return;
      }
      setPwValue('');       // 메모리에서 즉시 제거
      await refresh();      // has_vnc_passwd 갱신 → 경고와 폼이 사라진다
    } catch (err) {
      setPwError(err?.message || String(err));
    } finally {
      setPwSaving(false);
    }
  };

  const handleCreate = async (overrideGeom) => {
    setActionError('');
    const override = typeof overrideGeom === 'string' ? overrideGeom : '';
    const geom = override || (useCustom ? customGeometry.trim() : geometry);
    if (!_GEOMETRY_RE.test(geom)) {
      setActionError(t?.('vncInvalidGeometry') || 'Use WxH format (e.g. 1600x900)');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`/api/hosts/${host?.id}/vnc/sessions`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry: geom }),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(15000)
          : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json?.detail || `${res.status}`;
        setActionError(`${t?.('vncCreateFailed') || 'Failed to create desktop'}: ${msg}`);
        return;
      }
      if (json.available === false) {
        setActionError(`${t?.('vncCreateFailed') || 'Failed to create desktop'}: ${json.error || ''}`);
        return;
      }
      // 성공 — 목록 갱신 후 새 디스플레이로 바로 연결.
      await refresh();
      if (json.display != null) onPick(json.display);
    } catch (err) {
      setActionError(`${t?.('vncCreateFailed') || 'Failed to create desktop'}: ${err?.message || String(err)}`);
    } finally {
      setCreating(false);
    }
  };

  // ── 가상 데스크탑 종료 — 반드시 확인 절차를 거친다 ──────────────────────
  const handleKill = (display) => {
    if (!onConfirm) return; // 확인 모달이 없으면 종료 금지 (안전장치)
    setActionError('');
    onConfirm({
      title: t?.('vncKillDesktop') || 'Terminate desktop',
      message: t?.('vncKillConfirm')
        || 'Terminate this VNC desktop? Everything running in it will be killed.',
      confirmText: t?.('vncKill') || 'Terminate',
      danger: true,
      onConfirm: async () => {
        setKillingDisplay(display);
        try {
          const res = await fetch(`/api/hosts/${host?.id}/vnc/sessions/${display}`, {
            method: 'DELETE',
            headers: authHeaders(),
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
              ? AbortSignal.timeout(15000)
              : undefined,
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            const msg = json?.detail || `${res.status}`;
            setActionError(`${t?.('vncKillFailed') || 'Failed to terminate desktop'}: ${msg}`);
            return;
          }
          if (json.available === false) {
            setActionError(`${t?.('vncKillFailed') || 'Failed to terminate desktop'}: ${json.error || ''}`);
            return;
          }
          await refresh();
        } catch (err) {
          setActionError(`${t?.('vncKillFailed') || 'Failed to terminate desktop'}: ${err?.message || String(err)}`);
        } finally {
          setKillingDisplay(null);
        }
      },
    });
  };

  const displays = Array.isArray(state.data?.displays) ? state.data.displays : [];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color.scrim,
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '92%',
          maxWidth: '460px',
          maxHeight: '78vh',
          background: color.base,
          border: `1px solid ${color.borderStrong}`,
          borderRadius: radius.lg,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: font.sans,
        }}
      >
        {/* 헤더 — 제목 + 호스트명 + 닫기 (RemoteFolderPicker 패턴) */}
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `12px ${space['4']}`,
          borderBottom: `1px solid ${color.border}`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <Monitor size={15} strokeWidth={1.8} style={{ color: color.accent, flexShrink: 0 }} />
            <span style={{
              fontSize: fontSize['13'],
              fontWeight: fontWeight.semibold,
              color: color.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {t?.('remoteDesktop') || 'Remote desktop'} <span style={{ color: color.muted }}>— {host?.name || host?.id}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t?.('close') || 'Close'}
            style={{
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              color: color.subtext,
              padding: 0,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = color.text; e.currentTarget.style.background = color.surface1; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = color.subtext; e.currentTarget.style.background = 'transparent'; }}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        </header>

        {/* 본문 — 스크롤 가능 영역 */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: `12px ${space['4']}`,
          minHeight: '160px',
        }}>

        {/* GPU 가속 능력 배지 — 호스트 수준. 설치/가용일 때만 표시. */}
        {!state.loading && !state.error && state.data?.installed !== false && state.data?.available !== false && (() => {
          const isGpu = state.data?.gpu?.renderer_hint === 'gpu';
          const flavor = state.data?.flavor || '';
          const Badge = isGpu ? Zap : Cpu;
          const badgeColor = isGpu ? color.success : color.subtext;
          return (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px',
              padding: '6px 10px',
              background: `color-mix(in srgb, ${badgeColor} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${badgeColor} 32%, transparent)`,
              borderRadius: '8px',
            }}>
              <Badge size={13} strokeWidth={2} style={{ color: badgeColor, flexShrink: 0 }} />
              <span style={{
                fontSize: fontSize['11'],
                fontWeight: fontWeight.medium,
                color: badgeColor,
              }}>
                {isGpu
                  ? (t?.('vncGpuAvailable') || 'GPU acceleration (VirtualGL)')
                  : (t?.('vncSoftwareRender') || 'Software rendering')}
              </span>
              {flavor && (
                <span style={{
                  fontSize: fontSize['10'],
                  fontWeight: fontWeight.medium,
                  color: color.subtext,
                  marginLeft: 'auto',
                  textTransform: 'capitalize',
                }}>
                  {flavor === 'turbovnc' ? 'TurboVNC' : 'TigerVNC'}
                </span>
              )}
            </div>
          );
        })()}

        {/* 본문 — 로딩 / 에러 / 디스플레이 목록 */}
        {state.loading && (
          <div style={{ padding: '16px 0', textAlign: 'center', color: color.subtext, fontSize: fontSize['12'] }}>
            {t?.('loading') || 'Loading…'}
          </div>
        )}

        {!state.loading && state.error && (
          <div style={{
            padding: '12px',
            background: `color-mix(in srgb, ${color.danger} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color.danger} 35%, transparent)`,
            borderRadius: '8px',
            color: color.danger,
            fontSize: fontSize['12'],
          }}>
            {t?.('vncFetchError') || 'Could not query VNC displays.'} ({state.error})
          </div>
        )}

        {!state.loading && !state.error && state.data?.available !== false
          && displays.length === 0 && state.data?.installed === false && (
          <div style={{
            padding: '12px',
            background: `color-mix(in srgb, ${color.warning} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color.warning} 35%, transparent)`,
            borderRadius: '8px',
            color: color.warning,
            fontSize: fontSize['12'],
          }}>
            <div>{t?.('vncNotInstalled') || 'VNC is not installed on this host.'}</div>
            {/* 설치법 안내 — "없다" 로 끝내면 사용자가 다음에 뭘 해야 할지 모른다.
                배포판을 감지해 실제 명령을 보여준다. */}
            {state.data?.install_cmd && (
              <div style={{
                marginTop: '8px',
                padding: '6px 8px',
                background: `color-mix(in srgb, ${color.surface1} 70%, transparent)`,
                border: `1px solid ${color.border}`,
                borderRadius: '4px',
                fontFamily: font.mono,
                fontSize: fontSize['11'],
                color: color.text,
                userSelect: 'all',
                wordBreak: 'break-all',
              }}>
                {state.data.install_cmd}
              </div>
            )}
            {/* VNC 만 깔고 데스크탑이 없으면 세션이 뜨자마자 죽는다 — TigerVNC 는 세션
                스크립트가 끝나면 서버를 같이 내린다. 실제로 겪은 실패라 미리 알린다. */}
            {state.data?.install_cmd && state.data?.has_desktop === false && (
              <div style={{ marginTop: '6px', fontSize: fontSize['11'], color: color.subtext }}>
                {t?.('vncNeedsDesktop')
                  || 'A desktop environment is also required — without one the session exits immediately.'}
              </div>
            )}
          </div>
        )}

        {!state.loading && !state.error && state.data?.available === false && (
          <div style={{
            padding: '12px',
            background: `color-mix(in srgb, ${color.danger} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color.danger} 35%, transparent)`,
            borderRadius: '8px',
            color: color.danger,
            fontSize: fontSize['12'],
          }}>
            {t?.('vncUnavailable') || 'VNC is not available on this host right now.'}
          </div>
        )}

        {!state.loading && !state.error && state.data?.available !== false
          && (displays.length > 0 || state.data?.installed !== false) && (
          <>
            {/* 생성/종료 액션 에러 배너 */}
            {actionError && (
              <div style={{
                padding: '10px 12px',
                background: `color-mix(in srgb, ${color.danger} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color.danger} 35%, transparent)`,
                borderRadius: '8px',
                color: color.danger,
                fontSize: fontSize['12'],
                marginBottom: '8px',
              }}>
                {actionError}
              </div>
            )}
            {/* displays 는 있으나 vncserver 미발견 — 기존 디스플레이 연결은 가능 */}
            {displays.length > 0 && state.data?.installed === false && (
              <div style={{
                padding: '8px 12px',
                background: `color-mix(in srgb, ${color.warning} 10%, transparent)`,
                border: `1px solid color-mix(in srgb, ${color.warning} 25%, transparent)`,
                borderRadius: '6px',
                color: color.warning,
                fontSize: fontSize['11'],
                marginBottom: '8px',
              }}>
                {t?.('vncConnectOnly') || 'Existing displays can be connected. New session creation is disabled (vncserver not found).'}
              </div>
            )}
            {displays.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ padding: '12px', textAlign: 'center', color: color.subtext, fontSize: fontSize['12'] }}>
                  {t?.('vncNoDisplays') || 'No active VNC displays found.'}
                </div>
                {/* 주 액션 — pane/뷰포트 실측 크기로 만들고 연결. installed=false 면 비활성. */}
                {state.data?.installed !== false && (
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => handleCreate(dynamicGeometry)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '12px 16px',
                      background: creating ? color.surface1 : color.accent,
                      color: creating ? color.subtext : color.surface0,
                      border: `1px solid ${creating ? color.border : color.accent}`,
                      borderRadius: '8px',
                      cursor: creating ? 'not-allowed' : 'pointer',
                      fontSize: fontSize['13'],
                      fontWeight: fontWeight.semibold,
                      appearance: 'none',
                      transition: 'background 120ms, opacity 120ms',
                    }}
                  >
                    <Plus size={15} strokeWidth={2} />
                    {creating
                      ? (t?.('vncCreating') || 'Creating…')
                      : (t?.('vncCreateAndConnect') || 'Create and connect')}
                    {!creating && (
                      <span style={{ fontFamily: font.mono, fontSize: fontSize['11'], opacity: 0.8 }}>
                        {dynamicGeometry}
                      </span>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {displays.map((d, idx) => {
                  const num = d.display != null ? d.display : d.id;
                  const label = `:${num} (${d.geometry || (t?.('unknown') || 'unknown')})`;
                  const isKilling = killingDisplay === num;
                  return (
                    <div key={`${num}-${idx}`} style={{ display: 'flex', alignItems: 'stretch', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => onPick(num)}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '10px 12px',
                          background: color.surface1,
                          border: `1px solid ${color.border}`,
                          borderRadius: '8px',
                          cursor: 'pointer',
                          color: color.text,
                          fontSize: fontSize['13'],
                          fontFamily: font.mono,
                          textAlign: 'left',
                          appearance: 'none',
                          transition: 'background 120ms, border-color 120ms',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = color.surface2;
                          e.currentTarget.style.borderColor = color.accent;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = color.surface1;
                          e.currentTarget.style.borderColor = color.border;
                        }}
                      >
                        <Monitor size={15} strokeWidth={1.6} style={{ color: color.accent, flexShrink: 0 }} />
                        {label}
                      </button>
                      {onConfirm && (
                        <button
                          type="button"
                          title={t?.('vncKillDesktop') || 'Terminate desktop'}
                          disabled={isKilling}
                          onClick={(e) => { e.stopPropagation(); handleKill(num); }}
                          style={{
                            width: '34px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: color.surface1,
                            border: `1px solid color-mix(in srgb, ${color.danger} 30%, transparent)`,
                            borderRadius: '8px',
                            cursor: isKilling ? 'not-allowed' : 'pointer',
                            color: color.danger,
                            opacity: isKilling ? 0.5 : 1,
                            appearance: 'none',
                            transition: 'background 120ms',
                          }}
                          onMouseEnter={(e) => { if (!isKilling) e.currentTarget.style.background = `color-mix(in srgb, ${color.danger} 15%, transparent)`; }}
                          onMouseLeave={(e) => { if (!isKilling) e.currentTarget.style.background = color.surface1; }}
                        >
                          <Power size={13} strokeWidth={1.8} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* 새 가상 데스크탑 만들기 — vncserver 가 있을 때만 */}
            {state.data?.installed !== false && (
              <div style={{
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: `1px solid ${color.border}`,
              }}>
                <div style={{
                  marginBottom: '8px',
                  fontSize: fontSize['12'],
                  fontWeight: fontWeight.semibold,
                  color: color.text,
                }}>
                  {t?.('vncCreateDesktop') || 'Create new desktop'}
                </div>
                {state.data?.has_vnc_passwd === false && (
                  <div style={{
                    marginBottom: '8px',
                    padding: '6px 8px',
                    background: `color-mix(in srgb, ${color.warning} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${color.warning} 25%, transparent)`,
                    borderRadius: '6px',
                    fontSize: fontSize['11'],
                    color: color.warning,
                    lineHeight: 1.4,
                  }}>
                    <div>{t?.('vncNoPassword') || 'New desktop will be created without a password. Anyone with shell access to this host can connect.'}</div>
                    {/* 경고로 끝내지 않고 그 자리에서 고칠 수 있게 한다. 설정하면
                        백엔드가 ~/.vnc/passwd 유무로 분기하므로 이후 세션은 VncAuth 로
                        뜨고 클라이언트가 입력을 받는다. */}
                    <form
                      onSubmit={(e) => { e.preventDefault(); handleSetPassword(); }}
                      style={{ display: 'flex', gap: '6px', marginTop: '8px' }}
                    >
                      <input
                        type="password"
                        value={pwValue}
                        onChange={(e) => setPwValue(e.target.value)}
                        placeholder={t?.('vncPasswordPlaceholder') || '6–8 characters'}
                        autoComplete="new-password"
                        maxLength={8}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          padding: '4px 8px',
                          background: color.surface0,
                          border: `1px solid ${color.border}`,
                          borderRadius: '4px',
                          fontFamily: font.sans,
                          fontSize: fontSize['11'],
                          color: color.text,
                          outline: 'none',
                        }}
                      />
                      <button
                        type="submit"
                        disabled={pwSaving || pwValue.length < 6}
                        style={{
                          padding: '4px 10px',
                          background: pwValue.length < 6 ? color.surface1 : color.accentSubtle,
                          border: `1px solid ${pwValue.length < 6 ? color.border : color.accentBorder}`,
                          borderRadius: '4px',
                          fontFamily: font.sans,
                          fontSize: fontSize['11'],
                          fontWeight: fontWeight.medium,
                          color: pwValue.length < 6 ? color.subtext : color.accent,
                          cursor: pwValue.length < 6 ? 'default' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {pwSaving
                          ? (t?.('vncPasswordSaving') || 'Setting…')
                          : (t?.('vncSetPassword') || 'Set password')}
                      </button>
                    </form>
                    {pwError && (
                      <div style={{ marginTop: '5px', fontSize: fontSize['11'], color: color.danger }}>
                        {pwError}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: useCustom ? '8px' : '10px' }}>
                  {VNC_GEOMETRY_PRESETS.map((p) => {
                    const active = !useCustom && geometry === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => { setGeometry(p); setUseCustom(false); }}
                        style={{
                          padding: '4px 10px',
                          background: active ? color.accent : color.surface1,
                          color: active ? color.surface0 : color.text,
                          border: `1px solid ${active ? color.accent : color.border}`,
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: fontSize['11'],
                          fontFamily: font.mono,
                          appearance: 'none',
                        }}
                      >
                        {p}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setUseCustom(true)}
                    style={{
                      padding: '4px 10px',
                      background: useCustom ? color.accent : color.surface1,
                      color: useCustom ? color.surface0 : color.text,
                      border: `1px solid ${useCustom ? color.accent : color.border}`,
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: fontSize['11'],
                      appearance: 'none',
                    }}
                  >
                    {t?.('vncCustom') || 'Custom'}
                  </button>
                </div>
                {useCustom && (
                  <input
                    type="text"
                    placeholder={t?.('vncGeometryPlaceholder') || 'e.g. 1600x900'}
                    value={customGeometry}
                    onChange={(e) => setCustomGeometry(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      background: color.surface1,
                      border: `1px solid ${color.border}`,
                      borderRadius: '6px',
                      color: color.text,
                      fontSize: fontSize['12'],
                      fontFamily: font.mono,
                      boxSizing: 'border-box',
                      marginBottom: '10px',
                      outline: 'none',
                    }}
                  />
                )}
                <button
                  type="button"
                  disabled={creating || (useCustom && !_GEOMETRY_RE.test(customGeometry.trim()))}
                  onClick={() => handleCreate()}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: creating ? color.surface1 : color.accent,
                    color: creating ? color.subtext : color.surface0,
                    border: 'none',
                    borderRadius: '8px',
                    cursor: creating ? 'not-allowed' : 'pointer',
                    fontSize: fontSize['12'],
                    fontWeight: fontWeight.semibold,
                    appearance: 'none',
                  }}
                >
                  {creating ? (t?.('vncCreating') || 'Creating…') : (t?.('vncCreate') || 'Create')}
                </button>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
};

const Section = ({ icon: Icon, title, children }) => (
  <div style={emptyStyles.section}>
    <div style={emptyStyles.sectionHead}>
      {Icon && <Icon size={12} strokeWidth={2.2} style={{ color: color.subtext, flexShrink: 0 }} />}
      <span style={emptyStyles.sectionTitle}>{title}</span>
    </div>
    <div>{children}</div>
  </div>
);

const emptyStyles = {
  root: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    padding: '20px 20px 24px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxWidth: '960px',
    width: '100%',
    margin: '0 auto',
  },
  sectionHead: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: color.subtext,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '8px',
  },
};

const OpenTabPicker = ({ tabs, hosts = [], onPick, t, embedded = false, emptySlotCount = 0 }) => {
  const palette = color.dotPalette || ['#89b4fa'];
  const [hoverId, setHoverId] = useState(null);
  const innerStyle = embedded
    ? { display: 'flex', flexDirection: 'column', gap: '8px' }
    : mirrorStyles.inner;
  return (
    <div style={embedded ? null : mirrorStyles.outer}>
      <div style={innerStyle}>
        {!embedded && (
          <div style={mirrorStyles.titleRow}>
            <Copy size={12} strokeWidth={2} style={{ color: color.subtext }} />
            <span style={mirrorStyles.title}>
              {t?.('mirrorOpenTab') || 'Mirror an open tab here'}
            </span>
          </div>
        )}
        <div style={mirrorStyles.grid}>
          {tabs.map(({ tab: tb, index }) => {
            const isHost = tb.type === 'host';
            const hostMeta = isHost ? hosts.find((h) => h.id === tb.hostId) : null;
            const accent = tb.color_index != null
              ? palette[tb.color_index % palette.length]
              : color.accent;
            const paneCount = (tb.panes || []).filter((p) => p.sessionId || p.hostId).length;
            const disabled = paneCount > emptySlotCount;
            return (
              <HostRow
                key={tb.id}
                id={tb.id}
                accentColor={accent}
                leadingBadge={null}
                disabled={disabled}
                icon={
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
                    <HostIcon
                      value={tb.icon || (hostMeta?.icon || '')}
                      fallback={isHost ? Server : TerminalIcon}
                      size={20}
                    />
                    {index <= 9 && (
                      <span style={{
                        position: 'absolute',
                        top: '-6px',
                        left: '-6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: '14px',
                        height: '14px',
                        padding: '0 3px',
                        fontSize: '9px',
                        fontWeight: 700,
                        color: color.base,
                        fontFamily: font.mono,
                        background: accent,
                        borderRadius: '3px',
                        lineHeight: 1,
                        pointerEvents: 'none',
                      }}>
                        {index}
                      </span>
                    )}
                  </div>
                }
                name={tb.name}
                subtitle={
                  <>
                    <span style={{ ...SUB_LINE, opacity: disabled ? 0.35 : 1 }}>
                      {isHost
                        ? (hostMeta ? `${hostMeta.ssh_user}@${hostMeta.hostname}` : tb.hostId)
                        : (t?.('thisMachine') || 'This machine')}
                    </span>
                    <span style={{ ...SUB_LINE, color: color.faint, opacity: disabled ? 0.35 : 1 }}>
                      {paneCount > 1
                        ? `${paneCount} ${t?.('panesInTab') || 'panes'}`
                        : (tb.cwd || '')}
                    </span>
                  </>
                }
                isHovered={disabled ? false : hoverId === tb.id}
                onHover={disabled ? null : setHoverId}
                onClick={disabled ? null : () => onPick(tb.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

const mirrorStyles = {
  outer: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0 20px 16px',
  },
  inner: {
    width: '100%',
    maxWidth: '960px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingTop: '4px',
  },
  titleRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  title: {
    fontSize: '11px',
    fontWeight: 600,
    color: color.subtext,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '8px',
  },
};

export { VncDisplayPicker };
export default EmptyPane;
