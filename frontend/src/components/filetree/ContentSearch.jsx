// 워크스페이스 전체 파일 내용 검색 결과 패널 (백엔드 /api/files/grep = ripgrep).
// 반응성: 250ms 디바운스 + 요청 세대(reqRef)로 stale 응답 무시. 결과 클릭 → 해당 파일 열기.
import { useState, useEffect, useRef } from 'react';
import { authHeaders } from '../../utils/auth';
import { tokens } from '../../styles/tokens';

const { color, fontSize, fontWeight, font, radius } = tokens;
const MIN_QUERY = 2;

export default function ContentSearch({ query, onOpen, t }) {
  const [state, setState] = useState({ loading: false, items: [], error: null, truncated: false });
  const reqRef = useRef(0);

  useEffect(() => {
    const q = (query || '').trim();
    if (q.length < MIN_QUERY) {
      setState({ loading: false, items: [], error: null, truncated: false });
      return undefined;
    }
    const id = reqRef.current + 1;
    reqRef.current = id;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/files/grep?q=${encodeURIComponent(q)}&limit=200`, { headers: authHeaders() });
        if (id !== reqRef.current) return; // stale
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setState({ loading: false, items: data.items || [], error: null, truncated: !!data.truncated });
      } catch (e) {
        if (id !== reqRef.current) return;
        setState({ loading: false, items: [], error: e.message || 'search failed', truncated: false });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const q = (query || '').trim();
  if (q.length < MIN_QUERY) return <div style={hintStyle}>{t?.('contentSearchHint') || 'Type at least 2 chars to search file contents'}</div>;
  if (state.loading && !state.items.length) return <div style={hintStyle}>{t?.('loading') || 'Loading…'}</div>;
  if (state.error) return <div style={{ ...hintStyle, color: color.danger }}>{state.error}</div>;
  if (!state.items.length) return <div style={hintStyle}>{t?.('noResults') || 'No results'}</div>;

  return (
    <div style={listStyle}>
      {state.items.map((it, i) => (
        <button
          key={`${it.path}:${it.line}:${i}`}
          type="button"
          onClick={() => onOpen?.(it.path, it.line)}
          style={rowStyle}
          title={`${it.path}:${it.line ?? ''}`}
          onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={headStyle}>
            <span style={nameStyle}>{it.name}</span>
            {it.line != null && <span style={lineStyle}>:{it.line}</span>}
            <span style={dirStyle}>{it.path}</span>
          </div>
          <div style={snippetStyle}>{it.text}</div>
        </button>
      ))}
      {state.truncated && <div style={hintStyle}>{t?.('resultsTruncated') || 'Showing first 200 results…'}</div>}
    </div>
  );
}

const hintStyle = {
  fontSize: fontSize['12'],
  color: color.muted,
  padding: '14px 10px',
  textAlign: 'center',
  lineHeight: 1.5,
};
const listStyle = { display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1, minHeight: 0 };
const rowStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  alignItems: 'stretch',
  textAlign: 'left',
  padding: '6px 10px',
  background: 'transparent',
  border: 'none',
  borderRadius: radius.sm,
  cursor: 'pointer',
  width: '100%',
};
const headStyle = { display: 'flex', alignItems: 'baseline', gap: '4px', minWidth: 0 };
const nameStyle = { fontSize: fontSize['12'], fontWeight: fontWeight.medium, color: color.text, flexShrink: 0 };
const lineStyle = { fontSize: '10px', color: color.accent, fontFamily: font.mono, flexShrink: 0 };
const dirStyle = {
  fontSize: '10px',
  color: color.muted,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  marginLeft: 'auto',
};
const snippetStyle = {
  fontSize: '11px',
  color: color.subtext,
  fontFamily: font.mono,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
