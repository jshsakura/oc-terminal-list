import { useState, useEffect, useCallback } from 'react';
import { Folder, File, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';

const FileTree = ({ theme, onFileSelect, onFolderSelect }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFiles = useCallback(async (path = '') => {
    try {
      const token = localStorage.getItem('auth_token');
      const timestamp = new Date().getTime();
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}&_t=${timestamp}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log("[DEBUG] Received items:", data.items);
      setItems(data.items || []);
      setError(null);
    } catch (err) {
      console.error("[DEBUG] Fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  if (loading) return <div style={{ color: theme.ui.textSecondary, padding: '20px', fontSize: '12px' }}>Loading workspace...</div>;
  if (error) return <div style={{ color: theme.red, padding: '20px', fontSize: '12px' }}>Error: {error}</div>;

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      backgroundColor: theme.ui.bg,
      color: theme.ui.text,
      overflowY: 'auto'
    }}>
      {/* 헤더 */}
      <div style={{ 
        padding: '10px 12px', 
        borderBottom: `1px solid ${theme.ui.border}`, 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: theme.ui.bgSecondary
      }}>
        <span style={{ fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px' }}>EXPLORER</span>
        <button onClick={() => fetchFiles()} style={{ background: 'none', border: 'none', color: theme.ui.textSecondary, cursor: 'pointer' }}>
          <RefreshCw size={14} />
        </button>
      </div>

      {/* 리스트 본체 */}
      <div style={{ flex: 1, padding: '8px 0' }}>
        {items.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', opacity: 0.5, fontSize: '12px' }}>
            No files found in /app/workspace
          </div>
        ) : (
          items.map((item) => (
            <div 
              key={item.path}
              onClick={() => {
                if (item.type === 'file') onFileSelect?.(item.path);
                else onFolderSelect?.(item.path);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 16px',
                cursor: 'pointer',
                fontSize: '13px',
                gap: '8px',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.ui.bgTertiary}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              {item.type === 'directory' ? (
                <Folder size={16} color="#89b4fa" fill="#89b4fa" fillOpacity={0.2} />
              ) : (
                <File size={16} color={theme.ui.textSecondary} />
              )}
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.name}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default FileTree;
