/**
 * 다중 파일 업로드 진행 상태와 트리거 함수.
 * uploadUrl 은 로컬/원격 모두에 대응 (/api/files/upload 또는 /api/hosts/.../files/upload).
 */
import { useState } from 'react';
import { authHeaders } from '../utils/auth';

export default function useFileUpload({ uploadUrl, t, onUploadComplete }) {
  const [uploadState, setUploadState] = useState(null);

  const uploadFiles = async (files, destPath = '') => {
    if (!files || files.length === 0) return;
    const total = files.length;
    setUploadState({ current: 0, total, fileName: files[0].name, done: false, error: false });
    for (let i = 0; i < total; i++) {
      const fd = new FormData();
      fd.append('dest', destPath);
      fd.append('files', files[i]);
      setUploadState({ current: i, total, fileName: files[i].name, done: false, error: false });
      try {
        const res = await fetch(uploadUrl, { method: 'POST', headers: authHeaders(), body: fd });
        if (!res.ok) {
          let detail = '';
          try {
            const data = await res.json();
            detail = data?.detail ? `: ${data.detail}` : '';
          } catch { /* ignore non-json error bodies */ }
          throw new Error(`${t('uploadFailed') || 'Upload failed'}${detail}`);
        }
      } catch (e) {
        console.error('Upload error:', e);
        setUploadState({
          current: i + 1,
          total,
          fileName: files[i].name,
          done: true,
          error: true,
          message: e.message || (t('uploadFailed') || 'Upload failed'),
        });
        setTimeout(() => setUploadState(null), 4000);
        return;
      }
    }
    onUploadComplete?.(destPath);
    setUploadState({
      current: total,
      total,
      fileName: '',
      done: true,
      error: false,
      message: t('uploadComplete') || t('done') || 'Done',
    });
    setTimeout(() => setUploadState(null), 1500);
  };

  return { uploadState, uploadFiles };
}
