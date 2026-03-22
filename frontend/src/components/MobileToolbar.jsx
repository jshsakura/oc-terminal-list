/**
 * MobileToolbar 컴포넌트
 * 모바일(iOS) 전용 고밀도 IDE 툴바 (터치 최적화 버전)
 * 순서: 빠른입력 > 방향키 > ESC > TAB > ^C > CTRL/ALT
 */
import { useRef, useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ClipboardPaste, Eraser, MessageSquare } from 'lucide-react';
import useVisualViewport from '../hooks/useVisualViewport';
import useTranslation from '../hooks/useTranslation';

const MobileToolbar = ({ onSendKey, isVisible, onClose, activeSessionId, onOpenCommandInput, language = 'en', theme }) => {
  const { t } = useTranslation(language);
  const toolbarRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  useVisualViewport(toolbarRef);

  const currentTheme = theme || {
    ui: {
      bg: '#1e1e2e',
      bgSecondary: '#181825',
      accent: '#89b4fa',
      borderLight: 'rgba(255,255,255,0.1)',
    },
    yellow: '#f9e2af',
    red: '#f38ba8',
  };

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

  if (!isVisible) return null;

  return (
    <>
      <style>{`
        .mobile-toolbar-scroll::-webkit-scrollbar { display: none; }
        .btn-active { 
          background-color: ${currentTheme.yellow} !important; 
          color: #11111b !important;
          box-shadow: 0 0 10px ${currentTheme.yellow}66;
        }
      `}</style>
      <div
        ref={toolbarRef}
        style={{
          ...styles.toolbar,
          backgroundColor: currentTheme.ui.bgSecondary,
          borderTop: `1px solid ${currentTheme.ui.border}`,
        }}
      >
        <div ref={scrollContainerRef} className="mobile-toolbar-scroll" style={styles.scrollContainer}>
          <div style={styles.buttonGroup}>
            
            {/* 1. 빠른 입력 (최좌측 전진 배치) */}
            <button 
              onClick={() => onOpenCommandInput?.()} 
              style={{
                ...styles.compactBtn, 
                backgroundColor: currentTheme.ui.accentMuted, 
                color: currentTheme.ui.accent, 
                borderColor: currentTheme.ui.borderLight
              }}
              title={t('commandInput')}
            >
              <MessageSquare size={14} strokeWidth={2.5} />
            </button>

            <div style={styles.divider} />

            {/* 2. 방향키 */}
            <div style={styles.cluster}>
              <button onClick={() => handleKeyWithModifiers('\x1bOD')} style={{...styles.compactBtn, color: currentTheme.ui.text, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border}}><ArrowLeft size={14} /></button>
              <button onClick={() => handleKeyWithModifiers('\x1bOA')} style={{...styles.compactBtn, color: currentTheme.ui.text, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border}}><ArrowUp size={14} /></button>
              <button onClick={() => handleKeyWithModifiers('\x1bOB')} style={{...styles.compactBtn, color: currentTheme.ui.text, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border}}><ArrowDown size={14} /></button>
              <button onClick={() => handleKeyWithModifiers('\x1bOC')} style={{...styles.compactBtn, color: currentTheme.ui.text, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border}}><ArrowRight size={14} /></button>
            </div>

            <div style={styles.divider} />

            {/* 3. 핵심 제어키 */}
            <button onClick={() => handleKeyWithModifiers('\x1b')} style={{...styles.compactBtn, color: currentTheme.ui.text, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border, fontWeight: '800'}}>ESC</button>
            <button onClick={() => handleKeyWithModifiers('\t')} style={{...styles.compactBtn, color: currentTheme.ui.text, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border, fontWeight: '800'}}>TAB</button>
            <button 
              onClick={() => onSendKey('\x03')} 
              style={{...styles.compactBtn, color: currentTheme.red, borderColor: `${currentTheme.red}44`, backgroundColor: `${currentTheme.red}11`, fontWeight: '900'}}
            >
              ^C
            </button>

            <div style={styles.divider} />

            {/* 4. 조합키 (토글) */}
            <button 
              onClick={() => setCtrlActive(!ctrlActive)} 
              className={ctrlActive ? 'btn-active' : ''}
              style={{...styles.compactBtn, color: currentTheme.ui.text, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border}}
            >
              CTRL
            </button>
            <button 
              onClick={() => setAltActive(!altActive)} 
              className={altActive ? 'btn-active' : ''}
              style={{...styles.compactBtn, color: currentTheme.ui.text, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border}}
            >
              ALT
            </button>

            <div style={styles.divider} />

            {/* 5. 부가 기능 */}
            <button 
              onClick={() => { const text = prompt('Paste:'); if (text) onSendKey(text); }} 
              style={{...styles.compactBtn, color: currentTheme.ui.text, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border}}
            >
              <ClipboardPaste size={14} />
            </button>
            <button onClick={() => onSendKey('\x15')} style={{...styles.compactBtn, color: currentTheme.ui.text, backgroundColor: currentTheme.ui.bgTertiary, borderColor: currentTheme.ui.border, opacity: 0.6}}><Eraser size={14} /></button>
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
    height: '32px', // 전체 높이 대폭 축소
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    boxShadow: '0 -2px 10px rgba(0,0,0,0.3)',
  },
  scrollContainer: {
    flex: 1,
    height: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    WebkitOverflowScrolling: 'touch',
    padding: '0 8px',
    display: 'flex',
    alignItems: 'center',
  },
  buttonGroup: {
    display: 'flex',
    gap: '8px', // 간격을 6px에서 8px로 약간 확대
    alignItems: 'center',
    paddingRight: '20px',
  },
  cluster: {
    display: 'flex',
    gap: '4px', // 클러스터 내부 간격을 2px에서 4px로 확대
    padding: '0', // 패딩 제거
    borderRadius: '4px',
  },
  compactBtn: {
    flexShrink: 0,
    height: '24px', 
    padding: '0 8px', // 패딩 약간 확대 (터치 영역 확보)
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '4px',
    color: '#cdd6f4',
    fontSize: '10px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'all 0.1s ease',
    outline: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
  divider: {
    width: '1px',
    height: '14px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    margin: '0 2px', // 마진을 4px에서 2px로 축소
    flexShrink: 0,
  },
};

export default MobileToolbar;
