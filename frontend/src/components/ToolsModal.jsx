import { useCallback, useEffect, useState } from 'react';
import { Package, Plus, RefreshCw, Loader2 } from 'lucide-react';
import GlassModal from './common/GlassModal';
import Button from './common/Button';
import ToolRow from './tools/ToolRow';
import ToolForm from './tools/ToolForm';
import { toolsStyles as styles } from './tools/toolsStyles';
import useTools from '../hooks/useTools';
import copyToClipboard from '../utils/clipboard';

/**
 * 이 기계에 무엇을 깔 것인가 — 한 자리.
 *
 * 이 앱은 오래 **자기 것 두 개**만 설치할 줄 알았다. 그건 거꾸로다: 기계도 셸도
 * 사용자의 것이고, 거기 무엇이 올라갈지는 사용자가 정한다. 그래서 목록은 코드가 아니라
 * 데이터다 — 내장 둘(tmux·itl)과, 사용자가 쓰는 만큼.
 *
 * ⚠️ **설치를 우리가 실행하지 않는다.** 그 호스트의 터미널을 열어 명령을 타이핑하고,
 * 엔터는 사용자가 누른다. sudo 프롬프트·진행 표시·중단이 전부 사람이 보는 터미널에서만
 * 제대로 되고, 그래야 이 기능이 **새 권한을 만들지 않는다**(직접 칠 수 있는 것을 대신
 * 쳐 줄 뿐).
 *
 * 예외 하나: `install_kind: 'push'`(itl). 파일 하나를 `~/.local/bin` 에 놓는 것이 설치의
 * 전부라 백엔드가 직접 놓고 직접 지운다 — 설치와 제거가 같은 무게여야 "언제든 지울 수
 * 있다" 가 말이 된다.
 */
const LOCAL_ID = '';

const ToolsModal = ({ isOpen, onClose, hosts = [], initialHostId = '', onInstall, t }) => {
  const [hostId, setHostId] = useState(initialHostId || LOCAL_ID);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const {
    tools, loading, error, status, checking, checkError,
    load, check, create, update, remove,
    push, unpush, busyId, actionError,
  } = useTools();

  useEffect(() => { if (isOpen) setHostId(initialHostId || LOCAL_ID); }, [isOpen, initialHostId]);

  useEffect(() => {
    if (!isOpen) return;
    load();
  }, [isOpen, load]);

  // 목록이 오고 나서 확인한다 — 확인할 대상이 목록이기 때문. 호스트를 바꾸면 다시.
  useEffect(() => {
    if (!isOpen || loading) return;
    check(hostId);
  }, [isOpen, hostId, loading, check]);

  const install = useCallback((tool) => {
    const host = hostId ? hosts.find((h) => h.id === hostId) : null;
    onInstall?.(host, tool.install_command);
    onClose?.();
  }, [hostId, hosts, onInstall, onClose]);

  const copy = useCallback(async (tool) => {
    // 결과를 boolean 으로 받는다 — 실패했는데 "복사됨" 을 띄우면 사용자는 붙여넣기를
    // 시도한 뒤에야 안다(utils/clipboard 의 규칙).
    if (await copyToClipboard(tool.install_command)) {
      setCopiedId(tool.id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  }, []);

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title={t?.('tools') || '도구 설치'}
      titleIcon={Package}
      maxWidth="560px"
      closeTitle={t?.('close') || '닫기'}
    >
      <div style={styles.wrap}>
        <div style={styles.pickerRow}>
          <select
            style={styles.select}
            value={hostId}
            onChange={(e) => setHostId(e.target.value)}
            aria-label={t?.('installTarget') || '설치할 기계'}
          >
            <option value={LOCAL_ID}>{t?.('thisServer') || '이 서버'}</option>
            {hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <Button
            variant="ghost" size="small" type="button"
            icon={checking ? Loader2 : RefreshCw}
            disabled={checking}
            onClick={() => check(hostId)}
          >
            {checking ? (t?.('checking') || '확인 중…') : (t?.('recheck') || '다시 확인')}
          </Button>
        </div>

        {checkError && (
          /* ⚠️ 확인 실패는 설치 실패가 아니다. 상태만 모르는 것이고 설치는 그대로 된다. */
          <div style={styles.warn}>
            {t?.('toolCheckFailed') || '설치 여부를 확인하지 못했습니다'} — {checkError}
          </div>
        )}
        {error && <div style={styles.error}>{error}</div>}
        {actionError && (
          <div style={styles.error}>
            {t?.('toolActionFailed') || '설치/제거에 실패했습니다'} — {actionError}
          </div>
        )}

        {loading && tools.length === 0 && (
          <span style={styles.muted}>{t?.('loading') || 'Loading…'}</span>
        )}

        <div style={styles.list}>
          {tools.map((tool) => (
            editing === tool.id ? (
              <div key={tool.id} style={styles.row}>
                <ToolForm
                  initial={tool}
                  t={t}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (body) => { await update(tool.id, body); setEditing(null); }}
                />
              </div>
            ) : (
              <ToolRow
                key={tool.id}
                tool={tool}
                state={status[tool.id]}
                copied={copiedId === tool.id}
                t={t}
                onInstall={() => install(tool)}
                onCopy={() => copy(tool)}
                onPush={() => push(hostId, tool.id)}
                onUnpush={() => unpush(hostId, tool.id)}
                busy={busyId === tool.id}
                onEdit={() => { setEditing(tool.id); setAdding(false); }}
                onDelete={() => remove(tool.id)}
              />
            )
          ))}
        </div>

        {adding ? (
          <div style={styles.row}>
            <ToolForm
              t={t}
              onCancel={() => setAdding(false)}
              onSubmit={async (body) => { await create(body); setAdding(false); }}
            />
          </div>
        ) : (
          <Button variant="ghost" size="small" type="button" icon={Plus} onClick={() => setAdding(true)}>
            {t?.('toolAdd') || '직접 추가'}
          </Button>
        )}

        <div style={styles.muted}>
          {t?.('toolsFoot')
            || '설치는 선택한 기계의 터미널을 새로 열어 명령을 붙여 넣습니다. 무엇이 실행될지 보고 직접 엔터를 누르세요.'}
          {' '}
          {t?.('toolsFootPush')
            || 'itl 은 파일 하나라 이 화면에서 바로 놓고 지웁니다.'}
        </div>
      </div>
    </GlassModal>
  );
};

export default ToolsModal;
