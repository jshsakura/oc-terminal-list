import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, File, RefreshCw, ChevronLeft, Terminal } from 'lucide-react';
import useTranslation from '../hooks/useTranslation';

const FileTree = ({ theme, onFileSelect, onFolderSelect, onOpenTerminalAtFolder, language = 'en', initialPath = '' }) => {
  const { t } = useTranslation(language);
  const [items, setItems] = useState([]);
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [activeItemPath, setActiveItemPath] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFiles = useCallback(async (path) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const timestamp = new Date().getTime();
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}&_t=${timestamp}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
      setCurrentPath(path);
      onFolderSelect?.(path); // 부모 상태 업데이트 (터미널 열기용)
      setError(null);
    } catch (err) {
      console.error("[DEBUG] Fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onFolderSelect]);

  // 마운트 시 initialPath가 있으면 그곳을, 없으면 루트를 로드
  useEffect(() => {
    fetchFiles(initialPath);
  }, [fetchFiles, initialPath]);

  const handleGoBack = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    const parentPath = parts.join('/');
    fetchFiles(parentPath);
  };

  const lastClickRef = useRef({ id: null, time: 0 });

  const handleItemClick = (item) => {
    setActiveItemPath(item.path);
    if (item.type === 'directory') {
      fetchFiles(item.path);
    } else {
      onFileSelect?.(item.path);
    }
  };

  const handleTouchOrClick = (item) => {
    const now = Date.now();
    const isDoubleTap = lastClickRef.current.id === item.path && (now - lastClickRef.current.time) < 300;
    
    // Always update active item for visual feedback
    setActiveItemPath(item.path);

    if (isDoubleTap) {
      handleItemClick(item);
      lastClickRef.current = { id: null, time: 0 };
    } else {
      lastClickRef.current = { id: item.path, time: now };
    }
  };

  const handleBackTouchOrClick = () => {
    const now = Date.now();
    const isDoubleTap = lastClickRef.current.id === 'back' && (now - lastClickRef.current.time) < 300;
    
    if (isDoubleTap) {
      handleGoBack();
      lastClickRef.current = { id: null, time: 0 };
    } else {
      lastClickRef.current = { id: 'back', time: now };
    }
  };

  const renderPathBreadcrumbs = () => {
    if (!currentPath) return <span style={{ opacity: 0.6 }}>ROOT</span>;
    return (
      <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span onClick={() => fetchFiles('')} style={{ cursor: 'pointer', opacity: 0.6 }}>~</span>
        {currentPath.split('/').map((part, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ margin: '0 2px', opacity: 0.4 }}>/</span>
            <span style={{ fontWeight: 'bold' }}>{part}</span>
          </span>
        ))}
      </div>
    );
  };

  const [hoveredPath, setHoveredPath] = useState(null);

  if (error) return (
    <div style={{ color: theme.red, padding: '20px', fontSize: '12px' }}>
      <div>Error: {error}</div>
      <button onClick={() => fetchFiles(currentPath)} style={{ marginTop: '10px', background: 'none', border: `1px solid ${theme.red}`, color: theme.red, padding: '4px 8px', borderRadius: '4px' }}>Retry</button>
    </div>
  );

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      backgroundColor: 'transparent',
      color: theme.ui.text,
      overflowY: 'hidden'
    }}>
      <div style={{ 
        padding: '10px 12px', 
        borderBottom: `1px solid ${theme.ui.borderLight || theme.ui.border}`, 
        display: 'flex', 
        flexDirection: 'column',
        gap: '8px',
        backgroundColor: theme.ui.glassBg || 'rgba(0,0,0,0.1)',
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px' }}>{t('explorer')}</span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onOpenTerminalAtFolder?.(currentPath);
              }} 
              style={{ background: 'none', border: 'none', color: theme.ui.textSecondary, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              title="Open terminal here"
            >
              <Terminal size={14} />
            </button>
            <button onClick={() => fetchFiles(currentPath)} style={{ background: 'none', border: 'none', color: theme.ui.textSecondary, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden' }}>
          {renderPathBreadcrumbs()}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '4px 0' }}>
        {loading && items.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', opacity: 0.5, fontSize: '12px' }}>Loading...</div>
        ) : (
          <>
            {currentPath && (
              <div 
                onClick={handleGoBack}
                onMouseEnter={() => setHoveredPath('back')}
                onMouseLeave={() => setHoveredPath(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  gap: '10px',
                  opacity: 0.7,
                  backgroundColor: hoveredPath === 'back' ? theme.ui.cardBg : 'transparent',
                  borderBottom: `1px solid ${theme.ui.borderLight || theme.ui.border}22`,
                  userSelect: 'none',
                  transition: 'background-color 0.15s ease'
                }}
              >
                <ChevronLeft size={16} />
                <span>.. {t('parentFolder')}</span>
              </div>
            )}

            {items.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', opacity: 0.4, fontSize: '12px' }}>Folder empty</div>
            ) : (
              items.map((item) => {
                const isActive = item.path === activeItemPath;
                const isHovered = item.path === hoveredPath;
                return (
                  <div 
                    key={item.path}
                    onClick={() => handleTouchOrClick(item)}
                    onMouseEnter={() => setHoveredPath(item.path)}
                    onMouseLeave={() => setHoveredPath(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px 16px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      gap: '10px',
                      userSelect: 'none',
                      backgroundColor: isActive ? (theme.ui.accentMuted || `${theme.ui.accent}33`) : (isHovered ? theme.ui.cardBg : 'transparent'),
                      borderLeft: isActive ? `3px solid ${theme.ui.accent}` : '3px solid transparent',
                      transition: 'all 0.15s ease',
                      position: 'relative',
                    }}
                  >
                    {item.type === 'directory' ? (
                      <Folder size={18} color={theme.ui.accent} fill={theme.ui.accent} fillOpacity={0.2} />
                    ) : (
                      <File size={18} color={theme.ui.textSecondary} />
                    )}
                    <span style={{ 
                      whiteSpace: 'nowrap', 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis', 
                      flex: 1,
                      fontWeight: isActive ? '700' : '400',
                      color: isActive ? theme.ui.text : theme.ui.textSecondary
                    }}>
                      {item.name}
                    </span>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default FileTree;
