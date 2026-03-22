import { useState, useEffect, useCallback } from 'react';
import { Folder, File, RefreshCw, ChevronLeft, Home } from 'lucide-react';

const FileTree = ({ theme, onFileSelect, onFolderSelect }) => {
  const [items, setItems] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFiles = useCallback(async (path = '') => {
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
      setError(null);
    } catch (err) {
      console.error("[DEBUG] Fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles('');
  }, [fetchFiles]);

  const handleGoBack = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    const parentPath = parts.join('/');
    fetchFiles(parentPath);
  };

  const handleItemClick = (item) => {
    if (item.type === 'directory') {
      fetchFiles(item.path);
      onFolderSelect?.(item.path);
    } else {
      onFileSelect?.(item.path);
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
      backgroundColor: theme.ui.bg,
      color: theme.ui.text,
      overflowY: 'hidden'
    }}>
      {/* 헤더 */}
      <div style={{ 
        padding: '10px 12px', 
        borderBottom: `1px solid ${theme.ui.border}`, 
        display: 'flex', 
        flexDirection: 'column',
        gap: '8px',
        backgroundColor: theme.ui.bgSecondary
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px' }}>EXPLORER</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => fetchFiles(currentPath)} style={{ background: 'none', border: 'none', color: theme.ui.textSecondary, cursor: 'pointer' }}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        
        {/* 경로 표시줄 */}
        <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden' }}>
          {renderPathBreadcrumbs()}
        </div>
      </div>

      {/* 리스트 본체 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {loading && items.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', opacity: 0.5, fontSize: '12px' }}>Loading...</div>
        ) : (
          <>
            {/* 뒤로 가기 (루트가 아닐 때만) */}
            {currentPath && (
              <div 
                onClick={handleGoBack}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  gap: '10px',
                  opacity: 0.7,
                  borderBottom: `1px solid ${theme.ui.border}22`
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.ui.bgTertiary}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <ChevronLeft size={16} />
                <span>.. (Parent Directory)</span>
              </div>
            )}

            {items.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', opacity: 0.4, fontSize: '12px' }}>
                Folder is empty
              </div>
            ) : (
              items.map((item) => (
                <div 
                  key={item.path}
                  onClick={() => handleItemClick(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 16px', // 터치 영역 확대
                    cursor: 'pointer',
                    fontSize: '13px',
                    gap: '10px',
                    transition: 'background 0.1s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.ui.bgTertiary}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  {item.type === 'directory' ? (
                    <Folder size={18} color="#89b4fa" fill="#89b4fa" fillOpacity={0.2} />
                  ) : (
                    <File size={18} color={theme.ui.textSecondary} />
                  )}
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                    {item.name}
                  </span>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default FileTree;
