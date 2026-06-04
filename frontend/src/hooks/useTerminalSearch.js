import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * 활성 터미널 검색 오버레이 상태/핸들러. App.jsx 에서 로직 변경 없이 추출.
 * window.terminalSessions[key] 의 searchNext/searchPrevious/closeSearch API 를 호출한다.
 *
 * 입력: { activeTab, t, focusActiveTerminal }
 * 반환: 검색 상태 + open/close/execute 핸들러 + 입력 ref.
 */
export default function useTerminalSearch({ activeTab, t, focusActiveTerminal }) {
  const [isTerminalSearchOpen, setIsTerminalSearchOpen] = useState(false);
  const [terminalSearchQuery, setTerminalSearchQuery] = useState('');
  const [terminalSearchStatus, setTerminalSearchStatus] = useState('');
  const terminalSearchInputRef = useRef(null);

  const openTerminalSearch = useCallback(() => {
    setTerminalSearchStatus('');
    setIsTerminalSearchOpen(true);
    setTimeout(() => terminalSearchInputRef.current?.focus(), 20);
  }, []);

  const closeTerminalSearch = useCallback(() => {
    setIsTerminalSearchOpen(false);
    setTerminalSearchStatus('');
    const key = activeTab?.sessionId || activeTab?.id;
    window.terminalSessions?.[key]?.closeSearch?.();
  }, [activeTab]);

  const executeTerminalSearch = useCallback((dir = 'next') => {
    if (!terminalSearchQuery.trim()) return;
    const key = activeTab?.sessionId || activeTab?.id;
    const api = window.terminalSessions?.[key];
    if (!api) return;
    const matched = dir === 'previous'
      ? api.searchPrevious?.(terminalSearchQuery, {}) || false
      : api.searchNext?.(terminalSearchQuery, {}) || false;
    setTerminalSearchStatus(matched ? t('searchMatchFound') : t('searchNoResults'));
  }, [activeTab, terminalSearchQuery, t]);

  useEffect(() => { setTerminalSearchStatus(''); }, [terminalSearchQuery]);

  useEffect(() => {
    if (!isTerminalSearchOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeTerminalSearch(); focusActiveTerminal(); }
      if (e.key === 'Enter') { e.preventDefault(); executeTerminalSearch(e.shiftKey ? 'previous' : 'next'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTerminalSearchOpen, closeTerminalSearch, focusActiveTerminal, executeTerminalSearch]);

  return {
    isTerminalSearchOpen,
    terminalSearchQuery,
    setTerminalSearchQuery,
    terminalSearchStatus,
    terminalSearchInputRef,
    openTerminalSearch,
    closeTerminalSearch,
    executeTerminalSearch,
  };
}
