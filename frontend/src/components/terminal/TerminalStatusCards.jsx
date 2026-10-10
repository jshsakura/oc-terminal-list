import { Loader2, MonitorSmartphone, PowerOff, RotateCcw, ServerCrash, Unplug, WifiOff, X } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { styles } from './terminalStyles';
import { GlassOverlayCard } from './TerminalOverlays';
import GlassActionButton from './GlassActionButton';

const { fontSize, fontWeight } = tokens;

/**
 * 터미널을 덮는 상태 카드들 — 사용자 결정을 기다리는 모달성 오버레이.
 * 순수 표현: 상태는 Terminal.jsx 가 들고, 여기선 그리고 콜백만 올린다.
 */

// 카드 제목 + 설명 (+ 부가 문구) 공통 블록.
const CardText = ({ themeUi, title, desc, note }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{ fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: themeUi.text, marginBottom: '4px' }}>
      {title}
    </div>
    <div style={{ fontSize: fontSize['11'], color: themeUi.subtext, lineHeight: 1.5 }}>
      {desc}
    </div>
    {note && (
      <div style={{ marginTop: '6px', fontSize: fontSize['11'], color: themeUi.warning || themeUi.subtext, lineHeight: 1.45 }}>
        {note}
      </div>
    )}
  </div>
);

// 버튼 안의 스피너/아이콘 — 재연결 중이면 회전.
const ActionIcon = ({ busy, Icon, style }) => (
  busy
    ? <Loader2 size={12} strokeWidth={2} style={{ animation: 'tl-spin 0.8s linear infinite', ...style }} />
    : (Icon ? <Icon size={12} strokeWidth={2} style={style} /> : null)
);

const INLINE_ICON = { verticalAlign: '-2px', marginRight: '5px' };

/**
 * 로딩이 오래 멈춤 — 원인이 "이 기기 오프라인"인지 "서버·네트워크"인지 먼저 말해주고,
 * 그 상황에서 실제로 되는 선택지만 준다(오프라인이면 "다시 시도"는 숨김 — 눌러도 안 되니까).
 */
