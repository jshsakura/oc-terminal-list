import { useSyncExternalStore } from 'react';
import { subscribeAgentStatus, getAgentStatusSnapshot } from '../utils/agentStatusStore';

/**
 * 세션ID → { status, title, command } 맵.
 * 구독한 컴포넌트만 다시 그린다 (스토어 설계는 utils/agentStatusStore.js 참고).
 */
const useAgentStatus = () => useSyncExternalStore(subscribeAgentStatus, getAgentStatusSnapshot);

export default useAgentStatus;
