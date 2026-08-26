import { useEffect, useRef, useState } from 'react';
import { MessageSquare, ClipboardPaste, Copy, FileText } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import { tokens } from '../styles/tokens';
import { DEFAULT_MOBILE_KEYS, sanitizeMobileKeys, splitPinnedAndScroll } from '../utils/mobileKeys';
import { DOCK_SLOT_ID } from './commandinput/focusDock';
import HostIcon from '../utils/hostIcons';
import { createKeyRepeater } from '../utils/keyRepeat';

/* kind 별 기본 아이콘 — 키에 명시적 icon 이 없으면 fallback. */
const DEFAULT_ICON_FOR_KIND = {
  cmdInput: MessageSquare,
  paste: ClipboardPaste,
  copy: Copy,
  copyAll: FileText,
};

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

/**
 * 모바일 (iOS) 전용 고밀도 키 툴바.
 *
 * 키 셋은 settings.mobileKeys 에서 동적으로 읽음 — 사용자가 Settings 에서
 * 자유롭게 추가/삭제/순서 변경. 디폴트는 DEFAULT_MOBILE_KEYS.
 *
 * 위치 전략: App.jsx wrapper 의 flex flow 마지막 child. 키보드 올라오면
 * wrapper 가 줄고 toolbar 도 자연스럽게 따라 올라감.
 */
const SYNTHETIC_MOUSE_GRACE_MS = 700;

// 스켈레톤은 **실제 키와 같은 크기**로 그린다. minWidth 로만 그리면 로딩이 끝나는 순간
// 'ESC'·'Shift+Tab' 처럼 긴 키가 늘어나며 줄 전체가 출렁인다.
const SKELETON_CHAR_PX = 6.2;   // fontSize 11 sans 의 대략적인 글자 폭
const skeletonKeyLabel = (k) => (
  k.label || (k.kind === 'mod' ? (k.modifier || 'ctrl').toUpperCase() : '')
);
const skeletonKeyBox = (k) => {
  const label = skeletonKeyLabel(k);
  const iconPx = k.icon ? 18 : 0;   // 아이콘(14) + 라벨과의 gap(4)
  return { width: `${Math.round(10 + iconPx + label.length * SKELETON_CHAR_PX)}px` };
};

