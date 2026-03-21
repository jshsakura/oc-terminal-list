/**
 * MobileToolbar 컴포넌트
 * 모바일(iOS)에서 ESC, Tab, 방향키 등 특수키 입력 지원
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
    },
    yellow: '#f9e2af',
    red: '#f38ba8',
  };

  // 키 전송 로직 개선 (Ctrl/Alt 조합 지원)
  const handleKeyWithModifiers = (key) => {
    let finalKey = key;

    // Ctrl 조합 처리
    if (ctrlActive) {
      if (key.length === 1 && key >= 'a' && key <= 'z') {
        finalKey = String.fromCharCode(key.charCodeAt(0) - 96);
      } else if (key.length === 1 && key >= 'A' && key <= 'Z') {
        finalKey = String.fromCharCode(key.charCodeAt(0) - 64);
      }
      setCtrlActive(false);
    }

    // Alt 조합 처리 (ESC + key)
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
    setShowLeftScroll(scrollLeft > 10);
    setShowRightScroll(scrollLeft < scrollWidth - clientWidth - 10);
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
    const handleResize = () => checkScroll();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleScrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -150, behavior: 'smooth' });
    }
  };

  const handleScrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 150, behavior: 'smooth' });
    }
  };

  const handlePaste = () => {
    const text = prompt('Paste text here:');
    if (text && onSendKey) {
      onSendKey(text);
    }
  };

  const handleClear = () => {
    if (onSendKey) {
      onSendKey('\x15'); // Ctrl+U
    }
  };

  if (!isVisible) return null;

  return (
    <>
      <style>{`
        .mobile-toolbar-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div
        ref={toolbarRef}
        style={{
          ...styles.toolbar,
          backgroundColor: currentTheme.ui.glassBg || 'rgba(24, 24, 37, 0.8)',
          transform: isVisible ? 'translateY(0)' : 'translateY(100%)',
          opacity: isVisible ? 1 : 0,
          borderRadius: currentTheme.ui.radius || '4px',
        }}
      >
        {/* 왼쪽 스크롤 버튼 */}
        {showLeftScroll && (
          <button
            onClick={handleScrollLeft}
            style={{ ...styles.scrollButton, color: currentTheme.ui.textSecondary }}
          >
            <ChevronLeft size={16} strokeWidth={2.5} />
          </button>
        )}

        <div
          ref={scrollContainerRef}
          className="mobile-toolbar-scroll"
          style={styles.scrollContainer}
          onScroll={checkScroll}
        >
          <div style={styles.buttonGroup}>
            {/* Ctrl (Sticky Toggle) */}
            <Button 
              size="small" 
              onClick={() => setCtrlActive(!ctrlActive)} 
              theme={currentTheme}
              style={{
                backgroundColor: ctrlActive ? currentTheme.yellow : currentTheme.ui.bgTertiary,
                color: ctrlActive ? currentTheme.ui.bg : currentTheme.ui.text,
                minWidth: '44px',
              }}
            >
              CTRL
            </Button>

            {/* Alt (Sticky Toggle) */}
            <Button 
              size="small" 
              onClick={() => setAltActive(!altActive)} 
              theme={currentTheme}
              style={{
                backgroundColor: altActive ? currentTheme.yellow : currentTheme.ui.bgTertiary,
                color: altActive ? currentTheme.ui.bg : currentTheme.ui.text,
                minWidth: '40px',
              }}
            >
              ALT
            </Button>

            <div style={{ width: '1px', height: '20px', backgroundColor: currentTheme.ui.borderLight, margin: '0 2px' }} />

            {/* Command Input (한글 입력) */}
            <Button 
              variant="primary" 
              size="icon" 
              onClick={() => onOpenCommandInput?.()} 
              theme={currentTheme}
              icon={MessageSquare}
              title={t('commandInput')}
            />

            {/* ESC */}
            <Button 
              size="small" 
              onClick={() => handleKeyWithModifiers('\x1b')} 
              theme={currentTheme}
            >
              ESC
            </Button>

            {/* TAB */}
            <Button 
              size="small" 
              onClick={() => handleKeyWithModifiers('\t')} 
              theme={currentTheme}
            >
              TAB
            </Button>

            {/* Ctrl+C (직통) */}
            <Button 
              variant="danger" 
              size="small" 
              onClick={() => onSendKey('\x03')} 
              theme={currentTheme}
              style={{ fontWeight: '800' }}
            >
              ^C
            </Button>

            {/* Arrow Keys */}
            <Button size="icon" onClick={() => handleKeyWithModifiers('\x1b[A')} theme={currentTheme} icon={ArrowUp} />
            <Button size="icon" onClick={() => handleKeyWithModifiers('\x1b[B')} theme={currentTheme} icon={ArrowDown} />
            <Button size="icon" onClick={() => handleKeyWithModifiers('\x1b[D')} theme={currentTheme} icon={ArrowLeft} />
            <Button size="icon" onClick={() => handleKeyWithModifiers('\x1b[C')} theme={currentTheme} icon={ArrowRight} />

            <div style={{ width: '1px', height: '20px', backgroundColor: currentTheme.ui.borderLight, margin: '0 2px' }} />

            {/* Paste */}
            <Button size="icon" onClick={handlePaste} theme={currentTheme} icon={ClipboardPaste} title={t('paste')} />

            {/* Clear */}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleClear} 
              theme={currentTheme} 
              style={{ color: currentTheme.ui.textSecondary }}
              icon={Eraser} 
              title={t('clearInput')} 
            />
          </div>
        </div>

        {/* 오른쪽 스크롤 버튼 */}
        {showRightScroll && (
          <button
            onClick={handleScrollRight}
            style={{ ...styles.scrollButton, color: currentTheme.ui.textSecondary }}
          >
            <ChevronRight size={16} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </>
  );
};

const styles = {
  toolbar: {
    position: 'fixed',
    left: '12px',
    right: '12px',
    bottom: '12px',
    backdropFilter: 'blur(20px) saturate(160%)',
    padding: '6px',
    zIndex: 9999,
    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
  },
  scrollContainer: {
    flex: 1,
    overflowX: 'auto',
    overflowY: 'hidden',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    display: 'flex',
    justifyContent: 'center',
  },
  buttonGroup: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexWrap: 'nowrap',
    padding: '0 4px',
  },
  scrollButton: {
    flexShrink: 0,
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    WebkitTapHighlightColor: 'transparent',
  },
};

export default MobileToolbar;
