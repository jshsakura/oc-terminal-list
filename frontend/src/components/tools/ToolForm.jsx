import { useState } from 'react';
import Button from '../common/Button';
import { toolsStyles as styles } from './toolsStyles';

/**
 * 사용자가 직접 쓰는 도구 — 이 앱이 무엇을 깔 수 있는지 정하지 않는다는 뜻이다.
 *
 * 확인 명령을 **선택**으로 두는 이유: 없으면 상태가 "모름" 으로 남을 뿐 설치는 그대로
 * 된다. 필수로 만들면 급할 때 못 쓰는 폼이 된다.
 */
const empty = { name: '', install_command: '', check_command: '', description: '', url: '' };

const ToolForm = ({ initial, onSubmit, onCancel, t }) => {
  const [form, setForm] = useState({ ...empty, ...(initial || {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.install_command.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: form.name.trim(),
        install_command: form.install_command.trim(),
        check_command: form.check_command.trim(),
        description: form.description.trim(),
        url: form.url.trim(),
      });
    } catch (err) {
      setError(err.message || 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form style={styles.form} onSubmit={submit}>
      <div>
        <div style={styles.label}>{t?.('toolName') || '이름'}</div>
        <input style={styles.input} value={form.name} onChange={set('name')} autoFocus />
      </div>
      <div>
        <div style={styles.label}>{t?.('toolInstallCommand') || '설치 명령'}</div>
        <textarea style={styles.textarea} value={form.install_command} onChange={set('install_command')} />
      </div>
      <div>
        <div style={styles.label}>
          {t?.('toolCheckCommand') || '확인 명령 (선택)'}
        </div>
        <input
          style={styles.input}
          value={form.check_command}
          onChange={set('check_command')}
          placeholder="command -v lazygit"
        />
        {/* ⚠️ 확인 명령은 그 도구를 **실행하지 않는 것**이 안전하다. `x --version` 은
            모르는 플래그를 만나면 TUI 를 띄우는 프로그램이 있고, tty 가 없는 확인
            경로에서 그러면 상한까지 매달린다. */}
        <div style={styles.muted}>
          {t?.('toolCheckHint')
            || '`command -v 이름` 을 권합니다 — 프로그램을 실제로 실행하지 않아 확인이 멈추지 않습니다.'}
        </div>
      </div>
      <div>
        <div style={styles.label}>{t?.('toolDescription') || '설명 (선택)'}</div>
        <input style={styles.input} value={form.description} onChange={set('description')} />
      </div>
      <div>
        <div style={styles.label}>{t?.('toolUrl') || '링크 (선택)'}</div>
        <input style={styles.input} value={form.url} onChange={set('url')} placeholder="https://" />
      </div>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.actions}>
        <Button variant="primary" size="small" type="submit" disabled={busy}>
          {t?.('save') || '저장'}
        </Button>
        <Button variant="ghost" size="small" type="button" onClick={onCancel}>
          {t?.('cancel') || '취소'}
        </Button>
      </div>
    </form>
  );
};

export default ToolForm;
