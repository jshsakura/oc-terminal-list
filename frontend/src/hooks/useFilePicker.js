import { useState, useRef, useCallback, useEffect } from 'react';
import uFuzzy from '@leeoniya/ufuzzy';
import { authHeaders } from '../utils/auth';

/**
 * Quick-open 파일 피커 — 워크스페이스 파일 인덱스를 1회 받아 ufuzzy 로 클라이언트 매칭.
 * 키 입력 즉시 결과(서버 왕복 0), 인덱스 비었거나 truncated 면 서버 검색으로 폴백.
 * App.jsx 에서 로직 변경 없이 추출. 입력: { openFiles }(최근 파일 목록).
 */
export default function useFilePicker({ openFiles }) {
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);
  const [filePickerQuery, setFilePickerQuery] = useState('');
  const [filePickerItems, setFilePickerItems] = useState([]);
  const [isFilePickerLoading, setIsFilePickerLoading] = useState(false);

  // 워크스페이스 파일 인덱스 — 한 번 받아서 메모리 캐시 (TTL 60s).
  // ufuzzy 로 클라이언트 매칭 → 키 입력 즉시 결과 (서버 왕복 0).
  const fileIndexRef = useRef({ files: [], ts: 0, truncated: false });
  const ufuzzyRef = useRef(null);
  if (!ufuzzyRef.current) {
    ufuzzyRef.current = new uFuzzy({ intraMode: 1, intraIns: 1 });
  }

  const openFilePicker = useCallback(() => {
    setFilePickerQuery('');
    setFilePickerItems(openFiles.map((p) => ({ id: `recent:${p}`, path: p, label: p })));
    setIsFilePickerOpen(true);
  }, [openFiles]);

  const ensureFileIndex = useCallback(async (force = false) => {
    const now = Date.now() / 1000;
    if (!force && fileIndexRef.current.files.length && now - fileIndexRef.current.ts < 60) {
      return fileIndexRef.current;
    }
    try {
      const r = await fetch('/api/files/index', { headers: authHeaders() });
      if (!r.ok) return fileIndexRef.current;
      const data = await r.json();
      fileIndexRef.current = { files: data.files || [], ts: now, truncated: !!data.truncated };
    } catch { /* 오프라인 — 다음 호출에서 재시도 */ }
    return fileIndexRef.current;
  }, []);

  // file picker search — ufuzzy 로 클라이언트 매칭.
  // 큰 인덱스 (>10k) 에서도 sub-ms 수준이라 debounce 거의 불필요.
  useEffect(() => {
    if (!isFilePickerOpen) return;
    const query = filePickerQuery.trim();
    if (!query) {
      setFilePickerItems(openFiles.map((p) => ({ id: `recent:${p}`, path: p, label: p })));
      return;
    }
    let cancelled = false;
    setIsFilePickerLoading(true);
    (async () => {
      const index = await ensureFileIndex();
      if (cancelled) return;
      const haystack = index.files;
      if (!haystack.length) {
        // 인덱스 비었으면 레거시 서버 검색으로 폴백 (대용량 워크스페이스 truncated 케이스 등)
        try {
          const res = await fetch(`/api/files/search?q=${encodeURIComponent(query)}&limit=200`, {
            headers: authHeaders(),
          });
          const data = await res.json();
          if (!cancelled) {
            setFilePickerItems((data.items || []).map((item) => ({ id: `s:${item.path}`, path: item.path, label: item.path })));
          }
        } catch { /* noop */ }
        if (!cancelled) setIsFilePickerLoading(false);
        return;
      }
      const uf = ufuzzyRef.current;
      const idxs = uf.filter(haystack, query);
      if (!idxs || idxs.length === 0) {
        if (!cancelled) {
          setFilePickerItems([]);
          setIsFilePickerLoading(false);
        }
        return;
      }
      const info = uf.info(idxs, haystack, query);
      const order = uf.sort(info, haystack, query);
      const limited = order.slice(0, 200);
      const items = limited.map((oi) => {
        const path = haystack[info.idx[oi]];
        return { id: `s:${path}`, path, label: path };
      });
      if (!cancelled) {
        setFilePickerItems(items);
        setIsFilePickerLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isFilePickerOpen, filePickerQuery, openFiles, ensureFileIndex]);

  // 파일 picker 가 열리는 즉시 인덱스 워밍업 (첫 입력 전에 받아두기)
  useEffect(() => {
    if (isFilePickerOpen) ensureFileIndex();
  }, [isFilePickerOpen, ensureFileIndex]);

  return {
    isFilePickerOpen,
    setIsFilePickerOpen,
    filePickerQuery,
    setFilePickerQuery,
    filePickerItems,
    isFilePickerLoading,
    openFilePicker,
  };
}
