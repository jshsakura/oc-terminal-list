import { useEffect, useState } from 'react';
import { getCommands, COMMAND_HISTORY_EVENT } from '../utils/commandHistory';

// 특정 터미널의 명령 히스토리 (최근 N 개) 를 구독. terminalKey 가 없으면 빈 배열.
// storage 이벤트 (다른 탭) 와 내부 dispatch (같은 탭) 양쪽을 듣는다.
const useCommandHistory = (terminalKey) => {
  const [items, setItems] = useState(() => (terminalKey ? getCommands(terminalKey) : []));

  useEffect(() => {
    if (!terminalKey) { setItems([]); return undefined; }
    const refresh = () => setItems(getCommands(terminalKey));
    refresh();
    window.addEventListener(COMMAND_HISTORY_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(COMMAND_HISTORY_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [terminalKey]);

  return items;
};

export default useCommandHistory;
