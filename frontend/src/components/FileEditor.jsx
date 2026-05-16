/**
 * FileEditor 컴포넌트
 * Monaco Editor를 사용한 VSCode 수준의 멀티 탭 편집 환경 제공
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { File, X, Save, RefreshCw, CheckCircle2, AlertCircle, Loader2, FileCode, FileText, Image as ImageIcon, Eye, Edit3, GripHorizontal, GitCompare, ZoomIn, ZoomOut } from 'lucide-react';
import SkeletonRow from './common/SkeletonRow';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Button from './common/Button';
import ConfirmModal from './ConfirmModal';
import useTranslation from '../hooks/useTranslation';
import { glassPanelStyle, glassSectionStyle } from '../styles/glass';

const DIFF_VIEW_STATE_KEY = 'iterm:file-editor-diff-view:v1';

const readDiffViewState = () => {
  try {
    const raw = localStorage.getItem(DIFF_VIEW_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// 'remote:{hostId}:{absolutePath}' 형식의 파일 키를 파싱하거나 로컬 경로를 그대로 반환
const parseFileKey = (key) => {
  if (!key) return { path: null, hostId: null };
  if (key.startsWith('remote:')) {
    const rest = key.slice(7);
    const idx = rest.indexOf(':');
    if (idx < 0) return { path: rest, hostId: null };
    return { hostId: rest.slice(0, idx), path: rest.slice(idx + 1) };
  }
  return { path: key, hostId: null };
};

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
  const [rawPreviewUrl, setRawPreviewUrl] = useState(null);
  // diff 모드: { [path]: { original: string, exists: boolean, loading: boolean, error: string|null } }
  const [diffStates, setDiffStates] = useState({});
  // 변경 파일은 자동으로 diff 모드로 열되, 사용자 토글로 일반 편집 ↔ diff 전환 가능
  const [diffViewByPath, setDiffViewByPath] = useState(() => readDiffViewState()); // { [path]: boolean }

  const editorRef = useRef(null);
  const pollingRef = useRef(null);
  const binaryPathsRef = useRef(new Set());
  const [editorFontSize, setEditorFontSize] = useState(() =>
    parseInt(localStorage.getItem('editor-font-size') || '12', 10)
  );
  const changeFontSize = (delta) => setEditorFontSize((prev) => {
    const next = Math.min(24, Math.max(8, prev + delta));
    localStorage.setItem('editor-font-size', String(next));
    return next;
  });

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

  const loadFile = useCallback(async (fileKey, isSilent = false) => {
    if (!fileKey) return;
    const { path, hostId } = parseFileKey(fileKey);
    if (!path) return;
    if (!isSilent) setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('auth_token');
      const endpoint = hostId
        ? `/api/hosts/${hostId}/files/read?path=${encodeURIComponent(path)}`
        : `/api/files/read?path=${encodeURIComponent(path)}`;
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to load file');
      }

      const data = await res.json();
      binaryPathsRef.current.delete(path);
      
      setFileStates(prev => {
        const existing = prev[path];
        // 디스크와 마지막 저장 내용이 같으면 외부 변경이 없는 것 — 폴링 스킵
        if (isSilent && existing && existing.lastSavedContent === data.content) {
          return prev;
        }
        // 디스크가 마지막 저장본과 다른 케이스 = 진짜 외부 변경
        if (isSilent && existing) {
          if (existing.hasChanges) {
            // 사용자도 편집 중 + 디스크도 바뀜 → 충돌 → 모달
            setExternalChange({ isOpen: true, path, newContent: data.content });
            return prev;
          }
          // 편집 중 아님 → 조용히 새 내용으로 갱신
          return {
            ...prev,
            [path]: {
              content: data.content,
              hasChanges: false,
              lastSavedContent: data.content,
            },
          };
        }
        // 처음 로드 또는 명시적 reload
        return {
          ...prev,
          [path]: {
            content: data.content,
            hasChanges: false,
            lastSavedContent: data.content,
          },
        };
      });
    } catch (error) {
      const isBinaryFile = /binary file not supported/i.test(error.message || '');
      if (isBinaryFile) {
        binaryPathsRef.current.add(path);
      } else {
        console.error('Failed to load file:', error);
      }

      if (!isSilent) {
        setError(isBinaryFile ? 'Binary file cannot be opened in the editor.' : error.message);
      }
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  // git HEAD 시점 원본 로드 — diff 좌측에 사용. 리모트 파일 및 404/저장소 없음 등은 조용히 무시.
  const loadOriginalContent = useCallback(async (fileKey) => {
    if (!fileKey) return;
    const { path, hostId } = parseFileKey(fileKey);
    if (!path || hostId) return; // 리모트 파일은 git diff 미지원
    setDiffStates(prev => ({ ...prev, [path]: { ...(prev[path] || {}), loading: true, error: null } }));
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/git/file-content?path=${encodeURIComponent(path)}&ref=HEAD`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setDiffStates(prev => ({ ...prev, [path]: { original: '', exists: false, loading: false, error: null } }));
        return;
      }
      const data = await res.json();
      setDiffStates(prev => ({ ...prev, [path]: { original: data.content || '', exists: !!data.exists, loading: false, error: null } }));
    } catch (e) {
      setDiffStates(prev => ({ ...prev, [path]: { original: '', exists: false, loading: false, error: String(e?.message || e) } }));
    }
  }, []);

  const { path: activeFilePath, hostId: activeFileHostId } = parseFileKey(activeFile || '');
  const isImage = /\.(png|jpg|jpeg|gif|svg|ico|webp)$/i.test(activeFilePath || activeFile || '');
  const isMarkdown = (activeFilePath || activeFile)?.endsWith('.md');
  const isHtml = (activeFilePath || activeFile)?.endsWith('.html');
  const rawPreviewPath = !activeFileHostId && (isImage || (isPreviewMode && isHtml))
    ? (activeFilePath || activeFile)
    : null;

  // Poll for external changes every 5 seconds (only for text files)
  useEffect(() => {
    if (activeFile && !isImage && !binaryPathsRef.current.has(activeFile)) {
      pollingRef.current = setInterval(() => {
        loadFile(activeFile, true);
      }, 5000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeFile, loadFile, isImage]);

  useEffect(() => {
    if (activeFile && !fileStates[activeFile] && !binaryPathsRef.current.has(activeFile)) {
      // Don't try to load binary images into state
      if (!isImage) {
        loadFile(activeFile);
      }
    }
  }, [activeFile, loadFile, isImage]); // Added isImage to dependency array

  useEffect(() => {
    setIsPreviewMode(false);
  }, [activeFile]);

  useEffect(() => {
    try {
      localStorage.setItem(DIFF_VIEW_STATE_KEY, JSON.stringify(diffViewByPath));
    } catch { /* ignore storage quota/private mode */ }
  }, [diffViewByPath]);

  useEffect(() => {
    let cancelled = false;
    if (!rawPreviewPath) {
      setRawPreviewUrl(null);
      return undefined;
    }

    const loadRawPreviewTicket = async () => {
      try {
        const authToken = localStorage.getItem('auth_token');
        const res = await fetch('/api/files/raw-ticket', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ path: rawPreviewPath }),
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.detail || 'Failed to create file preview ticket');
        }
        const data = await res.json();
        if (!cancelled) {
          setRawPreviewUrl(`/api/files/raw?ticket=${encodeURIComponent(data.ticket)}&_t=${Date.now()}`);
        }
      } catch (error) {
        if (!cancelled) {
          setRawPreviewUrl(null);
          setError(error.message || 'Failed to create file preview ticket');
        }
      }
    };

    loadRawPreviewTicket();
    return () => {
      cancelled = true;
    };
  }, [rawPreviewPath]);

  // 활성 파일이 바뀌면 HEAD 원본을 lazy load. 변경분이 있으면 diff 모드로 자동 진입.
  useEffect(() => {
    if (!activeFile || isImage || binaryPathsRef.current.has(activeFile)) return;
    if (diffStates[activeFile]) return; // 이미 로드됨
    loadOriginalContent(activeFile);
  }, [activeFile, isImage, loadOriginalContent, diffStates]);

  // HEAD 원본이 들어왔고 현재 파일 내용과 다르면, 사용자가 명시적으로 끄지 않은 한 diff 자동 ON.
  useEffect(() => {
    if (!activeFile) return;
    const ds = diffStates[activeFile];
    const fs = fileStates[activeFile];
    if (!ds || ds.loading || !fs) return;
    if (diffViewByPath[activeFile] !== undefined) return; // 사용자 결정 존중
    const changed = ds.exists && ds.original !== fs.lastSavedContent;
    if (changed) setDiffViewByPath(prev => ({ ...prev, [activeFile]: true }));
  }, [activeFile, diffStates, fileStates, diffViewByPath]);

  const isDiffView = !!diffViewByPath[activeFile] && !!diffStates[activeFile]?.exists;
  const toggleDiffView = useCallback(() => {
    if (!activeFile) return;
    setDiffViewByPath(prev => ({ ...prev, [activeFile]: !prev[activeFile] }));
  }, [activeFile]);

  const saveFile = useCallback(async () => {
    if (!hasChanges || saving || !activeFile) return;
    setSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem('auth_token');
      const { path: savePath, hostId: saveHostId } = parseFileKey(activeFile);
      const endpoint = saveHostId ? `/api/hosts/${saveHostId}/files/write` : '/api/files/write';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ path: savePath, content })
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
      // 저장 후엔 디스크가 바뀐 것이라 HEAD 와의 diff도 최신화 필요 — 백그라운드 재로드
      loadOriginalContent(activeFile);
      setTimeout(() => setStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to save file:', error);
      setError(error.message);
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }, [activeFile, content, hasChanges, saving, loadOriginalContent]);

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.focus();
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

  if (!theme || !theme.ui) return null;
  if (!activeFile && openFiles.length === 0) return null;
  const editorGlassUi = {
    base: theme.ui.bg,
    surface0: theme.ui.bgSecondary || theme.ui.bg,
    surface1: theme.ui.bgTertiary || theme.ui.bgSecondary || theme.ui.bg,
    border: theme.ui.border,
    borderStrong: theme.ui.borderLight || theme.ui.border,
  };
  const editorSection = glassSectionStyle(editorGlassUi);

  return (
    <div
      style={{
        ...styles.container,
        ...glassPanelStyle(editorGlassUi, { boxShadow: 'none', borderRadius: 0 }),
        backgroundColor: undefined,
      }}
      onMouseEnter={() => editorRef.current?.focus()}
    >
      {/* 탭 바 — 메인 TabBar 의 폴더탭 스타일과 동일 */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        height: '32px',
        minHeight: '32px',
        maxHeight: '32px',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        background: editorSection.background,
        borderBottom: `1px solid ${editorSection.borderColor}`,
        gap: 0,
      }}>
        {openFiles.map((path) => {
          const isActive = path === activeFile;
          const { path: filePath } = parseFileKey(path);
          const filename = (filePath || path).split('/').pop();
          const fileHasChanges = fileStates[path]?.hasChanges;
          const dotColor = theme.ui.accent || '#89b4fa';
          const inactiveBg = `color-mix(in srgb, ${theme.ui.bgSecondary || theme.ui.bg} 70%, transparent)`;
          const activeBg = `color-mix(in srgb, ${theme.ui.bg} 86%, transparent)`;
          const hoverBg = `color-mix(in srgb, ${theme.ui.bgTertiary || theme.ui.bgSecondary || theme.ui.bg} 84%, ${dotColor} 8%)`;

          return (
            <div
              key={path}
              onClick={() => onFileSelect(path)}
              onAuxClick={(e) => {
                if (e.button === 1) { e.preventDefault(); handleCloseClick(path); }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0 8px 0 10px',
                height: 'calc(100% + 1px)',
                cursor: 'pointer',
                background: isActive ? activeBg : inactiveBg,
                color: isActive ? theme.ui.text : theme.ui.textSecondary,
                fontWeight: isActive ? 600 : 400,
                border: `1px solid ${editorSection.borderColor}`,
                borderTop: isActive ? `2px solid ${dotColor}` : `1px solid ${editorSection.borderColor}`,
                borderBottom: `1px solid ${isActive ? activeBg : inactiveBg}`,
                borderRadius: 0,
                minWidth: '80px',
                maxWidth: '180px',
                flexShrink: 0,
                flex: '1 1 auto',
                marginLeft: '-1px',
                boxSizing: 'border-box',
                userSelect: 'none',
                transform: 'translateY(0)',
                boxShadow: isActive ? `inset 0 1px 0 ${dotColor}33` : 'none',
                transition: 'background 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = hoverBg;
                e.currentTarget.style.color = theme.ui.text;
                e.currentTarget.style.borderColor = dotColor;
                e.currentTarget.style.boxShadow = `inset 0 1px 0 ${dotColor}44, 0 0 0 1px ${dotColor}18`;
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isActive ? activeBg : inactiveBg;
                e.currentTarget.style.color = isActive ? theme.ui.text : theme.ui.textSecondary;
                e.currentTarget.style.borderColor = editorSection.borderColor;
                e.currentTarget.style.boxShadow = isActive ? `inset 0 1px 0 ${dotColor}33` : 'none';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px',
                flexShrink: 0,
                color: isActive ? theme.ui.text : dotColor,
                opacity: isActive ? 1 : 0.75,
              }}>
                {getFileIcon(filename, isActive ? theme.ui.text : dotColor)}
                {fileHasChanges && (
                  <span style={{
                    position: 'absolute',
                    top: '-3px',
                    right: '-3px',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: dotColor,
                    boxShadow: `0 0 0 1.5px ${activeBg}`,
                    pointerEvents: 'none',
                  }} />
                )}
              </span>
              <span style={{
                fontSize: '11px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
                fontFamily: theme.ui.fontFamily,
              }}>
                {filename}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); handleCloseClick(path); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = isActive ? '0.65' : '0.45'; }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '14px',
                  height: '14px',
                  flexShrink: 0,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '3px',
                  padding: 0,
                  cursor: 'pointer',
                  color: theme.ui.textSecondary,
                  opacity: isActive ? 0.65 : 0.45,
                  transition: 'opacity 120ms, background 120ms',
                }}
              >
                <X size={9} strokeWidth={2} />
              </button>
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
        background: editorSection.background,
        borderBottom: `1px solid ${editorSection.borderColor}`,
        backdropFilter: 'blur(10px)',
      }}>
        <div style={{ fontSize: '11px', color: theme.ui.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {activeFileHostId ? `[remote] ${activeFilePath}` : (activeFilePath || activeFile)}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {diffStates[activeFile]?.exists && diffStates[activeFile]?.original !== currentFileState.lastSavedContent && (
            <Button
              variant="ghost"
              size="small"
              onClick={toggleDiffView}
              theme={theme}
              style={{ height: '24px', fontSize: '11px', padding: '0 8px' }}
              icon={GitCompare}
            >
              <span>{isDiffView ? (t('edit') || 'Edit') : (t('viewDiff') || 'Diff')}</span>
            </Button>
          )}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', borderLeft: `1px solid ${editorSection.borderColor}`, paddingLeft: '8px', marginLeft: '4px' }}>
            <button onClick={() => changeFontSize(-1)} title="Decrease font size" style={styles.fsBtnStyle(theme)}>
              <ZoomOut size={11} strokeWidth={2} />
            </button>
            <span style={{ fontSize: '10px', color: theme.ui.textSecondary, minWidth: '20px', textAlign: 'center', fontFamily: 'monospace' }}>{editorFontSize}</span>
            <button onClick={() => changeFontSize(1)} title="Increase font size" style={styles.fsBtnStyle(theme)}>
              <ZoomIn size={11} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>

      {/* 에디터 영역 */}
      <div style={styles.content}>
        {loading && !content && !isImage ? (
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[80, 60, 72, 45, 90, 55, 68, 40, 78, 50].map((w, i) => (
              <SkeletonRow key={i} width={`${w}%`} height="13px" style={{ marginLeft: i % 3 === 1 ? '16px' : i % 3 === 2 ? '32px' : '0' }} />
            ))}
          </div>
        ) : error ? (
          <div style={{ ...styles.message, color: theme.red }}>
            <AlertCircle size={32} style={{ marginBottom: '12px' }} />
            <span style={{ marginBottom: '16px' }}>{error}</span>
            <Button theme={theme} onClick={() => loadFile(activeFile)} variant="secondary">{t('reset')}</Button>
          </div>
        ) : isImage ? (
          activeFileHostId ? (
            <div style={{ ...styles.message, color: theme.ui.textSecondary }}>
              <span>Remote image preview is not supported.</span>
            </div>
          ) : (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `color-mix(in srgb, ${theme.ui.bgSecondary || theme.ui.bg} 70%, transparent)`,
            overflow: 'auto',
            padding: '20px'
          }}>
            {rawPreviewUrl ? (
              <img
                src={rawPreviewUrl}
                alt={activeFilePath || activeFile}
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
            ) : (
              <Loader2 size={28} className="spin" color={theme.ui.textSecondary} />
            )}
          </div>
          )
        ) : isPreviewMode ? (
          isMarkdown ? (
            <div style={{
              height: '100%',
              overflowY: 'auto',
              padding: '20px 40px',
              color: theme.ui.text,
              background: `color-mix(in srgb, ${theme.ui.bg} 82%, transparent)`,
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
            activeFileHostId ? (
              <div style={{ ...styles.message, color: theme.ui.textSecondary }}>
                <span>Remote HTML preview is not supported.</span>
              </div>
            ) : rawPreviewUrl ? (
              <iframe
                src={rawPreviewUrl}
                style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#fff' }}
                title={t('htmlPreview') || 'HTML Preview'}
              />
            ) : (
              <div style={styles.message}>
                <Loader2 size={28} className="spin" color={theme.ui.textSecondary} />
              </div>
            )
          )
        ) : isDiffView ? (
          <DiffEditor
            height="100%"
            theme={theme.background === '#ffffff' || theme.background === '#eff1f5' ? 'light' : 'vs-dark'}
            language={getLanguage(activeFile)}
            original={diffStates[activeFile]?.original || ''}
            modified={content}
            options={{
              fontSize: editorFontSize,
              fontFamily: '"JetBrains Mono", monospace',
              automaticLayout: true,
              renderSideBySide: true,
              originalEditable: false,
              readOnly: true,
              wordWrap: 'on',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              renderOverviewRuler: false,
              diffWordWrap: 'on',
            }}
          />
        ) : (
          <Editor
            height="100%"
            theme={theme.background === '#ffffff' || theme.background === '#eff1f5' ? 'light' : 'vs-dark'}
            language={getLanguage(activeFile)}
            value={content}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
            options={{
              fontSize: editorFontSize,
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
              preventDefault: () => {},
              clientY: touch.clientY,
              cancelable: false,
              isTouch: true
            };
            onResizeStart(simulatedEvent);
          }
        }}
        style={{ 
          height: '24px', 
          background: editorSection.background,
          borderTop: `1px solid ${editorSection.borderColor}`,
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
  fsBtnStyle: (theme) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    background: 'transparent',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
    color: theme.ui.textSecondary,
    padding: 0,
  }),
};

export default FileEditor;
