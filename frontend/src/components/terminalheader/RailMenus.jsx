/**
 * TerminalHeader 의 레일 메뉴/팝오버 헬퍼.
 * - RailSubMenu: anchor 기준으로 뜨는 글래스 서브메뉴 컨테이너
 * - MenuBtn: 서브메뉴 안의 버튼
 * - CommandHistoryPopover: 명령 히스토리 팝오버(자기 히스토리 ↔ 세션 픽커)
 * TerminalHeader.jsx 에서 로직 변경 없이 추출.
 */
import { useState, useEffect, useRef } from 'react';
import {
  X, Trash2, ArrowLeftRight, Check, ChevronLeft, ChevronRight, Copy, CornerDownLeft, Monitor, Server,
} from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { glassMenuStyle } from '../../styles/glass';
import useCommandHistory from '../../hooks/useCommandHistory';
import { removeCommand as removeHistoryCommand, clearCommandsFor as clearHistoryFor } from '../../utils/commandHistory';
import { copyToClipboard } from '../../utils/clipboard';
import { fetchPaneCwdHints } from '../../utils/paneSessions';
import { apiFetch } from '../../utils/apiFetch';
import { authHeaders } from '../../utils/auth';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import { sentenceLines, KEEP_WORDS_TOGETHER } from '../../utils/sentenceLines';

const { color, font, fontSize, fontWeight, space, radius } = tokens;

const RailSubMenu = ({ anchor, ui, isMobile = false, onClose, t, children }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });
  const [measured, setMeasured] = useState(false);

  useDismissOnOutside(ref, onClose);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const margin = 8;
      let nextX = anchor.x - rect.width;
      let nextY = anchor.y;
      if (nextX < margin) nextX = margin;
      if (nextX + rect.width > window.innerWidth - margin) {
        nextX = window.innerWidth - rect.width - margin;
      }
      if (nextY + rect.height > window.innerHeight - margin) {
        nextY = window.innerHeight - rect.height - margin;
      }
      if (nextY < margin) nextY = margin;
      setPos({ x: nextX, y: nextY });
      setMeasured(true);
    }
  }, [anchor.x, anchor.y]);

  return (
    <div
      ref={ref}
      className={isMobile ? 'iterm-rail-submenu-mobile' : undefined}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        ...glassMenuStyle(ui),
        zIndex: 200000,
        minWidth: '160px',
        fontFamily: font.sans,
        opacity: measured ? 1 : 0,
        transition: 'opacity 120ms',
      }}
    >
      {isMobile && (
        <style>{`
          .iterm-rail-submenu-mobile > button {
            min-height: 42px !important;
            padding: 0 12px !important;
            font-size: 13px !important;
          }
          .iterm-rail-submenu-mobile > button > svg {
            width: 15px !important;
            height: 15px !important;
          }
        `}</style>
      )}
      {children}
    </div>
  );
};

/**
 * 메뉴 한 줄. `hint` 를 주면 라벨 **아래에 작은 설명 줄**이 붙는다.
 *
 * 왜 호버 title 이 아닌가: 이 앱은 폰에서 많이 쓰이고 터치 기기에는 hover 가 없어
 * `title` 이 영영 안 뜬다. 그리고 헷갈림이 실제로 사고를 내는 자리가 이 메뉴다
 * (새로고침 vs 세션 재시작 — 하나는 화면만 다시 그리고, 하나는 돌던 것을 다 죽인다).
 * 그래서 **정말 헷갈리는 항목에만** 붙인다. 전부 붙이면 메뉴가 문단이 된다.
 */
