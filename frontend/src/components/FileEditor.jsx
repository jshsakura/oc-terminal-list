/**
 * FileEditor 컴포넌트
 * 파일 내용 표시 및 편집
 */
import { useState, useEffect } from 'react';
import { File, X, Edit2, Save, XCircle } from 'lucide-react';

const FileEditor = ({ filePath, onClose, theme }) => {
  const [content, setContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // 파일 로드
  useEffect(() => {
    if (filePath) {
      loadFile();
    }
  }, [filePath]);

  const loadFile = async () => {
    setLoading(true);
    setError(null);

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

      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save file:', error);
      setError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    loadFile();
    setIsEditing(false);
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
        backgroundColor: theme.ui.glassBg || theme.ui.bgSecondary, 
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${theme.ui.borderLight || theme.ui.border}`,
        height: '44px',
      }}>
        <div style={styles.headerLeft}>
          <File size={16} style={{ color: theme.ui.accent }} strokeWidth={2.5} />
          <span style={{ ...styles.filePath, color: theme.ui.text }}>{filePath}</span>
        </div>
        <div style={styles.headerRight}>
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              style={{ 
                ...styles.button, 
                backgroundColor: theme.ui.bgTertiary, 
                color: theme.ui.text,
                borderRadius: '8px',
              }}
              disabled={loading}
            >
              <Edit2 size={14} strokeWidth={2.5} />
              <span>Edit</span>
            </button>
          ) : (
            <>
              <button
                onClick={saveFile}
                disabled={saving}
                style={{ 
                  ...styles.button, 
                  backgroundColor: theme.ui.accent, 
                  color: theme.ui.bg,
                  borderRadius: '8px',
                  boxShadow: `0 4px 12px ${theme.ui.accent}44`,
                }}
              >
                <Save size={14} strokeWidth={2.5} />
                <span>{saving ? '...' : 'Save'}</span>
              </button>
              <button
                onClick={handleCancel}
                disabled={saving}
                style={{ 
                  ...styles.button, 
                  backgroundColor: theme.ui.bgTertiary, 
                  color: theme.ui.text,
                  borderRadius: '8px',
                }}
              >
                Cancel
              </button>
            </>
          )}
          <div style={{ width: '1px', height: '20px', backgroundColor: theme.ui.borderLight, margin: '0 4px' }} />
          <button
            onClick={onClose}
            style={{ 
              ...styles.button, 
              backgroundColor: 'rgba(243, 139, 168, 0.1)', 
              color: theme.red,
              borderRadius: '8px',
            }}
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* 내용 */}
      <div style={styles.content}>
        {loading ? (
          <div style={{ ...styles.message, color: theme.ui.textSecondary }}>
            <div className="terminal-loader" style={{ borderColor: theme.ui.accent, marginBottom: '12px' }}></div>
            Loading...
          </div>
        ) : error ? (
          <div style={{ ...styles.message, color: theme.red }}>
            <XCircle size={32} style={{ marginBottom: '12px' }} />
            {error}
          </div>
        ) : (
          <textarea
            style={{
              ...styles.textarea,
              backgroundColor: theme.ui.bgSecondary,
              color: theme.ui.text,
              borderColor: 'transparent',
            }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            readOnly={!isEditing}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    position: 'absolute',
    top: '40px', // Header height
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
    padding: '0 16px',
    gap: '12px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flex: 1,
    minWidth: 0,
  },
  filePath: {
    fontSize: '13px',
    fontWeight: '700',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: '"JetBrains Mono", monospace',
  },
  headerRight: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexShrink: 0,
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: '700',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
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
    padding: '20px',
    outline: 'none',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '14px',
    lineHeight: '1.7',
    resize: 'none',
    overflow: 'auto',
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
