/**
 * Sidebar 컴포넌트
 * 터미널 세션 목록 및 관리
 */
import { useState, useRef, useEffect, memo } from 'react';
import { X, Terminal, Cpu, FolderTree, RefreshCw, Plus, Activity, HardDrive } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';
import FileTree from './FileTree';
import Button from './common/Button';

const Sidebar = ({ isOpen, onClose, sessions, activeSessionId, onSelectSession, onNewSession, onCloseSession, onRenameSession, onReconnectSession, language = 'en', theme, isMobile = false, width = 250, onResizeStart, onFileSelect, onFolderSelect, onOpenTerminalAtFolder, selectedFolderPath = '' }) => {
  const { t } = useTranslation(language);
  const [hoveredSessionId, setHoveredSessionId] = useState(null);
  const [activeTab, setActiveTab] = useState('sessions'); // 'sessions' | 'files'
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [systemStats, setSystemStats] = useState({ cpu: 0, ram: 0, disk: 0 });
  const editInputRef = useRef(null);

  // 시스템 정보 주기적 업데이트
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;
        const res = await fetch('/api/system/stats', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setSystemStats(data);
        }
      } catch (e) {
        console.error("Failed to fetch system stats", e);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000); // 10초 주기
    return () => clearInterval(interval);
  }, []);

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
      radiusSmall: '2px',
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

  const handleOpenTerminalAtFolder = (path) => {
    if (onOpenTerminalAtFolder) onOpenTerminalAtFolder(path);
  };

  if (!isOpen) return null;

  const isLightTheme = currentTheme.background === '#ffffff' || currentTheme.background === '#fdf6e3' || currentTheme.background === '#fbf1c7';

  return (
    <>
      {/* 오버레이 배경 (모바일에서만) */}
      {isMobile && <div style={{
        ...styles.overlay,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
        zIndex: 9998,
      }} onClick={onClose} />}

      <div style={{
        ...styles.sidebar,
        backgroundColor: currentTheme.ui.glassBg || (isLightTheme ? 'rgba(255, 255, 255, 0.95)' : 'rgba(30, 30, 46, 0.7)'),
        backdropFilter: isLightTheme ? 'blur(15px)' : 'blur(10px) saturate(140%)',
        WebkitBackdropFilter: isLightTheme ? 'blur(15px)' : 'blur(10px) saturate(140%)',
        borderRight: `1px solid ${currentTheme.ui.borderLight || currentTheme.ui.border}`,
        width: isMobile ? 'min(80vw, 280px)' : `${width}px`,
        maxWidth: isMobile ? '80vw' : '400px',
        minWidth: isMobile ? undefined : '180px',
        top: 0,
        height: '100vh',
        zIndex: 9999,
        boxShadow: isMobile ? '10px 0 30px rgba(0,0,0,0.1)' : (isLightTheme ? '1px 0 10px rgba(0,0,0,0.03)' : '5px 0 25px rgba(0,0,0,0.3)'),
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        {/* 헤더 */}
        <div style={{ 
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          height: '40px',
          minHeight: '40px',
          maxHeight: '40px',
          padding: '0 8px',
          boxSizing: 'border-box',
          backgroundColor: 'transparent', 
          borderBottom: `1px solid ${currentTheme.ui.borderLight || currentTheme.ui.border}`,
        }}>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onClose} 
              theme={currentTheme}
              title={t('closeSidebar')}
              icon={X}
              style={{ width: '24px', height: '24px', borderRadius: '2px' }}
            />
        </div>

        {/* 탭 헤더 (세션/파일) */}
        <div style={{ 
          ...styles.tabHeader, 
          borderBottom: `1px solid ${currentTheme.ui.borderLight || currentTheme.ui.border}`, 
          backgroundColor: 'rgba(0,0,0,0.1)',
          padding: '4px',
          gap: '4px',
        }}>
          <button
            onClick={() => setActiveTab('sessions')}
            style={{
              ...styles.tab,
              backgroundColor: activeTab === 'sessions' ? currentTheme.ui.cardBg : 'transparent',
              color: activeTab === 'sessions' ? currentTheme.ui.accent : currentTheme.ui.textSecondary,
              borderRadius: currentTheme.ui.radiusSmall || '2px',
              fontWeight: activeTab === 'sessions' ? '800' : '600',
            }}
          >
            <Cpu size={14} strokeWidth={2.5} />
            <span>{t('sessions')}</span>
          </button>
          <button
            onClick={() => setActiveTab('files')}
            style={{
              ...styles.tab,
              backgroundColor: activeTab === 'files' ? currentTheme.ui.cardBg : 'transparent',
              color: activeTab === 'files' ? currentTheme.ui.accent : currentTheme.ui.textSecondary,
              borderRadius: currentTheme.ui.radiusSmall || '2px',
              fontWeight: activeTab === 'files' ? '800' : '600',
            }}
          >
            <FolderTree size={14} strokeWidth={2.5} />
            <span>{t('files')}</span>
          </button>
        </div>

        {/* 새 터미널 버튼 (세션 탭일 때만) */}
        {activeTab === 'sessions' && (
          <div style={{ ...styles.newSessionContainer, borderBottom: `1px solid ${currentTheme.ui.borderLight || currentTheme.ui.border}`, padding: '8px 12px' }}>
            <Button 
              variant="primary" 
              fullWidth 
              size="small"
              onClick={onNewSession} 
              theme={currentTheme}
              icon={Plus}
            >
              {t('newSession')}
            </Button>
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
                      backgroundColor: isActive ? (isLightTheme ? `${currentTheme.ui.accent}11` : `${currentTheme.ui.accent}22`) : (isHovered ? `${currentTheme.ui.bgTertiary}` : 'transparent'),
                      borderRadius: '2px', // 아주 사각사각하게
                      border: isLightTheme && isActive ? `1px solid ${currentTheme.ui.accent}33` : '1px solid transparent',
                      marginBottom: '1px',
                    }}
                    onMouseEnter={() => setHoveredSessionId(session.id)}
                    onMouseLeave={() => setHoveredSessionId(null)}
                  >
                    {/* 세션 정보 (클릭 영역) */}
                    <div
                      style={styles.sessionInfo}
                      onClick={() => {
                        onSelectSession(session.id);
                        if (isMobile) onClose();
                      }}
                    >
                      <div style={{ ...styles.sessionIcon, color: isActive ? currentTheme.ui.accent : currentTheme.ui.textSecondary }}>
                        <Terminal size={14} strokeWidth={isActive ? 2.5 : 2} />
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
                              if (e.key === 'Enter') handleFinishEdit();
                              else if (e.key === 'Escape') handleCancelEdit();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              ...styles.sessionNameInput,
                              backgroundColor: currentTheme.ui.bgTertiary,
                              color: currentTheme.ui.text,
                              borderColor: currentTheme.ui.accent,
                              borderRadius: '2px',
                            }}
                          />
                        ) : (
                          <div
                            style={{ ...styles.sessionName, color: isActive ? currentTheme.ui.accent : currentTheme.ui.text, fontWeight: isActive ? '700' : '500' }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              handleStartEdit(session, index);
                            }}
                          >
                            {formatSessionName(session, index)}
                          </div>
                        )}
                        {session.cwd && (
                          <div style={{ fontSize: '10px', color: currentTheme.ui.textSecondary, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                            {session.cwd}
                          </div>
                        )}
                        <div style={{ ...styles.sessionId, color: currentTheme.ui.textSecondary, opacity: 0.5 }}>
                          {formatSessionId(session.id)}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '4px' }}>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onReconnectSession) onReconnectSession(session.id);
                        }} 
                        theme={currentTheme}
                        style={{ width: '24px', height: '24px', color: currentTheme.ui.textSecondary }}
                        icon={RefreshCw}
                        title="재연결"
                      />
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseSession(session.id);
                        }} 
                        theme={currentTheme}
                        style={{ width: '24px', height: '24px', color: currentTheme.red }}
                        icon={X}
                        title={t('closeTerminal')}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 파일 트리 (파일 탭일 때) */}
        {activeTab === 'files' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <FileTree
              theme={currentTheme}
              onFileSelect={onFileSelect}
              onFolderSelect={onFolderSelect}
              onOpenTerminalAtFolder={handleOpenTerminalAtFolder}
              language={language}
              initialPath={selectedFolderPath}
            />
          </div>
        )}

        {/* 푸터 정보 (시스템 리소스) */}
        <div style={{ 
          backgroundColor: currentTheme.ui.bgSecondary, 
          borderTop: `1px solid ${currentTheme.ui.borderLight || currentTheme.ui.border}`, 
          padding: '8px 12px',
          paddingBottom: isMobile ? '40px' : '8px' // MobileToolbar(32px) 고려하여 여유있게 패딩 추가
        }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="CPU">
              <Cpu size={12} strokeWidth={2.5} style={{ color: currentTheme.ui.accent }} />
              <span style={{ fontSize: '10px', fontWeight: '700', color: currentTheme.ui.text, opacity: 0.8 }}>{systemStats.cpu}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="RAM">
              <Activity size={12} strokeWidth={2.5} style={{ color: currentTheme.green }} />
              <span style={{ fontSize: '10px', fontWeight: '700', color: currentTheme.ui.text, opacity: 0.8 }}>{systemStats.ram}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="DISK">
              <HardDrive size={12} strokeWidth={2.5} style={{ color: currentTheme.ui.accent }} />
              <span style={{ fontSize: '10px', fontWeight: '700', color: currentTheme.ui.text, opacity: 0.8 }}>{systemStats.disk}%</span>
            </div>
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
    animation: 'fadeIn 0.2s ease',
  },
  sidebar: {
    position: 'fixed',
    left: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  tabHeader: {
    display: 'flex',
    height: '40px',
    minHeight: '40px',
    maxHeight: '40px',
  },
  tab: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '0 6px',
    fontSize: '11px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    height: '100%',
  },
  header: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 8px 0 16px',
    boxSizing: 'border-box',
  },
  title: {
    margin: 0,
  },
  newSessionContainer: {
  },
  sessionList: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '20px',
  },
  emptyText: {
    fontSize: '12px',
    margin: '0 0 4px 0',
  },
  emptyHint: {
    fontSize: '11px',
    margin: 0,
  },
  sessionItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 8px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  sessionInfo: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
  },
  sessionIcon: {
    width: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionDetails: {
    flex: 1,
    minWidth: 0,
  },
  sessionName: {
    fontSize: '12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sessionNameInput: {
    width: '100%',
    fontSize: '12px',
    padding: '2px 6px',
    border: '1px solid',
    outline: 'none',
  },
  sessionId: {
    fontSize: '9px',
    fontFamily: '"JetBrains Mono", monospace',
  },
  footer: {
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
  },
  footerValue: {
  },
  resizeHandle: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '4px',
    cursor: 'ew-resize',
    backgroundColor: 'transparent',
    transition: 'background-color 0.2s ease',
    zIndex: 10000,
  },
};

export default memo(Sidebar);