const MenuBtn = ({ icon: Icon, onClick, children, hint = null, danger = false, disabled = false, display = false, ui }) => {
  const fg = danger ? (ui?.danger || color.danger) : (ui?.text || color.text);
  // Stop propagation on all pointer events so the portal's outside-click listener
  // cannot swallow or duplicate the interaction. This is critical for the "Close terminal"
  // action where closeRailMenu() + onCloseTerminal() must both fire without interference.
  const stop = (e) => e.stopPropagation();
  return (
    <button
      type="button"
      onClick={display ? undefined : onClick}
      onPointerDown={stop}
      onTouchStart={stop}
      onMouseDown={stop}
      disabled={disabled}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: hint ? 'flex-start' : 'center',
        gap: '8px',
        textAlign: 'left',
        minHeight: '30px',
        padding: '6px 9px',
        background: 'transparent',
        border: 'none',
        borderRadius: '3px',
        cursor: display ? 'default' : (disabled ? 'default' : 'pointer'),
        color: fg,
        fontSize: '11.5px',
        fontFamily: 'inherit',
        transition: 'background 120ms',
        lineHeight: 1.3,
        opacity: disabled ? 0.5 : 1,
      }}
      /* display(값만 보여주는 행)와 disabled 에는 호버가 없어야 하므로 클래스를 안 붙인다.
         나머지는 앱 공용 규칙(main.jsx `.iterm-menu-item`)을 그대로 따른다. */
      className={(!disabled && !display) ? 'iterm-menu-item' : undefined}
    >
      {Icon && (
        <Icon size={13} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: hint ? '2px' : 0 }} />
      )}
      {hint ? (
        <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
          <span>{children}</span>
          {/* One line per sentence. Korean has no spaces to wrap on, so a hint left to
              the browser snaps mid-word ("실행 중" / "인 작업은") — the sentence is the
              break the reader already expects, and keep-all covers what still wraps. */}
          {sentenceLines(hint).map((line) => (
            <span
              key={line}
              style={{
                fontSize: '10px',
                lineHeight: 1.4,
                color: ui?.subtext || color.subtext,
                ...KEEP_WORDS_TOGETHER,
              }}
            >
              {line}
            </span>
          ))}
        </span>
      ) : children}
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CommandHistoryPopover — eye 아이콘 아래에 뜨는 작은 popover.
// 세 개의 모드가 **같은 프레임**(위치/폭 고정, 내용만 교체) 안에서 돌아간다:
//
//  history  — 이 터미널의 최근 명령 (기본). 클릭 → 재전송, X → 개별 삭제, 휴지통 → 비우기.
//  sessions — 다른 살아있는 세션 목록 (Pane 이 collectOtherPaneSessions 로 계산해 넘김).
//  commands — 고른 세션의 히스토리. 행 클릭 → 이 터미널로 pull, 클립보드 아이콘 → 복사,
//             상단 compose 행 입력 → **그 세션으로 push**(사용자가 원하던 "tab2 에서 tab1 로").
//
// 동작:
// - 외부 클릭 / Escape 로 닫힘 (setTimeout(0) 패턴 — 즉시 자동 닫힘 방지)
// - 등장 시 fade + 살짝 위에서 내려오는 모션
// - 각 row 는 mono font, ellipsis, X 로 개별 삭제 가능
const MODE_HISTORY = 'history';
const MODE_SESSIONS = 'sessions';
const MODE_COMMANDS = 'commands';

// push 상태 — 성공/실패를 구분해서 보여준다(예전엔 무조건 초록 플래시였다).
const PUSH_IDLE = 'idle';
const PUSH_SENDING = 'sending';
const PUSH_OK = 'ok';
const PUSH_FAIL = 'fail';
// 백엔드가 원격 호스트로 SSH 를 거는 시간까지 기다린다(itl_remote.HOST_DEADLINE=20s).
// apiFetch 기본 15초로는 원격 전송이 성공해도 실패로 보인다.
const PUSH_TIMEOUT_MS = 30_000;

/** skip 사유 → 사람말. 백엔드 routes/itl.py 의 REASON_* 과 같이 움직인다. */
const pushSkipLabel = (reason, t) => {
  const map = {
    'session-gone': t?.('pickerSkipSessionGone') || 'That session is gone',
    'host-unreachable': t?.('pickerSkipHostUnreachable') || 'Could not reach that host',
    'send-failed': t?.('pickerSkipSendFailed') || 'tmux did not confirm the input',
    'remote-unsupported': t?.('pickerSkipUnsupported') || 'Nowhere to send that pane',
    deadline: t?.('pickerSkipDeadline') || 'Timed out before delivery',
  };
  return map[reason] || (t?.('pickerPushFailed') || 'Send failed');
};

const headerTitleStyle = (ui) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: fontSize['11'],
  fontWeight: fontWeight.semibold,
  color: ui.subtext,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  minWidth: 0,
});

const headerIconBtnStyle = (ui) => ({
  width: '20px',
  height: '20px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: ui.subtext,
  padding: 0,
  borderRadius: '4px',
  flexShrink: 0,
  transition: 'background 120ms, color 120ms',
});

/** 고른 세션의 명령 목록 — key 로 remount 되어 useCommandHistory 상태가 세션 사이에
 *  새어들지 않는다(로딩 중 이전 세션 명령이 잠깐 보이는 일 방지). */
