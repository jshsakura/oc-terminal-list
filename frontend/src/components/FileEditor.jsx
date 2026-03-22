/**
 * FileEditor 컴포넌트
 * Monaco Editor를 사용한 VSCode 수준의 멀티 탭 편집 환경 제공
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { File, X, Save, RefreshCw, CheckCircle2, AlertCircle, Loader2, FileCode, FileText, Image as ImageIcon } from 'lucide-react';
import Button from './common/Button';

const getFileIcon = (filename, color) => {
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'js': case 'jsx': case 'ts': case 'tsx':
    case 'py': case 'html': case 'css': case 'c': case 'cpp': case 'go': case 'rs':
      return <FileCode size={14} color={color || '#89b4fa'} />;
    case 'json': case 'md': case 'txt': case 'csv': case 'env':
    case 'gitignore': case 'dockerignore':
      return <FileText size={14} color={color || '#f9e2af'} />;
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'ico': case 'webp':
      return <ImageIcon size={14} color={color || '#a6e3a1'} />;
    default:
      return <File size={14} color={color || '#cdd6f4'} />;
  }
};

const FileEditor = ({ activeFile, openFiles, onFileSelect, onClose, theme }) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [status, setStatus] = useState('idle'); // 'idle' | 'saved' | 'error'
  
  const editorRef = useRef(null);

  // 확장자에 따른 언어 결정
  const getLanguage = useCallback((path) => {
    if (!path) return 'plaintext';
    const ext = path.split('.').pop().toLowerCase();
    const map = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'md': 'markdown',
      'c': 'c',
      'cpp': 'cpp',
      'go': 'go',
      'rs': 'rust',
      'sh': 'shell',
      'yml': 'yaml',
      'yaml': 'yaml',
      'xml': 'xml',
      'sql': 'sql',
      'php': 'php',
    };
    return map[ext] || 'plaintext';
  }, []);

  const loadFile = useCallback(async (path) => {
    if (!path) return;
    setLoading(true);
    setError(null);
    setHasChanges(false);
    setStatus('idle');

    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`, {
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
  }, []);

  useEffect(() => {
    if (activeFile) loadFile(activeFile);
  }, [activeFile, loadFile]);

  const saveFile = useCallback(async () => {
    if (!hasChanges || saving || !activeFile) return;
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
        body: JSON.stringify({ path: activeFile, content })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to save file');
      }

      setHasChanges(false);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to save file:', error);
      setError(error.message);
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }, [activeFile, content, hasChanges, saving]);

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    
    // Ctrl+S 저장 단축키 추가
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveFile();
    });
  };

  const handleEditorChange = (value) => {
    setContent(value);
    setHasChanges(true);
  };

  if (!activeFile && openFiles.length === 0) return null;

  return (
    <div style={{ 
      ...styles.container, 
      backgroundColor: theme.ui.bg,
    }}>
      {/* 탭 바 */}
      <div style={{
        display: 'flex',
        backgroundColor: theme.ui.bgSecondary,
        height: '35px',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        borderBottom: `1px solid ${theme.ui.border}`,
      }}>
        {openFiles.map((path) => {
          const isActive = path === activeFile;
          const filename = path.split('/').pop();
          return (
            <div
              key={path}
              onClick={() => onFileSelect(path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                height: '100%',
                cursor: 'pointer',
                backgroundColor: isActive ? theme.ui.bg : 'transparent',
                borderRight: `1px solid ${theme.ui.border}`,
                borderTop: isActive ? `2px solid ${theme.ui.accent}` : '2px solid transparent',
                minWidth: '100px',
                maxWidth: '200px',
                transition: 'all 0.15s ease',
                position: 'relative',
              }}
            >
              <div style={{ marginRight: '8px', display: 'flex', alignItems: 'center' }}>
                {getFileIcon(filename, theme.ui.iconColor)}
              </div>
              <span style={{ 
                fontSize: '12px', 
                color: isActive ? theme.ui.text : theme.ui.textSecondary,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                fontWeight: isActive ? '600' : '400',
              }}>
                {filename}
              </span>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(path);
                }}
                style={{
                  marginLeft: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '2px',
                  padding: '2px',
                  opacity: 0.6,
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <X size={14} />
              </div>
              {isActive && hasChanges && (
                <div style={{ 
                  position: 'absolute', 
                  bottom: '4px', 
                  right: '4px', 
                  width: '6px', 
                  height: '6px', 
                  borderRadius: '50%', 
                  backgroundColor: theme.ui.accent 
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* 액션바 (저장, 새로고침 등) */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '4px 12px', 
        backgroundColor: theme.ui.bg,
        borderBottom: `1px solid ${theme.ui.borderLight}`,
      }}>
        <div style={{ fontSize: '11px', color: theme.ui.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {activeFile}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {status === 'saved' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: theme.green, fontSize: '11px' }}>
              <CheckCircle2 size={12} /> Saved
            </div>
          )}
          <Button 
            variant="ghost" 
            size="small" 
            onClick={saveFile} 
            disabled={!hasChanges || saving || loading}
            theme={theme}
            style={{ height: '24px', fontSize: '11px', padding: '0 8px' }}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            <span>Save</span>
          </Button>
          <Button 
            variant="ghost" 
            size="small" 
            onClick={() => loadFile(activeFile)} 
            disabled={loading}
            theme={theme}
            style={{ height: '24px', padding: '0 4px' }}
            icon={RefreshCw}
          />
        </div>
      </div>

      {/* 에디터 영역 */}
      <div style={styles.content}>
        {loading ? (
          <div style={{ ...styles.message, color: theme.ui.textSecondary }}>
            <Loader2 size={32} className="animate-spin" style={{ color: theme.ui.accent, marginBottom: '12px' }} />
            <span>Loading editor...</span>
          </div>
        ) : error ? (
          <div style={{ ...styles.message, color: theme.red }}>
            <AlertCircle size={32} style={{ marginBottom: '12px' }} />
            <span style={{ marginBottom: '16px' }}>{error}</span>
            <Button theme={theme} onClick={() => loadFile(activeFile)} variant="secondary">Retry</Button>
          </div>
        ) : (
          <Editor
            height="100%"
            theme={theme.background === '#ffffff' || theme.background === '#eff1f5' ? 'light' : 'vs-dark'}
            language={getLanguage(activeFile)}
            value={content}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
            options={{
              fontSize: 14,
              fontFamily: '"JetBrains Mono", monospace',
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
              lineNumbers: 'on',
              renderWhitespace: 'selection',
              contextmenu: true,
              bracketPairColorization: { enabled: true },
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              scrollbar: {
                vertical: 'visible',
                horizontal: 'visible',
                useShadows: false,
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
              }
            }}
          />
        )}
      </div>

      {/* 푸터 */}
      <div style={{ 
        height: '22px', 
        backgroundColor: theme.ui.bgSecondary, 
        borderTop: `1px solid ${theme.ui.borderLight}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '0 12px',
        fontSize: '11px',
        color: theme.ui.textSecondary,
      }}>
        <div style={{ display: 'flex', gap: '16px' }}>
          <span>Language: <span style={{ color: theme.ui.text }}>{getLanguage(activeFile).toUpperCase()}</span></span>
          <span>UTF-8</span>
        </div>
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
  content: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  message: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
  },
};

export default FileEditor;