export const ConnectionTroubleCard = ({ themeUi, t, isOffline, reconnecting, onClosePane, onRetry }) => (
  <GlassOverlayCard themeUi={themeUi} zIndex={10040}>
    <div style={styles.glassIconTile(themeUi, isOffline ? (themeUi.danger || themeUi.warning) : (themeUi.warning || themeUi.subtext))}>
      {isOffline ? <WifiOff size={18} strokeWidth={1.8} /> : <ServerCrash size={18} strokeWidth={1.8} />}
    </div>
    <div style={{ textAlign: 'center' }}>
      {/* 원인 측 배지 — 클라이언트/서버 즉시 구분 */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px', marginBottom: '6px',
        fontSize: '10px', fontWeight: fontWeight.semibold, letterSpacing: '0.05em', textTransform: 'uppercase',
        color: isOffline ? (themeUi.danger || themeUi.warning) : themeUi.warning,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
        {isOffline ? (t('sideThisDevice') || '이 기기') : (t('sideServer') || '서버 · 네트워크')}
      </div>
      <div style={{ fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: themeUi.text, marginBottom: '4px' }}>
        {isOffline ? (t('offlineTitle') || '인터넷 연결 없음') : (t('serverUnreachableTitle') || '서버에 연결할 수 없습니다')}
      </div>
      <div style={{ fontSize: fontSize['11'], color: themeUi.subtext, lineHeight: 1.5 }}>
        {isOffline
          ? (t('offlineDesc') || '이 기기가 오프라인입니다. 네트워크가 복구되면 자동으로 다시 연결됩니다.')
          : (t('serverUnreachableDesc') || '서버 또는 네트워크 경로 문제일 수 있습니다. 다시 시도하거나 이 탭을 접을 수 있습니다.')}
      </div>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' }}>
      {/* 이 탭 접기 — 연결이 없어도 화면에서 제거는 항상 가능(세션이 살아있으면 홈에서 재개). */}
      {onClosePane && (
        <GlassActionButton
          themeUi={themeUi}
          color={themeUi.subtext}
          onClick={onClosePane}
          title={t('dismissTabHint') || '화면에서만 닫습니다. 세션이 살아있으면 홈에서 다시 열 수 있습니다.'}
          style={{ flex: '1 1 92px', minWidth: 0 }}
        >
          <X size={12} strokeWidth={2} style={INLINE_ICON} />
          {t('dismissTab') || '이 탭 접기'}
        </GlassActionButton>
      )}
      {!isOffline && (
        <GlassActionButton
          themeUi={themeUi}
          color={themeUi.accent}
          onClick={onRetry}
          disabled={reconnecting}
          style={{ flex: '1 1 112px', minWidth: 0 }}
        >
          <ActionIcon busy={reconnecting} Icon={RotateCcw} style={INLINE_ICON} />
          {reconnecting ? (t('reconnecting') || '연결 중...') : (t('retry') || '다시 시도')}
        </GlassActionButton>
      )}
    </div>
  </GlassOverlayCard>
);

/**
 * 원격 호스트에 못 붙었다 — **확정된 실패**다(WS 는 열렸고 그 뒤 SSH 가 실패했다).
 *
 * 이 카드가 따로 있는 이유: 전에는 이 상황이 하단의 "다시 연결 중…" 스피너 하나로만
 * 보였고, 그건 사용자에게 **무한 로딩**으로 읽혔다. 서버는 이미 사유를 보내 주는데
 * (`connect-failed` 의 detail: 노드 키 만료·호스트 오프라인·인증 거부 등) 그 문장이
 * 스크롤백의 빨간 줄 한 줄로만 남아 묻혀 있었다. 실패는 실패로 보여야 한다.
 *
 * ⚠️ 사유는 **서버 문장을 그대로** 쓴다. 프론트가 고쳐 쓰면 두 곳이 어긋나고, 새 사유를
 *    백엔드에 추가할 때마다 여기도 고쳐야 한다.
 * ⚠️ "자동으로 다시 시도합니다" 를 **반드시** 같이 적는다. 재시도는 실제로 계속 돌고 있고
 *    (4→8→16→30s), 그 말이 없으면 사용자는 끝난 줄 알고 탭을 닫는다.
 */
export const HostUnreachableCard = ({
  themeUi, t, detail, retrySeconds, reconnecting, onClosePane, onRetry,
}) => (
  <GlassOverlayCard themeUi={themeUi} zIndex={10040}>
    <div style={styles.glassIconTile(themeUi, themeUi.danger || themeUi.warning)}>
      <Unplug size={18} strokeWidth={1.8} />
    </div>
    <div style={{ textAlign: 'center' }}>
      {/* 원인 측 배지 — 이 기기도 서버도 아니라 **상대 호스트**임을 먼저 말한다. */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px', marginBottom: '6px',
        fontSize: '10px', fontWeight: fontWeight.semibold, letterSpacing: '0.05em', textTransform: 'uppercase',
        color: themeUi.danger || themeUi.warning,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
        {t('sideRemoteHost') || '원격 호스트'}
      </div>
      <div style={{
        fontSize: fontSize['13'], fontWeight: fontWeight.semibold, color: themeUi.text, marginBottom: '4px',
      }}>
        {t('hostUnreachableTitle') || '호스트에 연결할 수 없습니다'}
      </div>
      {detail && (
        <div style={{
          fontSize: fontSize['11'], color: themeUi.subtext, lineHeight: 1.5,
          wordBreak: 'break-word', textAlign: 'left',
        }}>
          {detail}
        </div>
      )}
      <div style={{
        marginTop: '6px', fontSize: fontSize['11'], color: themeUi.warning || themeUi.subtext, lineHeight: 1.45,
      }}>
        {retrySeconds
          ? ((t('hostRetryInSeconds') || '약 {s}초 뒤 자동으로 다시 시도합니다.').replace('{s}', String(retrySeconds)))
          : (t('hostRetryAuto') || '자동으로 다시 시도합니다.')}
      </div>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' }}>
      {onClosePane && (
        <GlassActionButton
          themeUi={themeUi}
          color={themeUi.subtext}
          onClick={onClosePane}
          title={t('dismissTabHint') || '화면에서만 닫습니다. 세션이 살아있으면 홈에서 다시 열 수 있습니다.'}
          style={{ flex: '1 1 92px', minWidth: 0 }}
        >
          <X size={12} strokeWidth={2} style={INLINE_ICON} />
          {t('dismissTab') || '이 탭 접기'}
        </GlassActionButton>
      )}
      <GlassActionButton
        themeUi={themeUi}
        color={themeUi.accent}
        onClick={onRetry}
        disabled={reconnecting}
        style={{ flex: '1 1 112px', minWidth: 0 }}
      >
        <ActionIcon busy={reconnecting} Icon={RotateCcw} style={INLINE_ICON} />
        {reconnecting ? (t('reconnecting') || '연결 중...') : (t('retryNow') || '지금 다시 시도')}
      </GlassActionButton>
    </div>
  </GlassOverlayCard>
);

/** 다른 기기가 tmux 를 가져감(takeover) — 사용자가 명시적으로 되찾아야 재attach 한다. */
export const TakeoverCard = ({ themeUi, t, reconnecting, onTakeOver }) => (
  <GlassOverlayCard themeUi={themeUi} zIndex={10040}>
    <div style={styles.glassIconTile(themeUi, themeUi.warning || '#f9e2af')}>
      <MonitorSmartphone size={18} strokeWidth={1.8} />
    </div>
    <CardText
      themeUi={themeUi}
      title={t('takenOverTitle') || '다른 기기에서 접속 중'}
      desc={t('takenOverDesc') || '이 세션은 다른 기기가 사용하고 있습니다.'}
    />
    <GlassActionButton
      themeUi={themeUi}
      color={themeUi.accent}
      onClick={onTakeOver}
      disabled={reconnecting}
    >
      {reconnecting && <ActionIcon busy Icon={null} style={INLINE_ICON} />}
      {reconnecting ? (t('reconnecting') || '연결 중...') : (t('takeOver') || '내가 가져오기')}
    </GlassActionButton>
  </GlassOverlayCard>
);

/** 셸이 깨끗이 종료돼 pane 을 자동으로 닫는 중 — 되돌릴 여유를 준다. */
export const ShellClosingCard = ({ themeUi, t, onUndo }) => (
  <GlassOverlayCard themeUi={themeUi} zIndex={10040}>
    <div style={styles.glassIconTile(themeUi, themeUi.subtext)}>
      <PowerOff size={18} strokeWidth={1.8} />
    </div>
    <CardText
      themeUi={themeUi}
      title={t('shellEndedTitle') || '셸이 종료되었습니다'}
      desc={t('autoClosingDesc') || '잠시 후 이 탭이 닫힙니다.'}
    />
    <GlassActionButton themeUi={themeUi} color={themeUi.subtext} onClick={onUndo} style={{ width: '100%' }}>
      <RotateCcw size={12} strokeWidth={2} style={INLINE_ICON} />
      {t('undoClose') || '되돌리기'}
    </GlassActionButton>
  </GlassOverlayCard>
);

/** 셸 종료 — 닫기 / 기존 셸 재연결 / 새 셸 시작 중 고르게 한다. */
export const ShellEndedCard = ({
  themeUi, t, notice, reconnecting, onClosePane, onReconnect, onRestart,
}) => (
  <GlassOverlayCard themeUi={themeUi} zIndex={10040}>
    <div style={styles.glassIconTile(themeUi, themeUi.subtext)}>
      <PowerOff size={18} strokeWidth={1.8} />
    </div>
    <CardText
      themeUi={themeUi}
      title={t('shellEndedTitle') || '셸이 종료되었습니다'}
      desc={t('shellEndedDesc') || '기존 셸에 다시 연결할 수 있습니다.'}
      note={notice}
    />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' }}>
      {onClosePane && (
        <GlassActionButton
          themeUi={themeUi}
          color={themeUi.subtext}
          onClick={onClosePane}
          style={{ flex: '1 1 0', minWidth: 0 }}
        >
          <X size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
          <span style={styles.glassActionLabel}>{t('close') || '닫기'}</span>
        </GlassActionButton>
      )}
      <GlassActionButton
        themeUi={themeUi}
        color={themeUi.accent}
        onClick={onReconnect}
        disabled={reconnecting}
        style={{ flex: '1 1 0', minWidth: 0 }}
      >
        <ActionIcon busy={reconnecting} Icon={RotateCcw} style={{ flexShrink: 0 }} />
        <span style={styles.glassActionLabel}>
          {reconnecting ? (t('reconnecting') || '연결 중...') : (t('reconnectExistingShell') || '다시 연결')}
        </span>
      </GlassActionButton>
      <GlassActionButton
        themeUi={themeUi}
        color={themeUi.warning || themeUi.accent}
        onClick={onRestart}
        disabled={reconnecting}
        style={{ flex: '1 1 0', minWidth: 0 }}
      >
        <PowerOff size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
        <span style={styles.glassActionLabel}>{t('restartShell') || '새 셸 시작'}</span>
      </GlassActionButton>
    </div>
  </GlassOverlayCard>
);