const OtherSessionCommandList = ({ sessionKey, ui, isMobile, onSelect, onPickCopy, copiedText, t }) => {
  const listRef = useRef(null);
  const sentinelRef = useRef(null);
  const { items, hasMore, loading, loadingMore, loadMore } = useCommandHistory(sessionKey);

  // 인피니티 스크롤 — root 를 popover 안 스크롤 컨테이너로 지정.
  useEffect(() => {
    if (!sentinelRef.current || !listRef.current) return undefined;
    if (!hasMore) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { root: listRef.current, rootMargin: '60px 0px' });
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  const rowHeight = isMobile ? '34px' : '30px';

  return (
    <div ref={listRef} className="iterm-cmd-history-list" style={{
      flex: 1, overflowY: 'auto', padding: '4px',
      display: 'flex', flexDirection: 'column', gap: '2px',
    }}>
      {loading && items.length === 0 ? (
        [0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{
            flexShrink: 0, height: rowHeight, borderRadius: '4px',
            width: `${92 - (i % 3) * 16}%`,
            background: `linear-gradient(90deg,
              color-mix(in srgb, ${ui.surface1 || '#45475a'} 35%, transparent) 0%,
              color-mix(in srgb, ${ui.accent || '#89b4fa'} 18%, transparent) 50%,
              color-mix(in srgb, ${ui.surface1 || '#45475a'} 35%, transparent) 100%)`,
            backgroundSize: '300% 100%',
            animation: `iterm-skel-shimmer ${1.6 + i * 0.08}s ease-in-out infinite`,
            animationDelay: `${i * 80}ms`,
          }} />
        ))
      ) : items.length === 0 ? (
        <div style={{
          padding: '18px 12px', textAlign: 'center',
          fontSize: fontSize['12'], color: ui.subtext, opacity: 0.7,
        }}>
          {t?.('historyEmpty') || 'No history yet'}
        </div>
      ) : items.map((entry, idx) => {
        const isCopied = copiedText === entry.text;
        return (
          <div
            key={`${entry.ts}-${idx}`}
            className="iterm-cmd-history-item"
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', height: rowHeight,
              background: `color-mix(in srgb, ${ui.surface1} var(--glass-fill, 32%), transparent)`,
              borderRadius: '4px', overflow: 'hidden',
              transition: 'background 120ms',
              animationDelay: idx < 12 ? `${idx * 18}ms` : '0ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${ui.surface1} 70%, transparent)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${ui.surface1} var(--glass-fill, 32%), transparent)`; }}
          >
            {/* 행 클릭 = 이 pane 으로 pull. push 는 compose 행이 담당한다. */}
            <button
              type="button"
              onClick={() => onSelect?.(entry.text)}
              title={`${entry.text}\n— ${t?.('clickToResend') || 'click to re-send'}`}
              style={{
                flex: 1, minWidth: 0, height: '100%', textAlign: 'left',
                background: 'transparent', color: ui.text, border: 'none',
                cursor: 'pointer', padding: '0 4px 0 9px',
                fontFamily: font.mono, fontSize: fontSize['12'],
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {entry.text}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPickCopy(entry.text); }}
              title={t?.('copy') || 'Copy'}
              aria-label={t?.('copy') || 'Copy'}
              style={{
                flexShrink: 0, width: isMobile ? '32px' : '26px', height: '100%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent',
                color: isCopied ? (ui.green || '#a6e3a1') : ui.subtext,
                border: 'none', cursor: 'pointer', padding: 0,
                transition: 'color 120ms',
              }}
              onMouseEnter={(e) => { if (!isCopied) e.currentTarget.style.color = ui.text; }}
              onMouseLeave={(e) => { if (!isCopied) e.currentTarget.style.color = ui.subtext; }}
            >
              {isCopied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={2} />}
            </button>
          </div>
        );
      })}
      {items.length > 0 && hasMore && (
        <div ref={sentinelRef} style={{
          padding: '8px 0', display: 'flex', justifyContent: 'center',
          fontSize: '10px', color: ui.subtext, opacity: 0.7,
        }}>
          {loadingMore ? (t?.('loading') || 'Loading…') : '·'}
        </div>
      )}
      {items.length > 0 && !hasMore && !loading && (
        <div style={{
          padding: '8px 0', display: 'flex', justifyContent: 'center',
          fontSize: '10px', color: ui.subtext, opacity: 0.55,
          letterSpacing: '0.05em',
        }}>
          {t?.('historyEnd') || 'End of history'}
        </div>
      )}
    </div>
  );
};

