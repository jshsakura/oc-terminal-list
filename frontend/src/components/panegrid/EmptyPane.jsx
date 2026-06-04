/**
 * 빈 pane 의 홈 화면 — 호스트/로컬 대시보드 + "다른 열린 탭 미러" 섹션.
 * PaneGrid.jsx 에서 로직 변경 없이 추출. EmptyPane 만 외부로 노출하고 나머지는 내부 전용.
 */
import { useState } from 'react';
import { ArrowRightLeft, Copy, Server, Terminal as TerminalIcon } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import HomeDashboard, { HostRow } from '../HomeDashboard';
import HostIcon from '../../utils/hostIcons';

const { color, font } = tokens;

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
    <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', height: '100%', overflow: 'auto' }}>
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

export default EmptyPane;
