/**
 * 에디터 탭 상태 persistence(localStorage) + 에디터 지원 파일 판별.
 * App.jsx 에서 로직 변경 없이 추출한 순수 함수.
 */
export const EDITOR_STATE_KEY = 'iterm:editor-state:v1';

// 에디터/미리보기에서 열 수 없는(또는 브라우저 네이티브 재생 불가) 확장자.
// pdf·동영상(mp4/webm/mov/...)·오디오(mp3/wav/flac/...)는 FileEditor 가 미리보기로 처리하므로 제외.
// avi/mkv 는 브라우저 <video> 가 재생 못 하므로 계속 차단.
const EDITOR_UNSUPPORTED_EXTENSIONS = new Set([
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'lz', 'lzma',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'class', 'jar', 'war',
  'avi', 'mkv',
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

// 한 탭 슬롯({ openFiles, activeFile })을 검증·정규화.
const sanitizeSlice = (slice) => {
  const openFiles = Array.isArray(slice?.openFiles)
    ? slice.openFiles.filter((p) => typeof p === 'string' && p.trim())
      .filter(isEditorSupportedFileKey)
    : [];
  const activeFile = typeof slice?.activeFile === 'string' && openFiles.includes(slice.activeFile)
    ? slice.activeFile
    : (openFiles[0] || null);
  return { openFiles, activeFile };
};

/**
 * 에디터 상태 복원 — 탭별 버킷 { byTab: { [tabKey]: { openFiles, activeFile } } }.
 * 구버전(전역 { openFiles, activeFile })은 홈 버킷으로 1회 마이그레이션.
 */
export const readEditorState = () => {
  if (typeof localStorage === 'undefined') return { byTab: {} };
  try {
    const raw = localStorage.getItem(EDITOR_STATE_KEY);
    if (!raw) return { byTab: {} };
    const parsed = JSON.parse(raw);
    if (parsed?.byTab && typeof parsed.byTab === 'object') {
      const byTab = {};
      for (const [k, slice] of Object.entries(parsed.byTab)) {
        const clean = sanitizeSlice(slice);
        if (clean.openFiles.length) byTab[k] = clean;
      }
      return { byTab };
    }
    // 구버전 마이그레이션: 전역 상태 → 홈 버킷
    const legacy = sanitizeSlice(parsed);
    return { byTab: legacy.openFiles.length ? { [EDITOR_HOME_KEY]: legacy } : {} };
  } catch {
    return { byTab: {} };
  }
};

// 활성 탭이 없을 때(홈 대시보드) 쓰는 버킷 키.
export const EDITOR_HOME_KEY = '__home__';
export const editorTabKey = (tabId) => (tabId == null ? EDITOR_HOME_KEY : String(tabId));