const CommandHistoryPopover = ({ anchor, terminalKey, sessions = [], ui, isMobile = false, onClose, onSelect, t }) => {
  const ref = useRef(null);
  const listRef = useRef(null);
  const sentinelRef = useRef(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });
  const [measured, setMeasured] = useState(false);
  // "비우기" 확정 단계 — 휴지통 한 번 누르면 inline 확인 영역이 popover 안에 오버레이.
  // 외부 confirm() 다이얼로그는 popover 컨텍스트를 끊고 모바일 UX 가 어색해서 안 쓴다.
  const [confirmingClear, setConfirmingClear] = useState(false);
  // 세션 픽커 — popover 가 unmount 되면(닫히면) mode 도 초기 상태로 돌아간다.
  const [mode, setMode] = useState(MODE_HISTORY);
  const [selected, setSelected] = useState(null);
  const [copiedText, setCopiedText] = useState(null);
  const copyTimerRef = useRef(null);
  // push compose — 고른 세션으로 보낼 새 명령.
  // 상태를 boolean 플래시가 아니라 4단계로 두는 이유: **실패를 성공처럼 보여주면 안 된다.**
  const [pushText, setPushText] = useState('');
  const [pushState, setPushState] = useState(PUSH_IDLE);
  const [pushError, setPushError] = useState('');
  const pushFlashTimerRef = useRef(null);
  // 세션 행 식별 힌트 — 라벨 중복 행은 #순번 으로 항상 구분되고, 로컬 세션은 실제 tmux cwd
  // 를 배치 API 로 1회 fetch 해 경로를 덧붙인다(App 탭 상태의 pane.cwd 는 비어 있을 때가 많다).
  const [cwdHints, setCwdHints] = useState({});
  const cwdHintsFetchedRef = useRef(false);
  const { items, hasMore, loading, loadingMore, loadMore } = useCommandHistory(terminalKey);

  useDismissOnOutside(ref, onClose);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    if (pushFlashTimerRef.current) clearTimeout(pushFlashTimerRef.current);
  }, []);

  // 위치는 anchor 가 바뀔 때만 다시 잰다 — 모드 전환/목록 로딩으로 프레임이 재측정·재이동
  // 되면 내용이 갈리듯 보인다. 콘텐츠는 프레임 안에서 교체된다(measured 는 명시적 state).
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let nextX = anchor.x - rect.width;
    let nextY = anchor.y;
    if (nextX < margin) nextX = margin;
    if (nextX + rect.width > window.innerWidth - margin) {
      nextX = window.innerWidth - rect.width - margin;
    }
    if (nextY + rect.height > window.innerHeight - margin) {
      nextY = window.innerHeight - rect.height - margin;
    }
    if (nextY < margin) nextY = margin;
    setPos({ x: nextX, y: nextY });
    setMeasured(true);
  }, [anchor.x, anchor.y]);

  // 인피니티 스크롤 — 리스트 끝 sentinel 이 viewport 안에 들어오면 다음 페이지 fetch.
  // IntersectionObserver root 를 listRef (스크롤 컨테이너) 로 지정해 popover 안에서만 trigger.
  useEffect(() => {
    if (!sentinelRef.current || !listRef.current) return undefined;
    if (!hasMore) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { root: listRef.current, rootMargin: '60px 0px' });
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  const enterPicker = () => {
    setMode(MODE_SESSIONS);
    setConfirmingClear(false);
    // cwd 힌트는 popover 라이프사이클당 1회. 실패해도 힌트 없는 라벨만 표시되는 조용한 강등.
    if (!cwdHintsFetchedRef.current) {
      cwdHintsFetchedRef.current = true;
      fetchPaneCwdHints(sessions)
        .then((hints) => { if (hints && Object.keys(hints).length > 0) setCwdHints(hints); })
        .catch(() => { /* 배치 cwd 조회 실패 — #순번 힌트만으로 동작한다 */ });
    }
  };

  const handleCopyRow = async (text) => {
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopiedText(text);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedText(null), 1200);
  };

  /* compose 행: 입력한 **새** 명령을 고른 세션(다른 터미널)으로 push.
   *
   * **백엔드(`/api/itl/send`)를 지난다. 이 브라우저의 WebSocket 으로 보내지 않는다.**
   * 예전엔 `window.terminalSessions[key]` 로 직접 밀어넣었는데, 그 경로는 대상 pane 이
   * 지금 이 브라우저에 붙어 있어야만 동작한다:
   *   - 모바일에서 아직 안 본 pane 은 아예 붙지 않는다(`skipInitialConnect`),
   *   - 안 보이는 pane 의 소켓은 60초 뒤 닫힌다(`INACTIVE_PANE_GRACE_MS`),
   *   - 그리고 닫힌 소켓에 넣은 입력은 큐에서 4초 뒤 버려진다(`STALE_INPUT_MS`).
   * 즉 "보냈다" 는 초록 표시만 뜨고 명령은 조용히 사라졌다. 백엔드는 tmux 에 직접 넣으므로
   * 붙어 있지 않아도 도달하고, 무엇보다 **도달했는지를 알려준다**(delivered/skipped).
   */
  const submitPush = async () => {
    const text = pushText.trim();
    if (!text || !selected || pushState === PUSH_SENDING) return;
    // 주소는 신원(세션 ID / 원격 tmux 세션명)이 먼저다 — 번호는 pane 이 닫히면 밀린다.
    const to = selected.sessionKey || selected.address;
    const flash = (state, message = '') => {
      setPushState(state);
      setPushError(message);
      if (pushFlashTimerRef.current) clearTimeout(pushFlashTimerRef.current);
      pushFlashTimerRef.current = setTimeout(() => {
        setPushState(PUSH_IDLE);
        setPushError('');
      }, state === PUSH_FAIL ? 4000 : 900);
    };
    if (!to) {
      flash(PUSH_FAIL, t?.('pickerPushNoTarget') || 'No address for this session');
      return;
    }
    setPushState(PUSH_SENDING);
    setPushError('');
    try {
      const res = await apiFetch('/api/itl/send', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        // origin=false — 사람이 특정 터미널을 골라 친 명령이다. `[from …]` 꼬리표는
        // 에이전트끼리 헤매지 않게 하는 장치이고, 여기서는 그 자리에 노이즈다.
        body: JSON.stringify({ to, text, submit: true, origin: false }),
        timeoutMs: PUSH_TIMEOUT_MS,
      });
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (!res.ok) {
        flash(PUSH_FAIL, `${t?.('pickerPushFailed') || 'Send failed'} (${res.status})`);
        return;
      }
      if (!data?.delivered?.length) {
        const reason = data?.skipped?.[0]?.reason;
        flash(PUSH_FAIL, pushSkipLabel(reason, t));
        return;                                   // 입력은 지우지 않는다 — 다시 시도할 것이다
      }
      setPushText('');
      flash(PUSH_OK);
    } catch (e) {
      flash(PUSH_FAIL, e?.message || (t?.('pickerPushFailed') || 'Send failed'));
    }
  };

  const rowHeight = isMobile ? '34px' : '30px';

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        ...glassMenuStyle(ui),
        zIndex: 200000,
        // 콘텐츠 길이와 무관하게 일관된 폭 — 짧은 명령으로 줄어들거나 긴 명령으로 350px 까지
        // 늘어나는 일이 없게 고정. 두 줄까지는 wrap 허용.
        width: isMobile ? '260px' : '320px',
        maxHeight: '320px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: font.sans,
        opacity: measured ? 1 : 0,
        transform: measured ? 'translateY(0)' : 'translateY(-4px)',
        transition: 'opacity 140ms ease, transform 140ms ease',
      }}
    >
      <style>{`
        @keyframes iterm-cmd-history-item-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .iterm-cmd-history-list::-webkit-scrollbar { width: 6px; }
        .iterm-cmd-history-list::-webkit-scrollbar-thumb {
          background: ${ui.surface1 || '#45475a'};
          border-radius: 3px;
        }
        .iterm-cmd-history-list { scrollbar-width: thin; }
        .iterm-cmd-history-item { animation: iterm-cmd-history-item-in 200ms ease both; }
      `}</style>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        borderBottom: `1px solid color-mix(in srgb, ${ui.border} 65%, transparent)`,
        background: `color-mix(in srgb, ${ui.base} var(--glass-fill, 38%), transparent)`,
      }}>
        {mode === MODE_HISTORY ? (
          <>
            <span style={headerTitleStyle(ui)}>
              {t?.('historyTitle') || 'Recent commands'}
              {items.length > 0 && (
                <span style={{
                  fontSize: '10px',
                  padding: '1px 6px',
                  borderRadius: '8px',
                  background: `color-mix(in srgb, ${ui.accent} 20%, transparent)`,
                  color: ui.text,
                  letterSpacing: 'normal',
                  textTransform: 'none',
                }}>{items.length}{hasMore ? '+' : ''}</span>
              )}
            </span>
            <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
              {/* 세션 픽커 진입 — 다른 살아있는 세션이 있을 때만. */}
              {sessions.length > 0 && (
                <button
                  type="button"
                  onClick={enterPicker}
                  title={t?.('copyFromSession') || 'Copy a command from another session'}
                  aria-label={t?.('copyFromSession') || 'Copy a command from another session'}
                  style={headerIconBtnStyle(ui)}
                  onMouseEnter={(e) => { e.currentTarget.style.color = ui.text; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = ui.subtext; }}
                >
                  <ArrowLeftRight size={11} strokeWidth={2} />
                </button>
              )}
              {items.length > 0 && !confirmingClear && (
                <button
                  type="button"
                  onClick={() => setConfirmingClear(true)}
                  title={t?.('clearHistory') || 'Clear history'}
                  style={headerIconBtnStyle(ui)}
                  onMouseEnter={(e) => { e.currentTarget.style.color = ui.danger || '#f38ba8'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = ui.subtext; }}
                >
                  <Trash2 size={11} strokeWidth={2} />
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setMode(mode === MODE_COMMANDS ? MODE_SESSIONS : MODE_HISTORY)}
              title={t?.('pickerBackToSessions') || 'Back to sessions'}
              aria-label={t?.('pickerBackToSessions') || 'Back to sessions'}
              style={headerIconBtnStyle(ui)}
              onMouseEnter={(e) => { e.currentTarget.style.color = ui.text; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = ui.subtext; }}
            >
              <ChevronLeft size={13} strokeWidth={2} />
            </button>
            <span style={{ ...headerTitleStyle(ui), flex: 1 }}>
              {mode === MODE_SESSIONS ? (
                <>
                  {t?.('pickerSessionsTitle') || 'Pick a session'}
                  <span style={{
                    fontSize: '10px', padding: '1px 6px', borderRadius: '8px',
                    background: `color-mix(in srgb, ${ui.accent} 20%, transparent)`,
                    color: ui.text, letterSpacing: 'normal', textTransform: 'none',
                  }}>{sessions.length}</span>
                </>
              ) : (
                <>
                  {selected?.isLocal
                    ? <Monitor size={11} strokeWidth={2} />
                    : <Server size={11} strokeWidth={2} />}
                  <span style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textTransform: 'none', letterSpacing: 'normal',
                    color: ui.text,
                  }}>{selected?.label}</span>
                </>
              )}
            </span>
          </>
        )}
      </div>

      {/* Inline confirm bar — 휴지통 버튼 누르면 헤더 아래로 슬라이드해 들어온다. */}
      {mode === MODE_HISTORY && confirmingClear && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '8px',
          padding: '8px 10px',
          background: `color-mix(in srgb, ${ui.danger || '#f38ba8'} 14%, transparent)`,
          borderBottom: `1px solid color-mix(in srgb, ${ui.danger || '#f38ba8'} 32%, transparent)`,
          animation: 'iterm-cmd-history-item-in 160ms ease both',
        }}>
          <span style={{
            fontSize: fontSize['11'], color: ui.text, lineHeight: 1.4, flex: 1, minWidth: 0,
          }}>{t?.('confirmClearHistory') || 'Clear command history for this terminal?'}</span>
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              style={{
                padding: '4px 10px', borderRadius: '4px',
                background: 'transparent', border: `1px solid ${ui.border}`,
                color: ui.subtext, fontSize: fontSize['11'], cursor: 'pointer',
                fontFamily: 'inherit', transition: 'background 120ms, color 120ms',
              }}
              className="iterm-menu-item"
            >
              {t?.('cancel') || 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => { clearHistoryFor(terminalKey); setConfirmingClear(false); }}
              style={{
                padding: '4px 10px', borderRadius: '4px',
                background: ui.danger || '#f38ba8',
                color: ui.crust || '#11111b',
                border: '1px solid transparent',
                fontSize: fontSize['11'], fontWeight: fontWeight.semibold, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'opacity 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              {t?.('clearHistory') || 'Clear'}
            </button>
          </div>
        </div>
      )}

      {mode === MODE_HISTORY ? (
        <div ref={listRef} className="iterm-cmd-history-list" style={{
          flex: 1, overflowY: 'auto', padding: '4px',
          display: 'flex', flexDirection: 'column', gap: '2px',
        }}>
          {loading && items.length === 0 ? (
            // 첫 로딩 스켈레톤 — 빠른입력 패널과 동일한 카드 치수의 shimmer 블록.
            [0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{
                flexShrink: 0, height: '30px', borderRadius: '4px',
                width: `${92 - (i % 3) * 16}%`,
                background: `linear-gradient(90deg,
                  color-mix(in srgb, ${ui.surface1 || '#45475a'} 35%, transparent) 0%,
                  color-mix(in srgb, ${ui.accent || '#89b4fa'} 18%, transparent) 50%,
                  color-mix(in srgb, ${ui.surface1 || '#45475a'} 35%, transparent) 100%)`,
                backgroundSize: '300% 100%',
                animation: `iterm-skel-shimmer ${1.6 + i * 0.08}s ease-in-out infinite`,
                animationDelay: `${i * 80}ms`,
              }} />
            ))
          ) : items.length === 0 ? (
            <div style={{
              padding: '18px 12px', textAlign: 'center',
              fontSize: fontSize['12'], color: ui.subtext, opacity: 0.7,
            }}>
              {t?.('historyEmpty') || 'No history yet'}
            </div>
          ) : items.map((entry, idx) => (
            // 카드형 행 — 스켈레톤 블록과 동일한 높이/배경. 텍스트(클릭→재전송) + X(개별 삭제).
            <div
              key={`${entry.ts}-${idx}`}
              className="iterm-cmd-history-item"
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', height: '30px',
                background: `color-mix(in srgb, ${ui.surface1} var(--glass-fill, 32%), transparent)`,
                borderRadius: '4px', overflow: 'hidden',
                transition: 'background 120ms',
                animationDelay: idx < 12 ? `${idx * 18}ms` : '0ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${ui.surface1} 70%, transparent)`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${ui.surface1} var(--glass-fill, 32%), transparent)`; }}
            >
              <button
                type="button"
                onClick={() => onSelect?.(entry.text)}
                title={`${entry.text}\n— ${t?.('clickToResend') || 'click to re-send'}`}
                style={{
                  flex: 1, minWidth: 0, height: '100%', textAlign: 'left',
                  background: 'transparent', color: ui.text, border: 'none',
                  cursor: 'pointer', padding: '0 4px 0 9px',
                  fontFamily: font.mono, fontSize: fontSize['12'], lineHeight: '30px',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {entry.text}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeHistoryCommand(terminalKey, entry.text); }}
                title={t?.('remove') || 'Remove'}
                aria-label={t?.('remove') || 'Remove'}
                style={{
                  flexShrink: 0, width: '26px', height: '100%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent', color: ui.subtext,
                  border: 'none', cursor: 'pointer', padding: 0,
                  transition: 'color 120ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = ui.danger || '#f38ba8'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = ui.subtext; }}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          ))}
          {/* 인피니티 스크롤 sentinel — 화면에 닿으면 다음 페이지. hasMore=false 일 때는 비표시. */}
          {items.length > 0 && hasMore && (
            <div ref={sentinelRef} style={{
              padding: '8px 0', display: 'flex', justifyContent: 'center',
              fontSize: '10px', color: ui.subtext, opacity: 0.7,
            }}>
              {loadingMore ? (t?.('loading') || 'Loading…') : '·'}
            </div>
          )}
          {items.length > 0 && !hasMore && !loading && (
            <div style={{
              padding: '8px 0', display: 'flex', justifyContent: 'center',
              fontSize: '10px', color: ui.subtext, opacity: 0.55,
              letterSpacing: '0.05em',
            }}>
              {t?.('historyEnd') || 'End of history'}
            </div>
          )}
        </div>
      ) : mode === MODE_SESSIONS ? (
        <div className="iterm-cmd-history-list" style={{
          flex: 1, overflowY: 'auto', padding: '4px',
          display: 'flex', flexDirection: 'column', gap: '2px',
        }}>
          {sessions.length === 0 ? (
            <div style={{
              padding: '18px 12px', textAlign: 'center',
              fontSize: fontSize['12'], color: ui.subtext, opacity: 0.7,
            }}>
              {t?.('pickerNoSessions') || 'No other sessions'}
            </div>
          ) : sessions.map((session, idx) => (
            <button
              key={session.key}
              type="button"
              className="iterm-cmd-history-item"
              onClick={() => { setSelected(session); setMode(MODE_COMMANDS); }}
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px',
                height: rowHeight,
                background: `color-mix(in srgb, ${ui.surface1} var(--glass-fill, 32%), transparent)`,
                borderRadius: '4px', overflow: 'hidden',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                padding: '0 6px 0 9px',
                color: ui.text, fontFamily: font.sans, fontSize: fontSize['12'],
                transition: 'background 120ms',
                animationDelay: idx < 12 ? `${idx * 18}ms` : '0ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${ui.surface1} 70%, transparent)`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${ui.surface1} var(--glass-fill, 32%), transparent)`; }}
            >
              {session.isLocal
                ? <Monitor size={12} strokeWidth={2} style={{ flexShrink: 0, color: ui.subtext }} />
                : <Server size={12} strokeWidth={2} style={{ flexShrink: 0, color: ui.subtext }} />}
              {(session.address != null || (session.tabIndex != null && session.paneIndex != null)) && (
                <span
                  style={{
                    flexShrink: 0, color: ui.subtext,
                    fontSize: fontSize['10'], fontFamily: font.mono, opacity: 0.85,
                  }}
                >
                  #{session.address != null ? session.address : `${session.tabIndex}.${session.paneIndex}`}
                </span>
              )}
              <span style={{
                minWidth: 0, flex: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {session.label}
                {session.labelDuplicated && session.tabName && (
                  <span style={{ color: ui.subtext, fontSize: fontSize['10'] }}> · {session.tabName}</span>
                )}
                {session.labelDuplicated && cwdHints[session.key] && (
                  <span
                    title={cwdHints[session.key]}
                    style={{ color: ui.subtext, fontSize: fontSize['10'], fontFamily: font.mono }}
                  >
                    {' '}· {cwdHints[session.key].length > 28 ? `…${cwdHints[session.key].slice(-27)}` : cwdHints[session.key]}
                  </span>
                )}
              </span>
              <ChevronRight size={12} strokeWidth={2} style={{ flexShrink: 0, color: ui.subtext, opacity: 0.7 }} />
            </button>
          ))}
        </div>
      ) : (
        <>
          {/* push compose 행 — 여기서 입력한 명령은 **고른 세션**으로 간다(반대 방향).
              테두리·아이콘 색이 결과를 말한다: 초록=배달됨, 빨강=못 갔음(사유는 아래 줄). */}
          {(() => {
            const okColor = ui.green || '#a6e3a1';
            const failColor = ui.danger || '#f38ba8';
            const accentColor = pushState === PUSH_OK ? okColor
              : (pushState === PUSH_FAIL ? failColor : null);
            const busy = pushState === PUSH_SENDING;
            return (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: '4px',
                padding: '6px 6px',
                borderBottom: `1px solid color-mix(in srgb, ${ui.border} 45%, transparent)`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="text"
                    value={pushText}
                    onChange={(e) => setPushText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitPush(); } }}
                    placeholder={t?.('pickerPushPlaceholder') || 'Send a command to this session'}
                    aria-label={t?.('pickerPushPlaceholder') || 'Send a command to this session'}
                    style={{
                      flex: 1, minWidth: 0,
                      height: isMobile ? '30px' : '26px',
                      padding: '0 8px', borderRadius: '4px',
                      background: `color-mix(in srgb, ${ui.surface1} var(--glass-fill, 32%), transparent)`,
                      border: `1px solid ${accentColor
                        || `color-mix(in srgb, ${ui.border} 45%, transparent)`}`,
                      color: ui.text, fontFamily: font.mono, fontSize: fontSize['12'],
                      outline: 'none',
                      transition: 'border-color 250ms',
                    }}
                  />
                  <button
                    type="button"
                    onClick={submitPush}
                    disabled={busy}
                    title={t?.('pickerSendToSession') || 'Send to this session'}
                    aria-label={t?.('pickerSendToSession') || 'Send to this session'}
                    style={{
                      flexShrink: 0,
                      width: isMobile ? '30px' : '26px',
                      height: isMobile ? '30px' : '26px',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: `color-mix(in srgb, ${ui.accent} ${accentColor ? '45' : '18'}%, transparent)`,
                      border: 'none', borderRadius: '4px',
                      color: accentColor || ui.subtext,
                      cursor: busy ? 'default' : 'pointer', padding: 0,
                      opacity: busy ? 0.6 : 1,
                      transition: 'background 250ms, color 250ms, opacity 120ms',
                    }}
                    onMouseEnter={(e) => { if (!accentColor && !busy) e.currentTarget.style.color = ui.text; }}
                    onMouseLeave={(e) => { if (!accentColor && !busy) e.currentTarget.style.color = ui.subtext; }}
                  >
                    <CornerDownLeft size={12} strokeWidth={2} />
                  </button>
                </div>
                {/* 실패는 말로 알려준다 — 색만 바뀌면 무엇이 잘못됐는지 알 수 없다. */}
                {pushState === PUSH_FAIL && pushError && (
                  <div role="alert" style={{
                    fontSize: fontSize['10'], color: failColor,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {pushError}
                  </div>
                )}
              </div>
            );
          })()}
          <OtherSessionCommandList
            key={selected?.key}
            sessionKey={selected?.key}
            ui={ui}
            isMobile={isMobile}
            onSelect={onSelect}
            onPickCopy={handleCopyRow}
            copiedText={copiedText}
            t={t}
          />
        </>
      )}
    </div>
  );
};


export { RailSubMenu, MenuBtn, CommandHistoryPopover };
