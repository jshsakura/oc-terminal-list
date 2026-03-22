/**
 * MobileToolbar 컴포넌트
 * 모바일(iOS)에서 ESC, Tab, 방향키 등 특수키 입력 지원
 * 고도로 세련된 Glassmorphism 및 모던 IDE UI 적용
 */
import { useRef, useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ClipboardPaste, Eraser, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react';
import useVisualViewport from '../hooks/useVisualViewport';
import useTranslation from '../hooks/useTranslation';
import Button from './common/Button';

const MobileToolbar = ({ onSendKey, isVisible, onClose, activeSessionId, onOpenCommandInput, language = 'en', theme }) => {
  const { t } = useTranslation(language);
  const toolbarRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);

  // Ctrl, Alt 토글 상태 관리
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  // Visual Viewport로 키보드 위에 툴바 고정
  useVisualViewport(toolbarRef);

  const currentTheme = theme || {
    ui: {
      bg: '#1e1e2e',
      bgSecondary: '#181825',
      bgTertiary: '#313244',
      accent: '#89b4fa',
      radiusSmall: '2px',
      borderLight: 'rgba(255,255,255,0.1)',
    },
    yellow: '#f9e2af',
    red: '#f38ba8',
  };

  // 키 전송 로직
  const handleKeyWithModifiers = (key) => {
    let finalKey = key;
    if (ctrlActive) {
      if (key.length === 1 && key >= 'a' && key <= 'z') {
        finalKey = String.fromCharCode(key.charCodeAt(0) - 96);
      } else if (key.length === 1 && key >= 'A' && key <= 'Z') {
        finalKey = String.fromCharCode(key.charCodeAt(0) - 64);
      }
      setCtrlActive(false);
    }
    if (altActive) {
      finalKey = '\x1b' + finalKey;
      setAltActive(false);
    }
    onSendKey(finalKey);
  };

  // 스크롤 위치 체크
  const checkScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setShowLeftScroll(scrollLeft > 5);
    setShowRightScroll(scrollLeft < scrollWidth - clientWidth - 5);
  };

  useEffect(() => {
    checkScroll();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScroll);
      return () => container.removeEventListener('scroll', checkScroll);
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setTimeout(checkScroll, 100);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleScrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -120, behavior: 'smooth' });
    }
  };

  const handleScrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 120, behavior: 'smooth' });
    }
  };

  if (!isVisible) return null;

  return (
    <>
      <style>{`
        .mobile-toolbar-scroll::-webkit-scrollbar {
          display: none;
        }
        .mobile-btn-active {
          box-shadow: inset 0 0 10px rgba(0,0,0,0.3), 0 0 15px rgba(249, 226, 175, 0.4);
        }
      `}</style>
      <div
        ref={toolbarRef}
        style={{
          ...styles.toolbar,
          backgroundColor: 'rgba(24, 24, 37, 0.75)',
          backdropFilter: 'blur(25px) saturate(180%)',
          transform: isVisible ? 'translateY(0)' : 'translateY(100%)',
          opacity: isVisible ? 1 : 0,
          borderTop: `1px solid ${currentTheme.ui.borderLight}`,
        }}
      >
        {/* 스크롤 가이드 (그라데이션 효과) */}
        {showLeftScroll && <div style={{ ...styles.edgeFade, left: 0, background: 'linear-gradient(to right, rgba(24,24,37,0.9), transparent)' }} />}
        {showRightScroll && <div style={{ ...styles.edgeFade, right: 0, background: 'linear-gradient(to left, rgba(24,24,37,0.9), transparent)' }} />}

        <div
          ref={scrollContainerRef}
          className="mobile-toolbar-scroll"
          style={styles.scrollContainer}
          onScroll={checkScroll}
        >
          <div style={styles.buttonGroup}>
            {/* Ctrl Toggle */}
            <button 
              onClick={() => setCtrlActive(!ctrlActive)} 
              className={ctrlActive ? 'mobile-btn-active' : ''}
              style={{
                ...styles.premiumBtn,
                backgroundColor: ctrlActive ? currentTheme.yellow : 'rgba(255,255,255,0.05)',
                color: ctrlActive ? '#11111b' : currentTheme.ui.text,
                fontWeight: '800',
                borderColor: ctrlActive ? currentTheme.yellow : 'rgba(255,255,255,0.1)',
              }}
            >
              CTRL
            </button>

            {/* Alt Toggle */}
            <button 
              onClick={() => setAltActive(!altActive)} 
              className={altActive ? 'mobile-btn-active' : ''}
              style={{
                ...styles.premiumBtn,
                backgroundColor: altActive ? currentTheme.yellow : 'rgba(255,255,255,0.05)',
                color: altActive ? '#11111b' : currentTheme.ui.text,
                fontWeight: '800',
                borderColor: altActive ? currentTheme.yellow : 'rgba(255,255,255,0.1)',
              }}
            >
              ALT
            </button>

            <div style={styles.divider} />

            {/* Command Input */}
            <button 
              onClick={() => onOpenCommandInput?.()} 
              style={{...styles.premiumBtn, backgroundColor: 'rgba(137, 180, 250, 0.15)', color: currentTheme.ui.accent, borderColor: 'rgba(137, 180, 250, 0.3)'}}
            >
              <MessageSquare size={16} strokeWidth={2.5} />
            </button>

            {/* ESC */}
            <button onClick={() => handleKeyWithModifiers('\x1b')} style={styles.premiumBtn}>ESC</button>
            
            {/* TAB */}
            <button onClick={() => handleKeyWithModifiers('\t')} style={styles.premiumBtn}>TAB</button>

            {/* ^C */}
            <button 
              onClick={() => onSendKey('\x03')} 
              style={{...styles.premiumBtn, color: currentTheme.red, borderColor: 'rgba(243, 139, 168, 0.3)', backgroundColor: 'rgba(243, 139, 168, 0.1)'}}
            >
              ^C
            </button>

            <div style={styles.divider} />

            {/* Arrow Keys */}
            <button onClick={() => handleKeyWithModifiers('\x1b[A')} style={styles.premiumBtn}><ArrowUp size={16} /></button>
            <button onClick={() => handleKeyWithModifiers('\x1b[B')} style={styles.premiumBtn}><ArrowDown size={16} /></button>
            <button onClick={() => handleKeyWithModifiers('\x1b[D')} style={styles.premiumBtn}><ArrowLeft size={16} /></button>
            <button onClick={() => handleKeyWithModifiers('\x1b[C')} style={styles.premiumBtn}><ArrowRight size={16} /></button>

            <div style={styles.divider} />

            {/* Functions */}
            <button 
              onClick={() => {
                const text = prompt('Paste:');
                if (text) onSendKey(text);
              }} 
              style={styles.premiumBtn}
            >
              <ClipboardPaste size={16} />
            </button>
            
            <button 
              onClick={() => onSendKey('\x15')} 
              style={{...styles.premiumBtn, opacity: 0.7}}
            >
              <Eraser size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

const styles = {
  toolbar: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    height: '54px',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    boxShadow: '0 -10px 30px rgba(0,0,0,0.4)',
    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
  },
  scrollContainer: {
    flex: 1,
    height: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    WebkitOverflowScrolling: 'touch',
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
  },
  buttonGroup: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingRight: '20px',
  },
  premiumBtn: {
    flexShrink: 0,
    height: '36px',
    minWidth: '40px',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '6px', // 모바일 터치감을 위해 살짝 둥글게 (현대적 느낌)
    color: '#cdd6f4',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.1s ease',
    outline: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
  divider: {
    width: '1px',
    height: '24px',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    margin: '0 4px',
    flexShrink: 0,
  },
  edgeFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '40px',
    zIndex: 2,
    pointerEvents: 'none',
  }
};

export default MobileToolbar;
