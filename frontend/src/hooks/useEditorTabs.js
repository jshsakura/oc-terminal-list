import { useState, useEffect, useMemo } from 'react';
import {
  EDITOR_STATE_KEY,
  isEditorSupportedFile,
  readEditorState,
  editorTabKey,
} from '../utils/editorState';

const EMPTY_SLICE = { openFiles: [], activeFile: null };

/**
 * 에디터 탭 상태 — 열린 파일/활성 파일을 **워크스페이스 탭별**로 분리해 보관.
 * 탭을 옮기면 그 탭이 갖고 있던 에디터만 보이고, 다른 탭 에디터는 따라오지 않는다.
 * 입력 { t, setNotification, activeTabId }. 반환 { openFiles, activeFile, handleFileOpen, handleFileClose }.
 */
export default function useEditorTabs({ t, setNotification, activeTabId }) {
  const restored = useMemo(() => readEditorState(), []);
  // byTab: { [tabKey]: { openFiles, activeFile } } — 전 탭의 에디터 상태 모음(불변 갱신).
  const [byTab, setByTab] = useState(restored.byTab);

  const key = editorTabKey(activeTabId);
  const current = byTab[key] || EMPTY_SLICE;
  const { openFiles, activeFile } = current;

  useEffect(() => {
    try {
      localStorage.setItem(EDITOR_STATE_KEY, JSON.stringify({ byTab }));
    } catch { /* ignore storage quota/private mode */ }
  }, [byTab]);

  // 한 탭 슬롯을 불변 갱신 + activeFile 정규화. 비면 키 자체를 제거.
  const updateSlice = (tabKey, updater) => {
    setByTab((prev) => {
      const cur = prev[tabKey] || EMPTY_SLICE;
      const draft = updater(cur);
      const nextActive = draft.activeFile && draft.openFiles.includes(draft.activeFile)
        ? draft.activeFile
        : (draft.openFiles[0] || null);
      if (!draft.openFiles.length) {
        const { [tabKey]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [tabKey]: { openFiles: draft.openFiles, activeFile: nextActive } };
    });
  };

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
    updateSlice(key, (cur) => ({
      openFiles: cur.openFiles.includes(fileKey) ? cur.openFiles : [...cur.openFiles, fileKey],
      activeFile: fileKey,
    }));
  };

  const handleFileClose = (path) => {
    updateSlice(key, (cur) => {
      const next = cur.openFiles.filter((f) => f !== path);
      return {
        openFiles: next,
        activeFile: cur.activeFile === path ? (next[next.length - 1] || null) : cur.activeFile,
      };
    });
  };

  return { openFiles, activeFile, handleFileOpen, handleFileClose };
}
