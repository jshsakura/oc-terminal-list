import { File, FileCode, FileText, Image as ImageIcon } from 'lucide-react';

export const DIFF_VIEW_STATE_KEY = 'iterm:file-editor-diff-view:v1';

export const readDiffViewState = () => {
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
export const parseFileKey = (key) => {
  if (!key) return { path: null, hostId: null };
  if (key.startsWith('remote:')) {
    const rest = key.slice(7);
    const idx = rest.indexOf(':');
    if (idx < 0) return { path: rest, hostId: null };
    return { hostId: rest.slice(0, idx), path: rest.slice(idx + 1) };
  }
  return { path: key, hostId: null };
};

export const getFileIcon = (filename, color) => {
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
