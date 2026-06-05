import { useState, useEffect, useMemo } from 'react';
import { EDITOR_STATE_KEY, isEditorSupportedFile, readEditorState } from '../utils/editorState';

/**
 * 에디터 탭 상태 — 열린 파일 목록 + 활성 파일 + localStorage 영속 + 열기/닫기.
 * App.jsx 에서 로직 변경 없이 추출. 입력 { t, setNotification }(미지원 파일 알림용).
 * 반환: { openFiles, activeFile, handleFileOpen, handleFileClose }.
 */
export default function useEditorTabs({ t, setNotification }) {
  const restoredEditorState = useMemo(() => readEditorState(), []);
  const [openFiles, setOpenFiles] = useState(restoredEditorState.openFiles);
  const [activeFile, setActiveFile] = useState(restoredEditorState.activeFile);

  useEffect(() => {
    const nextActiveFile = activeFile && openFiles.includes(activeFile)
      ? activeFile
      : (openFiles[0] || null);
    try {
      localStorage.setItem(EDITOR_STATE_KEY, JSON.stringify({ openFiles, activeFile: nextActiveFile }));
    } catch { /* ignore storage quota/private mode */ }
    if (nextActiveFile !== activeFile) setActiveFile(nextActiveFile);
  }, [openFiles, activeFile]);

  const handleFileOpen = (path, hostId = null) => {
    if (!isEditorSupportedFile(path, hostId)) {
      setNotification({
        isOpen: true,
        message: t('binaryFileNotSupported') || 'Binary file not supported in editor.',
        type: 'info',
      });
      return;
    }
    const fileKey = hostId ? `remote:${hostId}:${path}` : path;
    if (!openFiles.includes(fileKey)) setOpenFiles((prev) => [...prev, fileKey]);
    setActiveFile(fileKey);
  };

  const handleFileClose = (path) => {
    const next = openFiles.filter((f) => f !== path);
    setOpenFiles(next);
    if (activeFile === path) setActiveFile(next[next.length - 1] || null);
  };

  return { openFiles, activeFile, handleFileOpen, handleFileClose };
}
