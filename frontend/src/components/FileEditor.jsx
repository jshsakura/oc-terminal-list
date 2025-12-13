/**
 * FileEditor 컴포넌트
 * 파일 내용 표시 및 편집
 */
import { useState, useEffect } from 'react';
import { File, X, Edit2, Save } from 'lucide-react';

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
    <div style={{ ...styles.container, backgroundColor: theme.ui.bg }}>
      {/* 헤더 */}
      <div style={{ ...styles.header, backgroundColor: theme.ui.bgSecondary, borderBottomColor: theme.ui.border }}>
        <div style={styles.headerLeft}>
          <File size={14} style={{ color: theme.ui.accent }} />
          <span style={{ ...styles.filePath, color: theme.ui.text }}>{filePath}</span>
        </div>
        <div style={styles.headerRight}>
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              style={{ ...styles.button, backgroundColor: theme.ui.bgTertiary, color: theme.ui.text }}
              disabled={loading}
            >
              <Edit2 size={14} />
              <span>편집</span>
            </button>
          ) : (
            <>
              <button
                onClick={saveFile}
                disabled={saving}
                style={{ ...styles.button, backgroundColor: theme.green, color: theme.ui.bg }}
              >
                <Save size={14} />
                <span>{saving ? '저장 중...' : '저장'}</span>
              </button>
              <button
                onClick={handleCancel}
                disabled={saving}
                style={{ ...styles.button, backgroundColor: theme.brightBlack, color: theme.ui.text }}
              >
                취소
              </button>
            </>
          )}
          <button
            onClick={onClose}
            style={{ ...styles.button, backgroundColor: theme.red, color: theme.ui.bg }}
          >
            <X size={14} />
            <span>닫기</span>
          </button>
        </div>
      </div>

      {/* 내용 */}
      <div style={styles.content}>
        {loading ? (
          <div style={{ ...styles.message, color: theme.ui.textSecondary }}>불러오는 중...</div>
        ) : error ? (
          <div style={{ ...styles.message, color: theme.red }}>{error}</div>
        ) : (
          <textarea
            style={{
              ...styles.textarea,
              backgroundColor: theme.ui.bgSecondary,
              color: theme.ui.text,
              borderColor: theme.ui.border,
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
    top: '36px',
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#1e1e2e',
    zIndex: 100,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    backgroundColor: '#181825',
    borderBottom: '1px solid #313244',
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
    fontWeight: '500',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#cdd6f4',
  },
  headerRight: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexShrink: 0,
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 10px',
    fontSize: '11px',
    fontWeight: '500',
    border: 'none',
    borderRadius: '2px',
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
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
    padding: '12px',
    backgroundColor: '#181825',
    color: '#cdd6f4',
    border: 'none',
    outline: 'none',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '13px',
    lineHeight: '1.6',
    resize: 'none',
    overflow: 'auto',
  },
  message: {
    padding: '20px',
    textAlign: 'center',
    fontSize: '14px',
  },
};

export default FileEditor;
