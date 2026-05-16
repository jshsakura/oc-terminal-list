/**
 * 파일/폴더 다운로드 상태와 트리거 함수.
 * apiBase 가 비어있으면 로컬 워크스페이스, 있으면 원격 호스트 (/api/hosts/.../files).
 */
import { useState } from 'react';

const authHeader = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const basename = (path) => (path || '').split('/').filter(Boolean).pop() || 'download';

const filenameFromDisposition = (header, defaultName) => {
  if (!header) return defaultName;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match) {
    try { return decodeURIComponent(utf8Match[1]); } catch { /* ignore */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : defaultName;
};

const triggerBlobDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function useFileDownload({ apiBase, t }) {
  const [downloadState, setDownloadState] = useState(null);

  const downloadNode = async (path, type) => {
    if (!path) return;
    const fileName = path.split('/').pop() || (t('download') || 'Download');
    setDownloadState({
      fileName,
      pending: true,
      done: false,
      error: false,
      message: `${t('download') || 'Download'}...`,
    });
    try {
      const url = `${apiBase}/download?path=${encodeURIComponent(path)}`;
      const res = await fetch(url, { headers: authHeader() });
      if (!res.ok) {
        let detail = '';
        try {
          const data = await res.json();
          detail = data?.detail ? `: ${data.detail}` : '';
        } catch { /* ignore non-json error bodies */ }
        throw new Error(`${t('downloadFailed') || 'Download failed'}${detail || ` (${res.status})`}`);
      }
      const blob = await res.blob();
      const defaultName = type === 'directory' ? `${basename(path)}.zip` : basename(path);
      const resolvedName = filenameFromDisposition(res.headers.get('content-disposition'), defaultName);
      triggerBlobDownload(blob, resolvedName);
      setDownloadState({
        fileName,
        pending: false,
        done: true,
        error: false,
        message: t('downloadStarted') || 'Download started',
      });
      setTimeout(() => setDownloadState(null), 2000);
    } catch (e) {
      setDownloadState({
        fileName,
        pending: false,
        done: true,
        error: true,
        message: e.message || (t('downloadFailed') || 'Download failed'),
      });
      setTimeout(() => setDownloadState(null), 4000);
    }
  };

  return { downloadState, downloadNode };
}