const MobileToolbar = ({
  onSendKey, onOpenCommandInput, onAction, language = 'en', keys = null, terminalSessionId = null,
  /* 키가 아닌 고정 항목(대상 선택·히스토리 토글). 입력 도크가 넘겨준다 —
     도크에 두면 도크가 두 줄이 되고, 여기 두면 전체가 키바+입력 두 줄로 끝난다. */
  leading = null,
}) => {
  const { t } = useTranslation(language);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const scrollRef = useRef(null);
  const [terminalReady, setTerminalReady] = useState(false);
  // 길게 누르기 반복 — 반복 발사는 modifier 를 다시 소모하지 않게 onSendKey 로 직행한다
  // (^ 조합은 첫 발에서 이미 소비됐다). 최신 콜백을 보게 ref 경유.
  const onSendKeyRef = useRef(onSendKey);
  onSendKeyRef.current = onSendKey;
  const repeaterRef = useRef(null);
  if (!repeaterRef.current) {
    repeaterRef.current = createKeyRepeater({ onFire: (payload) => onSendKeyRef.current?.(payload) });
  }
  // 터치로 이미 쏜 뒤 따라오는 합성 mousedown 을 흘려보내는 시각.
  const touchFiredAtRef = useRef(0);
  useEffect(() => () => repeaterRef.current?.stop(), []);

  useEffect(() => {
    if (!terminalSessionId) { setTerminalReady(false); return undefined; }
    const check = () => {
      const session = window.terminalSessions?.[terminalSessionId];
      if (session) { setTerminalReady(true); return true; }
      return false;
    };
    if (check()) return undefined;
    setTerminalReady(false);
    const id = setInterval(() => { if (check()) clearInterval(id); }, 200);
    return () => clearInterval(id);
  }, [terminalSessionId]);

  // CommandInput 은 App.jsx 에서 lazy() 로 분리돼 있다. 모바일 진입 시점에 미리 prefetch 해 둬야
  // 사용자가 cmdInput 버튼을 처음 누를 때 Suspense fallback (null) 으로 잠시 비었다가 mount 되는
  // 비동기 갭이 없어진다. 이 갭 동안 user gesture 컨텍스트가 끊겨 iOS 키보드가 안 따라옴.
  useEffect(() => {
    import('./CommandInput').catch(() => { /* offline 등 — 첫 클릭 때 다시 시도 */ });
  }, []);

  const list = sanitizeMobileKeys(keys ?? DEFAULT_MOBILE_KEYS);
  // 빠른입력(⌘)은 스크롤 밖 좌측에 고정한다 — 키를 옆으로 밀다 보면 정작 제일 자주 쓰는
  // 버튼이 화면 밖으로 사라진다. 나머지 키만 가로 스크롤 영역에 남긴다.
  // 고정 영역 바로 뒤가 구분자면 그 구분자도 함께 고정(splitPinnedAndScroll 참조).
  const { pinnedKey, pinnedDivider, scrollKeys } = splitPinnedAndScroll(list);

  const sendWithModifiers = (key) => {
    let finalKey = key;
    if (ctrlActive) {
      // Ctrl+letter — control char 매핑
      if (key.length === 1 && key >= 'a' && key <= 'z') {
        finalKey = String.fromCharCode(key.charCodeAt(0) - 96);
      } else if (key === '[' || key === ']' || key === '\\') {
        finalKey = String.fromCharCode(key.charCodeAt(0) - 64);
      }
      setCtrlActive(false);
    }
    if (altActive) {
      finalKey = '\x1b' + finalKey;
      setAltActive(false);
    }
    onSendKey?.(finalKey);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onSendKey?.(text);
    } catch {
      const text = prompt(t('paste') || 'Paste:');
      if (text) onSendKey?.(text);
    }
  };

  /* 한 키의 표시 콘텐츠 — icon (k.icon → HostIcon, 없으면 kind 기본 아이콘) + label.
     둘 다 있으면 함께 표시 (icon 좌, label 우, gap 4). 둘 다 없으면 send 는 '?', mod 는 modifier 대문자. */
  const renderKeyContent = (k) => {
    const FallbackIcon = DEFAULT_ICON_FOR_KIND[k.kind] || null;
    const iconEl = k.icon
      ? <HostIcon value={k.icon} size={14} strokeWidth={2.2} />
      : (FallbackIcon ? <FallbackIcon size={14} strokeWidth={2.2} /> : null);
    let labelText = k.label || '';
    if (!iconEl && !labelText) {
      if (k.kind === 'mod') labelText = (k.modifier || 'ctrl').toUpperCase();
      else if (k.kind === 'send') labelText = '?';
    }
    if (iconEl && labelText) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {iconEl}
          <span>{labelText}</span>
        </span>
      );
    }
    return iconEl || (labelText ? <span>{labelText}</span> : null);
  };

  const renderItem = (k, idx) => {
    if (k.kind === 'sep') return <Divider key={k.id || `sep-${idx}`} />;

    if (k.kind === 'copy' || k.kind === 'copyAll') {
      return (
        <Key key={k.id} tone={k.tone} title={t(k.kind)} onClick={() => onAction?.(k.kind)}>
          {renderKeyContent(k)}
        </Key>
      );
    }

    if (k.kind === 'cmdInput') {
      return (
        <Key
          key={k.id}
          tone={k.tone || 'accent'}
          title={t('commandInput')}
          // mousedown 에서 preventDefault — 버튼이 focus 를 뺏지 않게 한다.
          // 안 그러면 xterm hidden textarea 가 blur 되며 iOS 키보드가 내려가고,
          // 그 뒤에 lazy-load 된 CommandInput textarea 의 .focus() 가 user gesture
          // 컨텍스트 밖에서 호출돼 키보드가 다시 안 올라옴.
          // (기존 send 키들도 같은 패턴으로 focus 안 뺏음.)
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onOpenCommandInput?.()}
        >
          {renderKeyContent(k)}
        </Key>
      );
    }

    if (k.kind === 'paste') {
      return (
        <Key
          key={k.id}
          tone={k.tone}
          title={t('paste')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handlePaste}
        >
          {renderKeyContent(k)}
        </Key>
      );
    }

    if (k.kind === 'mod') {
      const isActive = (k.modifier === 'ctrl' && ctrlActive) || (k.modifier === 'alt' && altActive);
      const toggle = () => {
        if (k.modifier === 'ctrl') setCtrlActive((v) => !v);
        else if (k.modifier === 'alt') setAltActive((v) => !v);
      };
      return (
        <Key key={k.id} tone={k.tone} active={isActive} onClick={toggle}>
          {renderKeyContent(k)}
        </Key>
      );
    }

    // kind === 'send'
    // iOS 는 손가락을 떼야 합성 mousedown 을 보내므로, 길게 누르기 반복은 반드시 터치
    // 이벤트로 만들어야 한다. touchstart 에서 즉시 1회 발사하고 타이머로 반복하며,
    // 그 뒤 따라오는 합성 mousedown 은 flag 로 흘려보낸다(두 번 입력 방지).
    const payload = k.payload || '';
    return (
      <Key
        key={k.id}
        tone={k.tone}
        onTouchStart={() => {
          touchFiredAtRef.current = Date.now();
          sendWithModifiers(payload);
          repeaterRef.current?.start(payload);
        }}
        // 손가락이 움직이면 툴바를 가로 스크롤하려는 것 — 반복을 끊는다.
        onTouchMove={() => repeaterRef.current?.stop()}
        onTouchEnd={() => repeaterRef.current?.stop()}
        onTouchCancel={() => repeaterRef.current?.stop()}
        onMouseDown={(e) => {
          e.preventDefault();
          // 방금 터치로 이미 쏜 키의 합성 이벤트면 무시.
          if (Date.now() - touchFiredAtRef.current < SYNTHETIC_MOUSE_GRACE_MS) return;
          sendWithModifiers(payload);
          repeaterRef.current?.start(payload);
        }}
        onMouseUp={() => repeaterRef.current?.stop()}
        onMouseLeave={() => repeaterRef.current?.stop()}
      >
        {renderKeyContent(k)}
      </Key>
    );
  };

  return (
    <>
      <style>{`
        .mobile-toolbar-scroll {
          scrollbar-width: none;        /* 사용자 요청 — 단축키 영역 스크롤바 숨김 */
          -ms-overflow-style: none;
        }
        .mobile-toolbar-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; }
        @keyframes skel-pulse {
          0%, 100% { opacity: 0.42; }
          50% { opacity: 0.9; }
        }
        .mt-key:active {
          background: ${color.surface1} !important;
          transform: translateY(0.5px);
        }
        .mt-key.is-toggle-active {
          background: ${color.accentSubtle} !important;
          color: ${color.accent} !important;
          border-color: ${color.accentBorder} !important;
        }
      `}</style>

      <div style={styles.toolbar}>
        {/* 고정 슬롯 — 대상 선택·히스토리처럼 **키가 아닌 것**이 여기 온다.
            빠른입력 버튼이 빠지면서 이 자리가 비었고, 입력 도크에 두면 도크가 두 줄이 된다.
            여기 올리면 도크는 한 줄로 끝나고 전체는 키바+입력 두 줄이 된다. */}
        <div style={styles.pinned}>
          {/* 입력 도크가 여기로 포탈한다(대상 선택·히스토리). 비어 있으면 폭 0 이라
              데스크탑이나 도크가 없는 상태에서 자리를 먹지 않는다. */}
          <div id={DOCK_SLOT_ID} style={styles.dockSlot} />
          {leading}
          {pinnedKey && renderItem(pinnedKey, 'pinned')}
          <Divider />
        </div>
        <div ref={scrollRef} className="mobile-toolbar-scroll" style={styles.scroll}>
          <div style={styles.row}>
            {!terminalReady && terminalSessionId ? (
              scrollKeys.map((k, i) => {
                if (k.kind === 'cmdInput') return renderItem(k, i);
                // 구분자는 키가 아니라 선이다 — 키 크기로 그리면 로딩 중에만 굵은 막대가 선다.
                if (k.kind === 'sep') {
                  return (
                    <div key={i} style={{
                      ...styles.divider,
                      animation: 'skel-pulse 1.4s ease-in-out infinite',
                      animationDelay: `${i * 80}ms`,
                    }} />
                  );
                }
                return (
                  <div key={i} style={{
                    ...styles.key,
                    ...skeletonKeyBox(k),
                    background: color.surface0,
                    animation: 'skel-pulse 1.4s ease-in-out infinite',
                    animationDelay: `${i * 80}ms`,
                    border: `1px solid ${color.border}`,
                    margin: 0,
                  }} />
                );
              })
            ) : (
              scrollKeys.map(renderItem)
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// 나머지 핸들러(onTouch*/onMouseUp/onMouseLeave)는 rest 로 그대로 넘긴다 — 길게 누르기
// 반복이 여기 붙는다. 명시 나열로 두면 새 핸들러를 추가할 때마다 조용히 누락된다.
const Key = ({ children, onClick, onMouseDown, active, tone, title, ...rest }) => {
  const palette =
    tone === 'danger'
      ? { background: 'transparent', col: color.danger, border: `${color.danger}33` }
      : tone === 'accent'
        ? { background: color.accentSubtle, col: color.accent, border: color.accentBorder }
        : { background: color.surface0, col: color.text, border: color.border };

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={onMouseDown}
      {...rest}
      className={`mt-key ${active ? 'is-toggle-active' : ''}`}
      style={{
        ...styles.key,
        background: palette.background,
        color: palette.col,
        borderColor: palette.border,
        opacity: tone === 'muted' ? 0.65 : 1,
      }}
    >
      {children}
    </button>
  );
};

const Divider = () => <div style={styles.divider} />;

const styles = {
  toolbar: {
    flexShrink: 0,
    width: '100%',
    // 28 → 34px. 키(24px)와 함께 올리되 위아래 5px 씩은 남긴다 — 키가 바 가장자리에
    // 붙으면 답답하다. 여백(5px)은 종전과 동일, 비율은 더 좋아진다.
    height: 'calc(34px + env(safe-area-inset-bottom, 0px))',
    paddingBottom: 'env(safe-area-inset-bottom, 2px)',
    display: 'flex',
    alignItems: 'center',
    background: color.mantle,
    borderTop: `1px solid ${color.border}`,
    fontFamily: font.sans,
    zIndex: 10,
  },
  // 좌측 고정 슬롯 — 좌우 패딩은 최소로(스크롤 영역과 붙지 않을 만큼만).
  dockSlot: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
  },
  pinned: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    paddingLeft: space['1'],
    paddingRight: space['0.5'],
  },
  scroll: {
    flex: 1,
    height: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    WebkitOverflowScrolling: 'touch',
    padding: `0 ${space['2']}`,
    display: 'flex',
    alignItems: 'center',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    // 키가 작아진 만큼 사이는 오히려 벌린다(4 → 8px) — 안 그러면 다닥다닥 붙어 보인다.
    gap: space['2'],
    paddingRight: space['5'],
  },
  key: {
    flexShrink: 0,
    height: '24px',
    minWidth: '24px',
    padding: '0 5px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid',
    borderRadius: radius.xs,
    fontSize: fontSize['11'],
    fontWeight: fontWeight.medium,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: `background ${motion.fast}, border-color ${motion.fast}, color ${motion.fast}`,
    outline: 'none',
    WebkitTapHighlightColor: 'transparent',
    whiteSpace: 'nowrap',
  },
  divider: {
    width: '1px',
    height: '14px',
    background: color.border,
    // 자체 마진 없음 — row 의 gap(8px)만 받는다. 마진을 더하면 구분자 주변만 뻥 뚫려
    // 그룹 사이가 아니라 "빈칸"으로 보인다.
    margin: 0,
    flexShrink: 0,
  },
};

export default MobileToolbar;
