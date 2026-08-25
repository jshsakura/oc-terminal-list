/**
 * FileEditor 컴포넌트
 * Monaco Editor를 사용한 VSCode 수준의 멀티 탭 편집 환경 제공
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { setupMonaco } from '../setupMonaco';
import { Save, RefreshCw, CheckCircle2, AlertCircle, Loader2, Eye, Edit3, GripHorizontal, GitCompare, ZoomIn, ZoomOut, AlignLeft } from 'lucide-react';

// 워커 환경 + loader 를 번들 monaco 로 고정. 이 모듈(=FileEditor 청크)이 로드되는 시점에 1회 실행되며,
// 아래 <Editor> 가 mount 되어 loader.init() 하기 전에 끝나야 CDN 폴백 없이 셀프호스트 monaco 를 쓴다.
setupMonaco();
import SkeletonRow from './common/SkeletonRow';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Button from './common/Button';
import ConfirmModal from './ConfirmModal';
import useTranslation from '../hooks/useTranslation';
import { glassPanelStyle, glassSectionStyle } from '../styles/glass';
import { authHeaders } from '../utils/auth';
import { isImageFile, isPdfFile, isVideoFile, isAudioFile, isSheetFile, isDelimitedFile, isRemoteInlinePreviewFile } from '../utils/fileTypes';
import DataTable from './fileEditor/DataTable';
import { loadWorkbook, WorkbookTooLargeError } from './fileEditor/loadWorkbook';
import { detectDelimiter, parseDelimited } from '../utils/delimitedTable';
import { DIFF_VIEW_STATE_KEY, readDiffViewState, parseFileKey } from './fileEditor/fileEditorHelpers';
import { styles } from './fileEditor/fileEditorStyles';
import { canFormatLanguage } from '../utils/formatSupport';
import { monacoLanguageForFile } from '../utils/fileTypes';
import { FileEditorTabs } from './fileEditor/FileEditorTabs';


// confirmClose.path 자리에 들어가는 "전체" 표식 — 경로와 절대 겹치지 않는 값.
const CLOSE_ALL = Symbol('close-all');

/* 외부 변경 감시 주기. 원격이 긴 이유는 폴 하나가 SSH 왕복이기 때문이다 — 로컬 디스크
   읽기와 같은 값을 쓰면 남의 기계로 분당 12회가 나간다. */
const LOCAL_POLL_MS = 5000;
const REMOTE_POLL_MS = 30000;

