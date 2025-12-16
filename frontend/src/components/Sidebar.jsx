/**
 * Sidebar 컴포넌트
 * 터미널 세션 목록 및 관리
 */
import { useState, useRef, useEffect, memo, useCallback } from 'react';
import { X, ChevronLeft, Terminal, Cpu, FolderTree, RefreshCw } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import FileTree from './FileTree';

const Sidebar = ({ isOpen, onClose, sessions, activeSessionId, onSelectSession, onNewSession, onCloseSession, onRenameSession, onReconnectSession, language = 'en', theme, isMobile = false, width = 250, onResizeStart, onFileSelect, onFolderSelect }) => {
  const { t } = useTranslation(language);
  const [hoveredSessionId, setHoveredSessionId] = useState(null);
  const [isCloseBtnHovered, setIsCloseBtnHovered] = useState(false);
  const [activeTab, setActiveTab] = useState('sessions'); // 'sessions' | 'files'
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef(null);

  // 기본 테마 (theme prop이 없을 경우 Catppuccin 사용)
  const currentTheme = theme || {
    ui: {
      bg: '#1e1e2e',
      bgSecondary: '#181825',
      bgTertiary: '#313244',
      border: '#313244',
      text: '#cdd6f4',
      textSecondary: '#6c7086',
      accent: '#89b4fa',
      iconColor: '#cdd6f4',
    },
    green: '#a6e3a1',
    red: '#f38ba8',
  };

  const formatSessionName = (session, index) => {
    return session.name || `Terminal ${index + 1}`;
  };

  const formatSessionId = (sessionId) => {
    return sessionId.substring(0, 8);
  };

  // 편집 시작
  const handleStartEdit = (session, index) => {
    setEditingSessionId(session.id);
    setEditingName(session.name || `Terminal ${index + 1}`);
  };

  // 편집 완료
  const handleFinishEdit = async () => {
    if (editingSessionId && editingName.trim() && onRenameSession) {
      await onRenameSession(editingSessionId, editingName.trim());
    }
    setEditingSessionId(null);
    setEditingName('');
  };

  // 편집 취소
  const handleCancelEdit = () => {
    setEditingSessionId(null);
    setEditingName('');
  };

  // 편집 input 포커스
  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  // 사이드바가 닫혀있으면 렌더링하지 않음 (훅 호출 후에 체크)
  if (!isOpen) return null;

  return (
    <>
      {/* 오버레이 배경 (모바일에서만) */}
      {isMobile && <div style={styles.overlay} onClick={onClose} />}

      {/* 사이드바 */}
      <div style={{
        ...styles.sidebar,
        backgroundColor: currentTheme.ui.bg,
        borderRightColor: currentTheme.ui.border,
        width: isMobile ? 'min(80vw, 250px)' : `${width}px`,
        maxWidth: isMobile ? '80vw' : '400px',
        minWidth: isMobile ? undefined : '180px',
        top: isMobile ? '0' : '33px',
        height: isMobile ? '100vh' : 'auto',
      }}>
        {/* 헤더 (모바일에서만) */}
        {isMobile && (
          <div style={{ ...styles.header, backgroundColor: currentTheme.ui.bgSecondary, borderBottomColor: currentTheme.ui.border }}>
            <h2 style={{ ...styles.title, color: currentTheme.ui.accent }}>
              {t('sessions') || 'Sessions'}
            </h2>
            <button
              onClick={onClose}
              onMouseEnter={() => setIsCloseBtnHovered(true)}
              onMouseLeave={() => setIsCloseBtnHovered(false)}
              style={{
                ...styles.closeBtn,
                color: currentTheme.ui.text,
                backgroundColor: isCloseBtnHovered ? currentTheme.ui.bgTertiary : 'transparent',
              }}
              title={t('closeSidebar')}
            >
              <X size={20} strokeWidth={2} />
            </button>
          </div>
        )}

        {/* 탭 헤더 (세션/파일) */}
        <div style={{ ...styles.tabHeader, borderBottomColor: currentTheme.ui.border, backgroundColor: currentTheme.ui.bgSecondary }}>
          <button
            onClick={() => setActiveTab('sessions')}
            style={{
              ...styles.tab,
              color: activeTab === 'sessions' ? currentTheme.ui.accent : currentTheme.ui.textSecondary,
              borderBottomColor: activeTab === 'sessions' ? currentTheme.ui.accent : 'transparent',
              borderRightColor: currentTheme.ui.border,
            }}
          >
            <Terminal size={14} strokeWidth={2} />
            <span>세션</span>
          </button>
          <button
            onClick={() => setActiveTab('files')}
            style={{
              ...styles.tab,
              color: activeTab === 'files' ? currentTheme.ui.accent : currentTheme.ui.textSecondary,
              borderBottomColor: activeTab === 'files' ? currentTheme.ui.accent : 'transparent',
              borderRightColor: currentTheme.ui.border,
            }}
          >
            <FolderTree size={14} strokeWidth={2} />
            <span>파일</span>
          </button>
        </div>

        {/* 새 터미널 버튼 (세션 탭일 때만) */}
        {activeTab === 'sessions' && (
          <div style={{ ...styles.newSessionContainer, borderBottomColor: currentTheme.ui.border }}>
            <button onClick={onNewSession} style={{ ...styles.newSessionBtn, backgroundColor: currentTheme.ui.accent, color: currentTheme.ui.bg }}>
              <span style={styles.plusIcon}>+</span>
              {t('newSession')}
            </button>
          </div>
        )}

        {/* 세션 목록 (세션 탭일 때) */}
        {activeTab === 'sessions' && (
          <div style={styles.sessionList}>
            {sessions.length === 0 ? (
              <div style={styles.emptyState}>
                <p style={{ ...styles.emptyText, color: currentTheme.ui.textSecondary }}>{t('noTerminals')}</p>
                <p style={{ ...styles.emptyHint, color: currentTheme.ui.textSecondary, opacity: 0.9 }}>{t('createFirstTerminal')}</p>
              </div>
            ) : (
              sessions.map((session, index) => {
                const isActive = session.id === activeSessionId;
                const isHovered = session.id === hoveredSessionId;

                return (
                  <div
                    key={session.id}
                    style={{
                      ...styles.sessionItem,
                      backgroundColor: isActive ? currentTheme.ui.bgTertiary : currentTheme.ui.bgSecondary,
                      borderColor: isActive ? currentTheme.ui.accent : (isHovered ? currentTheme.ui.border : 'transparent'),
                    }}
                    onMouseEnter={() => setHoveredSessionId(session.id)}
                    onMouseLeave={() => setHoveredSessionId(null)}
                  >
                    {/* 세션 정보 (클릭 영역) */}
                    <div
                      style={styles.sessionInfo}
                      onClick={() => {
                        onSelectSession(session.id);
                        // 모바일에서만 사이드바 닫기
                        if (isMobile) {
                          onClose();
                        }
                      }}
                    >
                      <div style={{ ...styles.sessionIcon, color: currentTheme.ui.accent }}>
                        <Terminal size={14} strokeWidth={2} />
                      </div>
                      <div style={styles.sessionDetails}>
                        {editingSessionId === session.id ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={handleFinishEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleFinishEdit();
                              } else if (e.key === 'Escape') {
                                handleCancelEdit();
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              ...styles.sessionNameInput,
                              backgroundColor: currentTheme.ui.bgTertiary,
                              color: currentTheme.ui.text,
                              borderColor: currentTheme.ui.accent,
                            }}
                          />
                        ) : (
                          <div
                            style={{ ...styles.sessionName, color: currentTheme.ui.text }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              handleStartEdit(session, index);
                            }}
                          >
                            {formatSessionName(session, index)}
                          </div>
                        )}
                        <div style={{ ...styles.sessionId, color: currentTheme.ui.textSecondary }}>
                          {formatSessionId(session.id)}
                        </div>
                      </div>
                    </div>

                    {/* 재연결 버튼 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onReconnectSession) {
                          onReconnectSession(session.id);
                        }
                      }}
                      style={{
                        ...styles.sessionActionBtn,
                        color: currentTheme.ui.accent,
                        opacity: isMobile ? 1 : 0.7,
                      }}
                      title="재연결"
                    >
                      <RefreshCw size={14} strokeWidth={2} />
                    </button>

                    {/* 닫기 버튼 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseSession(session.id);
                      }}
                      style={{
                        ...styles.sessionCloseBtn,
                        color: currentTheme.red,
                        opacity: isMobile ? 1 : 0.7,
                      }}
                      title={t('closeTerminal')}
                    >
                      <X size={16} strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 파일 트리 (파일 탭일 때) */}
        {activeTab === 'files' && (
          <FileTree
            theme={currentTheme}
            onFileSelect={onFileSelect}
            onFolderSelect={onFolderSelect}
            language={language}
          />
        )}

        {/* 푸터 정보 */}
        <div style={{ ...styles.footer, backgroundColor: currentTheme.ui.bgSecondary, borderTopColor: currentTheme.ui.border }}>
          <div style={styles.footerInfo}>
            <div style={styles.footerLeft}>
              <Cpu size={14} strokeWidth={2} style={{ color: currentTheme.ui.accent }} />
              <span style={{ ...styles.footerLabel, color: currentTheme.ui.textSecondary }}>{t('activeTerminals')}:</span>
            </div>
            <span style={{ ...styles.footerValue, color: currentTheme.ui.accent }}>{sessions.length}</span>
          </div>
        </div>

        {/* 리사이즈 핸들 (PC에서만) */}
        {!isMobile && onResizeStart && (
          <div
            onMouseDown={onResizeStart}
            style={styles.resizeHandle}
            title={t('resizeSidebar')}
          />
        )}
      </div>
    </>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100vh',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 9998,
    animation: 'fadeIn 0.2s ease',
  },
  sidebar: {
    position: 'fixed',
    top: '32px',
    left: 0,
    bottom: 0,
    width: '250px',
    maxWidth: '80vw',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid',
  },
  tabHeader: {
    display: 'flex',
    borderBottom: '1px solid',
    gap: '1px',
  },
  tab: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px',
    fontSize: '12px',
    fontWeight: '500',
    background: 'none',
    border: 'none',
    borderRight: '1px solid',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    transition: 'color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease',
  },
  header: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '0',
    borderBottom: '1px solid',
    height: '32px',
    boxSizing: 'border-box',
  },
  title: {
    margin: 0,
    fontSize: '13px',
    fontWeight: '600',
  },
  closeBtn: {
    position: 'absolute',
    right: '8px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '2px',
    transition: 'background-color 0.15s ease',
  },
  newSessionContainer: {
    padding: '8px',
    borderBottom: '1px solid',
  },
  newSessionBtn: {
    width: '100%',
    padding: '10px 12px',
    border: 'none',
    borderRadius: '2px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transition: 'opacity 0.15s ease',
  },
  plusIcon: {
    fontSize: '16px',
    fontWeight: '600',
  },
  sessionList: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px 20px',
  },
  emptyText: {
    fontSize: '14px',
    margin: '0 0 8px 0',
  },
  emptyHint: {
    fontSize: '12px',
    margin: 0,
  },
  sessionItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px',
    marginBottom: '8px',
    borderRadius: '2px',
    border: '1px solid transparent',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease, border 0.15s ease',
  },
  sessionItemActive: {
    border: '1px solid transparent',
  },
  sessionItemHover: {
    border: '1px solid transparent',
  },
  sessionInfo: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    minWidth: 0,
  },
  sessionIcon: {
    fontSize: '12px',
    width: '16px',
    textAlign: 'center',
  },
  sessionDetails: {
    flex: 1,
    minWidth: 0,
  },
  sessionName: {
    fontSize: '12px',
    fontWeight: '500',
    marginBottom: '2px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: 'default',
  },
  sessionNameInput: {
    width: '100%',
    fontSize: '12px',
    fontWeight: '500',
    padding: '2px 4px',
    border: '1px solid',
    borderRadius: '2px',
    outline: 'none',
    marginBottom: '2px',
  },
  sessionId: {
    fontSize: '10px',
    fontFamily: 'monospace',
  },
  sessionActionBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '2px',
    transition: 'background-color 0.15s ease, opacity 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '4px',
  },
  sessionCloseBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '2px',
    transition: 'background-color 0.15s ease, opacity 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: '8px 12px',
    borderTop: '1px solid',
  },
  footerInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  footerLabel: {
    fontSize: '12px',
  },
  footerValue: {
    fontSize: '13px',
    fontWeight: '600',
  },
  resizeHandle: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '4px',
    cursor: 'ew-resize',
    backgroundColor: 'transparent',
    transition: 'background-color 0.15s ease',
    zIndex: 10000,
  },
};

// CSS 애니메이션
if (!document.getElementById('sidebar-animations')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'sidebar-animations';
  styleSheet.textContent = `
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideInLeft {
      from {
        transform: translateX(-100%);
        opacity: 0.8;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(styleSheet);
}

export default memo(Sidebar);
