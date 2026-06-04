/**
 * 에디터 탭 상태 persistence(localStorage) + 에디터 지원 파일 판별.
 * App.jsx 에서 로직 변경 없이 추출한 순수 함수.
 */
export const EDITOR_STATE_KEY = 'iterm:editor-state:v1';

const EDITOR_UNSUPPORTED_EXTENSIONS = new Set([
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'lz', 'lzma',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'class', 'jar', 'war',
  'mp3', 'wav', 'flac', 'mp4', 'mov', 'avi', 'mkv', 'webm',
  'ttf', 'otf', 'woff', 'woff2',
]);

export const getFilePathFromEditorKey = (fileKey) => {
  if (!fileKey) return '';
  if (!fileKey.startsWith('remote:')) return fileKey;
  const rest = fileKey.slice(7);
  const idx = rest.indexOf(':');
  return idx < 0 ? rest : rest.slice(idx + 1);
};

export const isEditorSupportedFile = (path, hostId = null) => {
  const filePath = getFilePathFromEditorKey(hostId ? `remote:${hostId}:${path}` : path);
  const name = (filePath || '').split('/').pop() || '';
  if (!name || !name.includes('.')) return true;
  const ext = name.split('.').pop().toLowerCase();
  return !EDITOR_UNSUPPORTED_EXTENSIONS.has(ext);
};

export const isEditorSupportedFileKey = (fileKey) => {
  const path = getFilePathFromEditorKey(fileKey);
  return isEditorSupportedFile(path);
};

export const readEditorState = () => {
  if (typeof localStorage === 'undefined') return { openFiles: [], activeFile: null };
  try {
    const raw = localStorage.getItem(EDITOR_STATE_KEY);
    if (!raw) return { openFiles: [], activeFile: null };
    const parsed = JSON.parse(raw);
    const openFiles = Array.isArray(parsed?.openFiles)
      ? parsed.openFiles.filter((p) => typeof p === 'string' && p.trim())
        .filter(isEditorSupportedFileKey)
      : [];
    const activeFile = typeof parsed?.activeFile === 'string' && openFiles.includes(parsed.activeFile)
      ? parsed.activeFile
      : (openFiles[0] || null);
    return { openFiles, activeFile };
  } catch {
    return { openFiles: [], activeFile: null };
  }
};
