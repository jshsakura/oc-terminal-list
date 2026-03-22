/**
 * FileEditor 컴포넌트
 * Monaco Editor를 사용한 VSCode 수준의 멀티 탭 편집 환경 제공
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { File, X, Save, RefreshCw, CheckCircle2, AlertCircle, Loader2, FileCode, FileText, Image as ImageIcon, Eye, Edit3, GripHorizontal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Button from './common/Button';
import ConfirmModal from './ConfirmModal';
import useTranslation from '../hooks/useTranslation';

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

const FileEditor = ({ activeFile, openFiles, onFileSelect, onClose, theme, language = 'en', onResizeStart }) => {
  const { t } = useTranslation(language);
  const [fileStates, setFileStates] = useState({}); // { path: { content, hasChanges, lastSavedContent } }
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'saved' | 'error'
  const [confirmClose, setConfirmClose] = useState({ isOpen: false, path: null });
  const [externalChange, setExternalChange] = useState({ isOpen: false, path: null, newContent: '' });
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  
  const editorRef = useRef(null);
  const pollingRef = useRef(null);

  const currentFileState = fileStates[activeFile] || { content: '', hasChanges: false, lastSavedContent: '' };
  const content = currentFileState.content;
  const hasChanges = currentFileState.hasChanges;

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

  const loadFile = useCallback(async (path, isSilent = false) => {
    if (!path) return;
    if (!isSilent) setLoading(true);
    setError(null);

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
      
      setFileStates(prev => {
        // If we already have changes for this file, don't overwrite silently
        if (isSilent && prev[path]?.hasChanges && prev[path]?.content !== data.content) {
          setExternalChange({ isOpen: true, path, newContent: data.content });
          return prev;
        }

        return {
          ...prev,
          [path]: {
            content: data.content,
            hasChanges: false,
            lastSavedContent: data.content
          }
        };
      });
    } catch (error) {
      console.error('Failed to load file:', error);
      if (!isSilent) setError(error.message);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  const isImage = /\.(png|jpg|jpeg|gif|svg|ico|webp)$/i.test(activeFile || '');
  
  if (!theme || !theme.ui) return null;
  
  const isLightTheme = theme.background === '#ffffff' || theme.background === '#fdf6e3' || theme.background === '#fbf1c7';

  // Poll for external changes every 5 seconds (only for text files)
  useEffect(() => {
    if (activeFile && !isImage) {
      pollingRef.current = setInterval(() => {
        loadFile(activeFile, true);
      }, 5000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeFile, loadFile, isImage]);

  useEffect(() => {
    if (activeFile && !fileStates[activeFile]) {
      // Don't try to load binary images into state
      if (!isImage) {
        loadFile(activeFile);
      }
    }
  }, [activeFile, loadFile, isImage]); // Added isImage to dependency array

  useEffect(() => {
    setIsPreviewMode(false);
  }, [activeFile]);

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

      setFileStates(prev => ({
        ...prev,
        [activeFile]: {
          ...prev[activeFile],
          hasChanges: false,
          lastSavedContent: content
        }
      }));
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
    setFileStates(prev => ({
      ...prev,
      [activeFile]: {
        ...prev[activeFile],
        content: value,
        hasChanges: value !== prev[activeFile]?.lastSavedContent
      }
    }));
  };

  const handleCloseClick = (path) => {
    if (fileStates[path]?.hasChanges) {
      setConfirmClose({ isOpen: true, path });
    } else {
      onClose(path);
    }
  };

  const confirmCloseFile = () => {
    const path = confirmClose.path;
    setConfirmClose({ isOpen: false, path: null });
    // Remove state for this file
    setFileStates(prev => {
      const newState = { ...prev };
      delete newState[path];
      return newState;
    });
    onClose(path);
  };

  const handleReload = () => {
    const path = externalChange.path;
    const newContent = externalChange.newContent;
    setExternalChange({ isOpen: false, path: null, newContent: '' });
    setFileStates(prev => ({
      ...prev,
      [path]: {
        content: newContent,
        hasChanges: false,
        lastSavedContent: newContent
      }
    }));
  };

  const isMarkdown = activeFile?.endsWith('.md');
  const isHtml = activeFile?.endsWith('.html');
  const token = localStorage.getItem('auth_token');

  if (!activeFile && openFiles.length === 0) return null;

  return (
    <div style={{ 
      ...styles.container, 
      backgroundColor: theme.ui.bg,
    }}>
      {/* 탭 바 */}
      <div style={{
        display: 'flex',
        backgroundColor: theme.ui.glassBg || (isLightTheme ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0,0,0,0.3)'),
        backdropFilter: isLightTheme ? 'blur(10px)' : 'blur(12px) saturate(180%)',
        WebkitBackdropFilter: isLightTheme ? 'blur(10px)' : 'blur(12px) saturate(180%)',
        height: '40px',
        minHeight: '40px',
        maxHeight: '40px',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        borderBottom: `1px solid ${theme.ui.borderLight || theme.ui.border}`,
      }}>        {openFiles.map((path) => {
          const isActive = path === activeFile;
          const filename = path.split('/').pop();
          const fileHasChanges = fileStates[path]?.hasChanges;

          return (
            <div
              key={path}
              onClick={() => onFileSelect(path)}
              onAuxClick={(e) => {
                if (e.button === 1) { // Middle click
                  e.preventDefault();
                  handleCloseClick(path);
                }
              }}
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
                  handleCloseClick(path);
                }}
                style={{
                  marginLeft: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '2px',
                  padding: '2px',
                  opacity: 0.6,
                  color: isActive ? theme.ui.text : theme.ui.textSecondary,
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <X size={14} />
              </div>
              {fileHasChanges && (
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
        backdropFilter: 'blur(10px)',
      }}>
        <div style={{ fontSize: '11px', color: theme.ui.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {activeFile}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {(isMarkdown || isHtml) && (
            <Button 
              variant="ghost" 
              size="small" 
              onClick={() => setIsPreviewMode(!isPreviewMode)}
              theme={theme}
              style={{ height: '24px', fontSize: '11px', padding: '0 8px' }}
              icon={isPreviewMode ? Edit3 : Eye}
            >
              <span>{isPreviewMode ? t('edit') : t('preview')}</span>
            </Button>
          )}
          {status === 'saved' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: theme.green, fontSize: '11px' }}>
              <CheckCircle2 size={12} /> {t('settingsSaved')}
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
            <span>{t('save')}</span>
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
        {loading && !content && !isImage ? (
          <div style={{ ...styles.message, color: theme.ui.textSecondary }}>
            <Loader2 size={32} className="animate-spin" style={{ color: theme.ui.accent, marginBottom: '12px' }} />
            <span>{t('loading')}</span>
          </div>
        ) : error ? (
          <div style={{ ...styles.message, color: theme.red }}>
            <AlertCircle size={32} style={{ marginBottom: '12px' }} />
            <span style={{ marginBottom: '16px' }}>{error}</span>
            <Button theme={theme} onClick={() => loadFile(activeFile)} variant="secondary">{t('reset')}</Button>
          </div>
        ) : isImage ? (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.ui.bgSecondary,
            overflow: 'auto',
            padding: '20px'
          }}>
            <img 
              src={`/api/files/raw?path=${encodeURIComponent(activeFile)}&token=${token}&_t=${Date.now()}`} 
              alt={activeFile}
              style={{ 
                maxWidth: '100%', 
                maxHeight: '100%', 
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                backgroundColor: '#fff', // Checkerboard transparency helper could be added here
                backgroundImage: 'linear-gradient(45deg, #eee 25%, transparent 25%, transparent 75%, #eee 75%, #eee), linear-gradient(45deg, #eee 25%, transparent 25%, transparent 75%, #eee 75%, #eee)',
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 10px 10px'
              }}
            />
          </div>
        ) : isPreviewMode ? (
          isMarkdown ? (
            <div style={{
              height: '100%',
              overflowY: 'auto',
              padding: '20px 40px',
              color: theme.ui.text,
              backgroundColor: theme.ui.bg,
              lineHeight: '1.6'
            }}>
              <div className="markdown-preview" style={{ maxWidth: '800px', margin: '0 auto' }}>
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({node, ...props}) => <h1 style={{ borderBottom: `1px solid ${theme.ui.borderLight}`, paddingBottom: '0.3em', marginBottom: '16px', fontWeight: 'bold', fontSize: '2em' }} {...props} />,
                    h2: ({node, ...props}) => <h2 style={{ borderBottom: `1px solid ${theme.ui.borderLight}`, paddingBottom: '0.3em', marginBottom: '16px', fontWeight: 'bold', fontSize: '1.5em' }} {...props} />,
                    h3: ({node, ...props}) => <h3 style={{ fontWeight: 'bold', fontSize: '1.25em', marginBottom: '12px' }} {...props} />,
                    p: ({node, ...props}) => <p style={{ marginBottom: '16px' }} {...props} />,
                    code: ({node, inline, ...props}) => 
                      inline ? 
                      <code style={{ backgroundColor: theme.ui.bgTertiary, padding: '2px 4px', borderRadius: '4px', fontSize: '0.9em' }} {...props} /> :
                      <pre style={{ backgroundColor: theme.ui.bgTertiary, padding: '16px', borderRadius: '8px', overflow: 'auto', marginBottom: '16px' }}>
                        <code style={{ fontSize: '0.9em' }} {...props} />
                      </pre>,
                    blockquote: ({node, ...props}) => <blockquote style={{ borderLeft: `4px solid ${theme.ui.accent}`, paddingLeft: '16px', color: theme.ui.textSecondary, margin: '16px 0', fontStyle: 'italic' }} {...props} />,
                    table: ({node, ...props}) => <table style={{ borderCollapse: 'collapse', width: '100%', margin: '16px 0' }} {...props} />,
                    th: ({node, ...props}) => <th style={{ border: `1px solid ${theme.ui.borderLight}`, padding: '8px 12px', backgroundColor: theme.ui.bgSecondary, textAlign: 'left' }} {...props} />,
                    td: ({node, ...props}) => <td style={{ border: `1px solid ${theme.ui.borderLight}`, padding: '8px 12px' }} {...props} />,
                    ul: ({node, ...props}) => <ul style={{ paddingLeft: '2em', marginBottom: '16px', listStyleType: 'disc' }} {...props} />,
                    ol: ({node, ...props}) => <ol style={{ paddingLeft: '2em', marginBottom: '16px', listStyleType: 'decimal' }} {...props} />,
                    li: ({node, ...props}) => <li style={{ marginBottom: '4px' }} {...props} />,
                    a: ({node, ...props}) => <a style={{ color: theme.ui.accent, textDecoration: 'none' }} target="_blank" rel="noopener noreferrer" {...props} />,
                    img: ({node, ...props}) => <img style={{ maxWidth: '100%', borderRadius: '4px' }} {...props} />,
                  }}
                >
                  {content}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <iframe 
              src={`/api/files/raw?path=${encodeURIComponent(activeFile)}&_t=${Date.now()}`}
              style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#fff' }}
              title="HTML Preview"
            />
          )
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
              bracketPairColorization: { 
                enabled: true,
                independentColorPoolPerBracketType: true 
              },
              guides: {
                bracketPairs: true,
                bracketPairsHorizontal: 'active',
                indentation: true,
                highlightActiveIndentation: true,
              },
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

      {/* 푸터 (드래그 가능한 리사이저 역할 겸용) */}
      <div 
        onMouseDown={onResizeStart}
        onTouchStart={(e) => {
          if (onResizeStart) {
            const touch = e.touches[0];
            const simulatedEvent = {
              preventDefault: () => e.preventDefault(),
              clientY: touch.clientY,
              isTouch: true
            };
            onResizeStart(simulatedEvent);
          }
        }}
        style={{ 
          height: '24px', 
          backgroundColor: theme.ui.bgSecondary, 
          borderTop: `1px solid ${theme.ui.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          fontSize: '11px',
          color: theme.ui.textSecondary,
          cursor: 'row-resize',
          userSelect: 'none',
          position: 'relative',
          zIndex: 100,
          boxShadow: '0 -2px 10px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <GripHorizontal size={14} style={{ opacity: 0.5 }} />
          <span>{t('language')}: <span style={{ color: theme.ui.text }}>{getLanguage(activeFile).toUpperCase()}</span></span>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <span>UTF-8</span>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmClose.isOpen}
        title={t('unsavedChanges')}
        message={t('unsavedChangesMessage')}
        confirmText={t('close')}
        cancelText={t('cancel')}
        onConfirm={confirmCloseFile}
        onCancel={() => setConfirmClose({ isOpen: false, path: null })}
        theme={theme}
        danger={true}
        language={language}
      />

      <ConfirmModal
        isOpen={externalChange.isOpen}
        title={t('externalChangeDetected')}
        message={t('externalChangeMessage')}
        confirmText={t('reload')}
        cancelText={t('keepMine')}
        onConfirm={handleReload}
        onCancel={() => setExternalChange({ isOpen: false, path: null, newContent: '' })}
        theme={theme}
        language={language}
      />
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
