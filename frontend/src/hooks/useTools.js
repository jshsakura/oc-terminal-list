import { useCallback, useState } from 'react';
import apiFetch from '../utils/apiFetch';
import { authHeaders } from '../utils/auth';

/**
 * 설치 도구 목록 + 그 기계에 깔려 있는지.
 *
 * ⚠️ **확인은 화면을 열 때 한 번이다.** 폴링하지 않는다 — 한 번이 곧 SSH 왕복 하나이고,
 * 이 저장소는 되풀이되는 왕복 때문에 홈 화면이 멈춰 서던 사고를 이미 겪었다
 * (CLAUDE.md "가르는 기준은 SSH 냐가 아니라 얼마나 자주 부르냐다").
 *
 * ⚠️ **못 물어본 것은 `null` 로 남긴다.** 못 닿은 호스트를 "안 깔림" 으로 그리면
 * 사용자는 실패할 설치 버튼을 누르게 된다.
 */
const CHECK_TIMEOUT_MS = 20000;

const useTools = () => {
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState({});
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/tools', { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setTools(body.tools || []);
      return body.tools || [];
    } catch (e) {
      setError(e.message || 'failed');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const check = useCallback(async (hostId) => {
    setChecking(true);
    setCheckError(null);
    setStatus({});
    try {
      const res = await apiFetch('/api/tools/check', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ host_id: hostId || '' }),
        timeoutMs: CHECK_TIMEOUT_MS,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setStatus(body.results || {});
      if (body.error) setCheckError(body.error);
    } catch (e) {
      setCheckError(e.message || 'failed');
    } finally {
      setChecking(false);
    }
  }, []);

  const create = useCallback(async (tool) => {
    const res = await apiFetch('/api/tools', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(tool),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
  }, [load]);

  const update = useCallback(async (toolId, patch) => {
    const res = await apiFetch(`/api/tools/${toolId}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
  }, [load]);

  const remove = useCallback(async (toolId) => {
    const res = await apiFetch(`/api/tools/${toolId}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
  }, [load]);

  /* Push-installed tools (`install_kind: 'push'`, today only itl): the backend places or
     deletes one file under ~/.local/bin on the chosen machine. Nothing is typed into a
     terminal, so this is the one place the panel acts on the host itself — and the row
     re-checks afterwards so the chip shows what actually happened, not what we hoped. */
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const pushAction = useCallback(async (hostId, toolId, action) => {
    setBusyId(toolId);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/tools/${encodeURIComponent(toolId)}/${action}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ host_id: hostId || '' }),
        timeoutMs: CHECK_TIMEOUT_MS,
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json())?.detail || ''; } catch { /* body is optional */ }
        throw new Error(detail || `HTTP ${res.status}`);
      }
      await check(hostId);
      return true;
    } catch (e) {
      setActionError(e.message || 'failed');
      return false;
    } finally {
      setBusyId(null);
    }
  }, [check]);

  const push = useCallback((hostId, toolId) => pushAction(hostId, toolId, 'install'), [pushAction]);
  const unpush = useCallback((hostId, toolId) => pushAction(hostId, toolId, 'uninstall'), [pushAction]);

  return {
    tools, loading, error, status, checking, checkError,
    load, check, create, update, remove,
    push, unpush, busyId, actionError,
  };
};

export default useTools;
