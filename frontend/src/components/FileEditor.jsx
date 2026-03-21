/**
 * FileEditor 컴포넌트
 * 파일 내용 표시 및 즉시 편집 지원
 */
import { useState, useEffect } from 'react';
import { File, X, Save, XCircle, RefreshCw } from 'lucide-react';
import Button from './common/Button';

const FileEditor = ({ filePath, onClose, theme }) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);

  // 파일 로드
  useEffect(() => {
    if (filePath) {
      loadFile();
    }
  }, [filePath]);

  const loadFile = async () => {
    setLoading(true);
    setError(null);
    setHasChanges(false);

    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to load file');
      }

      const data = await res.json();
      setContent(data.content);
    } catch (error) {
      console.error('Failed to load file:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!hasChanges) return;
    setSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/files/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ path: filePath, content })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to save file');
      }

      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save file:', error);
      setError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleContentChange = (e) => {
    setContent(e.target.value);
    setHasChanges(true);
  };

  const handleKeyDown = (e) => {
    // Ctrl+S 또는 Cmd+S로 저장
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveFile();
    }
  };

  if (!filePath) return null;

  return (
    <div style={{ 
      ...styles.container, 
      backgroundColor: theme.ui.bg,
      boxShadow: '0 -10px 30px rgba(0,0,0,0.3)',
    }}>
      {/* 헤더 */}
      <div style={{ 
        ...styles.header, 
        backgroundColor: theme.ui.bgSecondary, 
        borderBottom: `1px solid ${theme.ui.borderLight || theme.ui.border}`,
        height: '40px',
      }}>
        <div style={styles.headerLeft}>
          <File size={14} style={{ color: theme.ui.accent }} strokeWidth={2.5} />
          <span style={{ ...styles.filePath, color: theme.ui.text }}>{filePath}</span>
          {hasChanges && <span style={{ color: theme.yellow, fontSize: '10px', marginLeft: '8px' }}>● Modified</span>}
        </div>
        <div style={styles.headerRight}>
          <Button 
            variant="primary" 
            size="small" 
            onClick={saveFile} 
            disabled={!hasChanges || saving || loading}
            theme={theme}
            icon={Save}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
          
          <Button 
            variant="ghost" 
            size="small" 
            onClick={loadFile} 
            disabled={loading}
            theme={theme}
            icon={RefreshCw}
            title="Reload"
          />

          <div style={{ width: '1px', height: '16px', backgroundColor: theme.ui.borderLight, margin: '0 4px' }} />
          
          <Button 
            variant="danger" 
            size="small" 
            onClick={onClose} 
            theme={theme}
            icon={X}
          />
        </div>
      </div>

      {/* 내용 */}
      <div style={styles.content}>
        {loading ? (
          <div style={{ ...styles.message, color: theme.ui.textSecondary }}>
            <div className="terminal-loader" style={{ borderColor: theme.ui.accent, marginBottom: '12px' }}></div>
            Loading file...
          </div>
        ) : error ? (
          <div style={{ ...styles.message, color: theme.red }}>
            <XCircle size={32} style={{ marginBottom: '12px' }} />
            {error}
            <Button theme={theme} onClick={loadFile} style={{ marginTop: '16px' }}>Retry</Button>
          </div>
        ) : (
          <textarea
            style={{
              ...styles.textarea,
              backgroundColor: theme.ui.bg,
              color: theme.ui.text,
              borderColor: 'transparent',
            }}
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder="File is empty"
          />
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    zIndex: 100,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 12px',
    gap: '12px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
    minWidth: 0,
  },
  filePath: {
    fontSize: '12px',
    fontWeight: '700',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: '"JetBrains Mono", monospace',
    opacity: 0.9,
  },
  headerRight: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  textarea: {
    flex: 1,
    width: '100%',
    padding: '16px',
    outline: 'none',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '13px',
    lineHeight: '1.6',
    resize: 'none',
    overflow: 'auto',
    border: 'none',
  },
  message: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: '600',
  },
};

export default FileEditor;
