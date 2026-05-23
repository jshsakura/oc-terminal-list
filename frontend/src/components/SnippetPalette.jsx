import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2, X, Terminal as TerminalIcon, BookMarked } from 'lucide-react';
import { tokens } from '../styles/tokens';
import { glassMenuStyle } from '../styles/glass';

const { color, font, fontSize, fontWeight, radius, space } = tokens;

/**
 * 커맨드 스니펫 팔레트 — Ctrl+Shift+P 로 열림.
 *
 * 동작:
 *  - 스니펫 목록 퍼지 검색 (name / command / tags)
 *  - 선택 → onRun(command) 호출 → 활성 터미널로 전송
 *  - 추가/삭제 인라인 지원
 */
const SnippetPalette = ({ isOpen, onClose, snippets, onCreate, onDelete, onRun, t }) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCmd, setNewCmd] = useState('');
  const [newTags, setNewTags] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelected(0);
      setAdding(false);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [isOpen]);

  const filtered = query
    ? snippets.filter((s) => {
        const q = query.toLowerCase();
        return s.name.toLowerCase().includes(q)
          || s.command.toLowerCase().includes(q)
          || (s.tags || '').toLowerCase().includes(q);
      })
    : snippets;

  const handleKey = useCallback((e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') { onClose(); return; }
    if (adding) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((v) => Math.min(v + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((v) => Math.max(v - 1, 0));
    } else if (e.key === 'Enter' && filtered[selected]) {
      e.preventDefault();
      onRun(filtered[selected].command);
      onClose();
    }
  }, [isOpen, adding, filtered, selected, onRun, onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // selected 변경 시 스크롤 따라오기
  useEffect(() => {
    const el = listRef.current?.children[selected];
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // query 바뀌면 selection 초기화
  useEffect(() => { setSelected(0); }, [query]);

  const handleAdd = useCallback(async () => {
    if (!newName.trim() || !newCmd.trim()) return;
    await onCreate({ name: newName.trim(), command: newCmd, tags: newTags.trim() });
    setNewName(''); setNewCmd(''); setNewTags('');
    setAdding(false);
  }, [newName, newCmd, newTags, onCreate]);

  if (!isOpen) return null;

  return (
    <div
      style={backdropStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={panelStyle}>
        {/* 헤더 */}
        <div style={headerStyle}>
          <BookMarked size={13} strokeWidth={1.8} style={{ color: color.accent, flexShrink: 0 }} />
          <span style={titleStyle}>{t?.('snippets') || 'Snippets'}</span>
          <button type="button" onClick={onClose} style={closeBtnStyle}>
            <X size={13} strokeWidth={2} />
          </button>
        </div>

        {/* 검색 인풋 */}
        <div style={searchWrapStyle}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t?.('searchSnippets') || 'Search snippets…'}
            style={searchStyle}
          />
        </div>

        {/* 결과 목록 */}
        <div ref={listRef} style={listStyle}>
          {filtered.length === 0 && (
            <div style={emptyStyle}>{t?.('noSnippets') || 'No snippets. Add one below.'}</div>
          )}
          {filtered.map((s, i) => (
            <div
              key={s.id}
              style={{ ...rowStyle, background: i === selected ? color.surface1 : 'transparent' }}
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(e) => { e.preventDefault(); onRun(s.command); onClose(); }}
            >
              <div style={rowMainStyle}>
                <TerminalIcon size={11} strokeWidth={1.8} style={{ color: color.accent, flexShrink: 0, marginTop: '1px' }} />
                <div style={rowTextStyle}>
                  <span style={rowNameStyle}>{s.name}</span>
                  <span style={rowCmdStyle}>{s.command}</span>
                </div>
              </div>
              {s.tags && (
                <div style={tagsStyle}>
                  {s.tags.split(',').filter(Boolean).map((tag) => (
                    <span key={tag.trim()} style={tagStyle}>{tag.trim()}</span>
                  ))}
                </div>
              )}
              <button
                type="button"
                style={deleteBtnStyle}
                onMouseDown={(e) => { e.stopPropagation(); onDelete(s.id); }}
                title={t?.('delete') || 'Delete'}
              >
                <Trash2 size={11} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>

        {/* 추가 영역 */}
        {adding ? (
          <div style={addFormStyle}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t?.('snippetName') || 'Name…'}
              style={addInputStyle}
            />
            <textarea
              value={newCmd}
              onChange={(e) => setNewCmd(e.target.value)}
              placeholder={t?.('command') || 'Command…'}
              rows={2}
              style={{ ...addInputStyle, resize: 'vertical', fontFamily: font.mono }}
            />
            <input
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder={t?.('tags') || 'Tags (comma separated)'}
              style={addInputStyle}
            />
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setAdding(false)} style={cancelBtnStyle}>
                {t?.('cancel') || 'Cancel'}
              </button>
              <button type="button" onClick={handleAdd} style={saveBtnStyle}>
                {t?.('save') || 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} style={addBtnStyle}>
            <Plus size={12} strokeWidth={2} />
            {t?.('addSnippet') || 'Add snippet'}
          </button>
        )}
      </div>
    </div>
  );
};

/* ── styles ── */
const backdropStyle = {
  position: 'fixed', inset: 0, zIndex: 2000,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  paddingTop: '80px',
};
const panelStyle = {
  ...glassMenuStyle,
  width: '520px',
  maxHeight: '70vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: radius.lg,
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
};
const headerStyle = {
  display: 'flex', alignItems: 'center', gap: '8px',
  padding: '10px 14px 8px',
  borderBottom: `1px solid ${color.border}`,
  flexShrink: 0,
};
const titleStyle = {
  flex: 1,
  fontSize: fontSize['13'],
  fontWeight: fontWeight.semibold,
  color: color.text,
  fontFamily: font.sans,
};
const closeBtnStyle = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: color.subtext, padding: '2px',
  display: 'flex', alignItems: 'center',
};
const searchWrapStyle = {
  padding: '8px 12px',
  borderBottom: `1px solid ${color.border}`,
  flexShrink: 0,
};
const searchStyle = {
  width: '100%',
  background: color.surface0,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  color: color.text,
  fontSize: fontSize['13'],
  fontFamily: font.sans,
  padding: '6px 10px',
  outline: 'none',
  boxSizing: 'border-box',
};
const listStyle = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 0',
};
const emptyStyle = {
  padding: '20px',
  textAlign: 'center',
  fontSize: fontSize['12'],
  color: color.muted,
  fontFamily: font.sans,
};
const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 12px',
  cursor: 'pointer',
  position: 'relative',
  borderRadius: radius.sm,
  margin: '1px 4px',
};
const rowMainStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  minWidth: 0,
};
const rowTextStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: 0,
};
const rowNameStyle = {
  fontSize: fontSize['13'],
  fontWeight: fontWeight.medium,
  color: color.text,
  fontFamily: font.sans,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const rowCmdStyle = {
  fontSize: fontSize['11'],
  color: color.subtext,
  fontFamily: font.mono,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const tagsStyle = { display: 'flex', gap: '4px', flexShrink: 0, flexWrap: 'wrap' };
const tagStyle = {
  fontSize: '10px',
  color: color.accent,
  background: `${color.accent}18`,
  border: `1px solid ${color.accent}30`,
  borderRadius: radius.sm,
  padding: '1px 5px',
  fontFamily: font.sans,
};
const deleteBtnStyle = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: color.muted, padding: '2px', flexShrink: 0,
  display: 'flex', alignItems: 'center',
  opacity: 0.5,
};
deleteBtnStyle[':hover'] = { opacity: 1, color: color.danger };
const addBtnStyle = {
  display: 'flex', alignItems: 'center', gap: '6px',
  padding: '8px 14px',
  background: 'none', border: 'none',
  borderTop: `1px solid ${color.border}`,
  color: color.subtext,
  fontSize: fontSize['12'],
  fontFamily: font.sans,
  cursor: 'pointer',
  width: '100%',
  flexShrink: 0,
};
const addFormStyle = {
  padding: '10px 14px',
  borderTop: `1px solid ${color.border}`,
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  flexShrink: 0,
};
const addInputStyle = {
  background: color.surface0,
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  color: color.text,
  fontSize: fontSize['12'],
  fontFamily: font.sans,
  padding: '5px 8px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};
const saveBtnStyle = {
  background: color.accent,
  border: 'none',
  borderRadius: radius.sm,
  color: '#fff',
  fontSize: fontSize['12'],
  fontFamily: font.sans,
  padding: '4px 12px',
  cursor: 'pointer',
  fontWeight: fontWeight.medium,
};
const cancelBtnStyle = {
  background: 'none',
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  color: color.subtext,
  fontSize: fontSize['12'],
  fontFamily: font.sans,
  padding: '4px 10px',
  cursor: 'pointer',
};

export default SnippetPalette;