const FileEditor = ({ activeFile, openFiles, onFileSelect, onClose, onCloseAll = null, theme, language = 'en', onResizeStart }) => {
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
  // 원격 미리보기는 호스트가 꺼져 있을 수 있다 — 깨진 이미지 아이콘 대신 이유를 적는다.
  const [rawPreviewError, setRawPreviewError] = useState(false);
  // 스프레드시트(.xlsx) 표: { loading, sheets, errorCode }
  const [sheetState, setSheetState] = useState({ loading: false, sheets: null, errorCode: null });
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
  // 확장자 → Monaco 언어. 매핑은 utils/fileTypes.js 가 소유(테스트 있음).
  const getLanguage = useCallback((path) => monacoLanguageForFile(path), []);

  const loadFile = useCallback(async (fileKey, isSilent = false) => {
    if (!fileKey) return;
    const { path, hostId } = parseFileKey(fileKey);
    if (!path) return;
    if (!isSilent) setLoading(true);
    setError(null);

    try {
      /* ⚠️ 상태 키는 **fileKey** 다. `path` 가 아니다.
         나머지 전부(저장·편집·닫기·diff)가 `fileStates[activeFile]` 로 읽고 쓰는데
         여기서만 `path` 로 썼다. 로컬은 fileKey === path 라 우연히 맞았고, **원격만**
         `remote:<host>:<path>` ≠ `<path>` 로 어긋나 저장한 내용을 아무도 못 찾았다.
         결과: 읽기는 200 인데 에디터가 빈 화면. 게다가 "아직 안 읽었다" 판정이
         영원히 참이라 5초마다 SSH 왕복을 다시 태웠다. */
      const endpoint = hostId
        ? `/api/hosts/${hostId}/files/read?path=${encodeURIComponent(path)}`
        : `/api/files/read?path=${encodeURIComponent(path)}`;
      const res = await fetch(endpoint, {
        headers: authHeaders()
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Failed to load file');
      }

      const data = await res.json();
      binaryPathsRef.current.delete(fileKey);

      setFileStates(prev => {
        const existing = prev[fileKey];
        // 디스크와 마지막 저장 내용이 같으면 외부 변경이 없는 것 — 폴링 스킵
        if (isSilent && existing && existing.lastSavedContent === data.content) {
          return prev;
        }
        // 디스크가 마지막 저장본과 다른 케이스 = 진짜 외부 변경
        if (isSilent && existing) {
          if (existing.hasChanges) {
            // 사용자도 편집 중 + 디스크도 바뀜 → 충돌 → 모달
            setExternalChange({ isOpen: true, path: fileKey, newContent: data.content });
            return prev;
          }
          // 편집 중 아님 → 조용히 새 내용으로 갱신
          return {
            ...prev,
            [fileKey]: {
              content: data.content,
              hasChanges: false,
              lastSavedContent: data.content,
            },
          };
        }
        // 처음 로드 또는 명시적 reload
        return {
          ...prev,
          [fileKey]: {
            content: data.content,
            hasChanges: false,
            lastSavedContent: data.content,
          },
        };
      });
    } catch (error) {
      const isBinaryFile = /binary file not supported/i.test(error.message || '');
      if (isBinaryFile) {
        binaryPathsRef.current.add(fileKey);
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

  /* git HEAD 시점 원본 로드 — diff 좌측에 사용. 리모트 파일 및 404/저장소 없음 등은 조용히 무시.
     ⚠️ 여기서도 상태 키는 **fileKey** 다. 지금은 원격이 위에서 걸러져 fileKey === path 라
     티가 안 나지만, 읽는 쪽은 `diffStates[activeFile]` 이다 — loadFile 이 이 함정에
     정확히 이렇게 빠져서 원격 에디터가 빈 화면이었다. 같은 실수를 남겨두지 않는다. */
  const loadOriginalContent = useCallback(async (fileKey) => {
    if (!fileKey) return;
    const { path, hostId } = parseFileKey(fileKey);
    if (!path || hostId) return; // 리모트 파일은 git diff 미지원
    setDiffStates(prev => ({ ...prev, [fileKey]: { ...(prev[fileKey] || {}), loading: true, error: null } }));
    try {
      const res = await fetch(`/api/git/file-content?path=${encodeURIComponent(path)}&ref=HEAD`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setDiffStates(prev => ({ ...prev, [fileKey]: { original: '', exists: false, loading: false, error: null } }));
        return;
      }
      const data = await res.json();
      setDiffStates(prev => ({ ...prev, [fileKey]: { original: data.content || '', exists: !!data.exists, loading: false, error: null } }));
    } catch (e) {
      setDiffStates(prev => ({ ...prev, [fileKey]: { original: '', exists: false, loading: false, error: String(e?.message || e) } }));
    }
  }, []);

  const { path: activeFilePath, hostId: activeFileHostId } = parseFileKey(activeFile || '');
  const previewName = activeFilePath || activeFile || '';
  const isImage = isImageFile(previewName);
  const isPdf = isPdfFile(previewName);
  const isVideo = isVideoFile(previewName);
  const isAudio = isAudioFile(previewName);
  const isSheet = isSheetFile(previewName);          // xlsx — 바이너리라 표로만 본다
  const isDelimited = isDelimitedFile(previewName);  // csv/tsv — 편집 + 표 토글
  // 원격은 백엔드가 인라인 렌더를 미디어로 제한한다(svg 제외). 거부될 것을 그리려 하지 말고
  // 텍스트로 열어준다 — 원격 svg 는 Monaco 에서 xml 로 보이는 편이 낫다.
  const canInlineHere = !activeFileHostId || isRemoteInlinePreviewFile(previewName);
  const isInlineMedia = (isImage || isPdf || isVideo || isAudio) && canInlineHere;
  // 텍스트 에디터로 읽지 않는 것들 — 미디어(raw 로 직접 렌더) + 스프레드시트(표로 파싱).
  const isBinaryPreview = isInlineMedia || isSheet;
  const isMarkdown = (activeFilePath || activeFile)?.endsWith('.md');
  const isHtml = (activeFilePath || activeFile)?.endsWith('.html');
  // HTML 은 로컬만. 원격 파일을 same-origin 문서로 띄우면 그대로 XSS 이므로 백엔드의
  // raw 라우트도 미디어 타입만 통과시킨다 (routes/host_files.inline_media_type).
  const rawPreviewPath = (isInlineMedia || (isPreviewMode && isHtml && !activeFileHostId))
    ? (activeFilePath || activeFile)
    : null;
  const rawPreviewHostId = rawPreviewPath ? activeFileHostId : null;

  /* 외부 변경 감시 — 텍스트 파일만.
   *
   * ⚠️ **원격은 한 번의 폴이 SSH/SFTP 왕복이다.** 로컬 디스크 읽기와 같은 주기로 두면
   * 파일 하나당 분당 12회가 그 호스트로 나가고, 이 저장소가 계속 줄여 온 공유 터널을 탄다.
   * 그래서 원격은 간격을 늘린다 — 남의 기계 파일이 초 단위로 바뀌는 일은 드물고,
   * 바뀌었다면 늦게 알아도 저장 시점의 충돌 모달이 잡는다.
   *
   * 그리고 **탭이 안 보이면 아예 멈춘다.** 안 보는 화면을 최신으로 유지할 이유가 없다
   * (밤새 켜둔 탭이 조용히 왕복을 태우던 이 저장소의 단골 병).
   */
  useEffect(() => {
    if (!activeFile || isBinaryPreview || binaryPathsRef.current.has(activeFile)) return undefined;
    const intervalMs = activeFileHostId ? REMOTE_POLL_MS : LOCAL_POLL_MS;
    const arm = () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (typeof document !== 'undefined' && document.hidden) return;
      pollingRef.current = setInterval(() => { loadFile(activeFile, true); }, intervalMs);
    };
    arm();
    document.addEventListener('visibilitychange', arm);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      document.removeEventListener('visibilitychange', arm);
    };
  }, [activeFile, loadFile, isBinaryPreview, activeFileHostId]);

  useEffect(() => {
    if (activeFile && !fileStates[activeFile] && !binaryPathsRef.current.has(activeFile)) {
      // Don't try to load binary previews (image/pdf/video/audio) into text state
      if (!isBinaryPreview) {
        loadFile(activeFile);
      }
    }
  }, [activeFile, loadFile, isBinaryPreview]);

  useEffect(() => {
    setIsPreviewMode(false);
  }, [activeFile]);

  // 스프레드시트는 파서를 lazy import 하므로 로딩 상태가 실재한다(청크 + 파싱).
  // 실패 사유는 **코드**로 담는다 — t() 를 여기서 부르면 매 렌더 새 함수라 이펙트가 재실행된다.
  useEffect(() => {
    if (!isSheet || !activeFilePath) {
      setSheetState({ loading: false, sheets: null, errorCode: null });
      return undefined;
    }
    let cancelled = false;
    setSheetState({ loading: true, sheets: null, errorCode: null });
    loadWorkbook(activeFilePath, activeFileHostId)
      .then((sheets) => {
        if (!cancelled) setSheetState({ loading: false, sheets, errorCode: null });
      })
      .catch((e) => {
        if (cancelled) return;
        const errorCode = e instanceof WorkbookTooLargeError ? 'tooLarge' : 'failed';
        setSheetState({ loading: false, sheets: null, errorCode });
      });
    return () => { cancelled = true; };
  }, [isSheet, activeFilePath, activeFileHostId]);

  // csv/tsv 는 이미 텍스트로 들어와 있다 — 표는 그 내용에서 바로 파생한다(추가 요청 없음).
  const delimitedSheets = useMemo(() => {
    if (!isDelimited || !isPreviewMode) return null;
    const { rows, truncated } = parseDelimited(content || '', {
      delimiter: detectDelimiter(previewName, content || ''),
    });
    return [{ name: '', rows, truncated }];
  }, [isDelimited, isPreviewMode, previewName, content]);

  useEffect(() => {
    try {
      localStorage.setItem(DIFF_VIEW_STATE_KEY, JSON.stringify(diffViewByPath));
    } catch { /* ignore storage quota/private mode */ }
  }, [diffViewByPath]);

  useEffect(() => {
    // 대상이 바뀌면 실패 표시부터 내린다 — 안 내리면 다음 파일이 남은 에러 화면을 물려받는다.
    setRawPreviewError(false);
    if (!rawPreviewPath) {
      setRawPreviewUrl(null);
      return;
    }
    // <img> 는 same-origin 요청에 인증 쿠키를 자동으로 싣는다 — 별도 /api/files/raw-ticket
    // POST 없이 ?path= 로 바로 로드한다. 그 POST 는 재연결마다 wedge 되는 공유 HTTP/2 풀을
    // 재사용하던 취약점이었다(서버가 쿠키로 폴백 인증, 경로는 validate_path 로 워크스페이스
    // 밖을 차단). _t 로 캐시를 우회해 편집 후에도 최신 원본을 보여준다.
    const base = rawPreviewHostId
      ? `/api/hosts/${encodeURIComponent(rawPreviewHostId)}/files/raw`
      : '/api/files/raw';
    setRawPreviewUrl(`${base}?path=${encodeURIComponent(rawPreviewPath)}&_t=${Date.now()}`);
  }, [rawPreviewPath, rawPreviewHostId]);

  // 활성 파일이 바뀌면 HEAD 원본을 lazy load. 변경분이 있으면 diff 모드로 자동 진입.
  useEffect(() => {
    if (!activeFile || isBinaryPreview || binaryPathsRef.current.has(activeFile)) return;
    if (diffStates[activeFile]) return; // 이미 로드됨
    loadOriginalContent(activeFile);
  }, [activeFile, isBinaryPreview, loadOriginalContent, diffStates]);

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
      const { path: savePath, hostId: saveHostId } = parseFileKey(activeFile);
      const endpoint = saveHostId ? `/api/hosts/${saveHostId}/files/write` : '/api/files/write';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
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

  // Prettier "Format Document" — 등록된 프로바이더(setupMonaco)를 통해 동작.
  // 버튼/모바일 접근성용 명시 트리거. 키보드는 네이티브 Shift+Alt+F 가 이미 붙는다.
  const formatDocument = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.getAction?.('editor.action.formatDocument')?.run();
  }, []);

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
    if (path === CLOSE_ALL) {
      setFileStates({});
      onCloseAll?.();
      return;
    }
    // Remove state for this file
    setFileStates(prev => {
      const newState = { ...prev };
      delete newState[path];
      return newState;
    });
    onClose(path);
  };

  /* 모두 닫기 — 저장 안 된 파일이 하나라도 있으면 같은 확인창을 한 번만 띄운다.
     파일마다 물으면 사진 열댓 장 정리하다가 확인창만 열댓 번 누르게 된다. */
  const handleCloseAllClick = () => {
    if (!onCloseAll) return;
    const dirty = (openFiles || []).some((p) => fileStates[p]?.hasChanges);
    if (dirty) { setConfirmClose({ isOpen: true, path: CLOSE_ALL }); return; }
    setFileStates({});
    onCloseAll();
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
      <FileEditorTabs
        openFiles={openFiles}
        activeFile={activeFile}
        fileStates={fileStates}
        theme={theme}
        editorSection={editorSection}
        onFileSelect={onFileSelect}
        onCloseClick={handleCloseClick}
        onCloseAllClick={onCloseAll ? handleCloseAllClick : null}
        t={t}
      />

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
          {(isMarkdown || isHtml || isDelimited) && (
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
          {!isPreviewMode && !isDiffView && canFormatLanguage(getLanguage(activeFile)) && (
            <Button
              variant="ghost"
              size="small"
              onClick={formatDocument}
              disabled={loading}
              theme={theme}
              title={`${t('formatDocument') || 'Format Document'} (Shift+Alt+F)`}
              style={{ height: '24px', padding: '0 6px' }}
              icon={AlignLeft}
            />
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
            <button
              onClick={() => changeFontSize(-1)}
              title="Decrease font size"
              style={styles.fsBtnStyle(theme)}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.10)'; e.currentTarget.style.color = theme.ui.text || theme.ui.textSecondary; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.ui.textSecondary; }}
            >
              <ZoomOut size={11} strokeWidth={2} />
            </button>
            <span style={{ fontSize: '10px', color: theme.ui.textSecondary, minWidth: '20px', textAlign: 'center', fontFamily: 'monospace' }}>{editorFontSize}</span>
            <button
              onClick={() => changeFontSize(1)}
              title="Increase font size"
              style={styles.fsBtnStyle(theme)}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.10)'; e.currentTarget.style.color = theme.ui.text || theme.ui.textSecondary; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.ui.textSecondary; }}
            >
              <ZoomIn size={11} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>

      {/* 에디터 영역 */}
      <div style={styles.content}>
        {loading && !content && !isBinaryPreview ? (
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
        ) : rawPreviewError ? (
          <div style={{ ...styles.message, color: theme.ui.textSecondary }}>
            <AlertCircle size={32} style={{ marginBottom: '12px' }} />
            <span>{t('previewLoadFailed')}</span>
          </div>
        ) : isSheet ? (
          sheetState.loading ? (
            <div style={styles.message}>
              <Loader2 size={28} className="spin" color={theme.ui.textSecondary} />
            </div>
          ) : sheetState.errorCode ? (
            <div style={{ ...styles.message, color: theme.ui.textSecondary }}>
              <AlertCircle size={32} style={{ marginBottom: '12px' }} />
              <span>{sheetState.errorCode === 'tooLarge' ? t('previewTooLarge') : t('previewLoadFailed')}</span>
            </div>
          ) : (
            <DataTable
              sheets={sheetState.sheets || []}
              theme={theme}
              truncatedLabel={t('previewRowsTruncated')}
              emptyLabel={t('diffEmpty')}
            />
          )
        ) : (isDelimited && isPreviewMode) ? (
          <DataTable
            sheets={delimitedSheets || []}
            theme={theme}
            truncatedLabel={t('previewRowsTruncated')}
            emptyLabel={t('diffEmpty')}
          />
        ) : (isImage && canInlineHere) ? (
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
                onError={() => setRawPreviewError(true)}
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
        ) : (isPdf && canInlineHere) ? (
          rawPreviewUrl ? (
            <iframe
              src={rawPreviewUrl}
              style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#fff' }}
              title={activeFilePath || activeFile}
            />
          ) : (
            <div style={styles.message}>
              <Loader2 size={28} className="spin" color={theme.ui.textSecondary} />
            </div>
          )
        ) : (isVideo && canInlineHere) ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `color-mix(in srgb, ${theme.ui.bgSecondary || theme.ui.bg} 70%, transparent)`,
            padding: '20px'
          }}>
            {rawPreviewUrl ? (
              <video
                src={rawPreviewUrl}
                controls
                onError={() => setRawPreviewError(true)}
                style={{ maxWidth: '100%', maxHeight: '100%', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
              />
            ) : (
              <Loader2 size={28} className="spin" color={theme.ui.textSecondary} />
            )}
          </div>
        ) : (isAudio && canInlineHere) ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `color-mix(in srgb, ${theme.ui.bgSecondary || theme.ui.bg} 70%, transparent)`,
            padding: '20px'
          }}>
            {rawPreviewUrl ? (
              <audio
                src={rawPreviewUrl}
                controls
                onError={() => setRawPreviewError(true)}
                style={{ width: '80%', maxWidth: '480px' }}
              />
            ) : (
              <Loader2 size={28} className="spin" color={theme.ui.textSecondary} />
            )}
          </div>
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
                <span>{t('remoteHtmlPreviewUnsupported')}</span>
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


export default FileEditor;
