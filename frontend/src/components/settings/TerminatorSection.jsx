import { useCallback, useEffect, useState } from 'react';
import Button from '../common/Button';
import { Field } from './SettingsFields';
import { styles } from './settingsStyles';
import {
  fetchTerminatorConfig, saveTerminatorConfig, checkTerminator,
} from '../../utils/terminatorApi';

/**
 * Terminator's connection: the Z.ai key and the model.
 *
 * It saves on its own button, apart from the settings form: the key is a server-side
 * file, not a user setting, and it is write-only. The field never shows the saved key,
 * only its last four characters, so it starts empty every time.
 */
const DANGER = 'var(--ui-danger, #e5484d)';
const SUCCESS = 'var(--ui-success, #9ece6a)';

const TerminatorSection = ({ t }) => {
  const tr = (key, fallback) => t?.(key) || fallback;
  const [config, setConfig] = useState(null);      // { configured, key_hint, model, default_model }
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);      // { ok, text }

  const apply = useCallback((data) => {
    setConfig(data);
    setModel(data?.model === data?.default_model ? '' : (data?.model || ''));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchTerminatorConfig()
      .then((data) => { if (!cancelled) apply(data); })
      .catch((exc) => { if (!cancelled) setNotice({ ok: false, text: exc.message }); });
    return () => { cancelled = true; };
  }, [apply]);

  const savedModel = config && config.model !== config.default_model ? config.model : '';
  const changed = key.trim() !== '' || model.trim().toLowerCase() !== savedModel;

  const run = async (work, done) => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await work();
      setNotice({ ok: true, text: done(data) });
    } catch (exc) {
      setNotice({ ok: false, text: exc.message || tr('saveFailed', '저장하지 못했습니다') });
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(async () => {
    const data = await saveTerminatorConfig({
      ...(key.trim() ? { api_key: key.trim() } : {}),
      model: model.trim(),
    });
    apply(data);
    setKey('');
    return data;
  }, () => tr('terminatorConfigSaved', '저장했습니다. 연결 확인으로 답이 오는지 봅니다'));

  const clearKey = () => run(async () => {
    const data = await saveTerminatorConfig({ clear_key: true });
    apply(data);
    return data;
  }, () => tr('terminatorKeyCleared', '키를 지웠습니다. 터미네이터는 키를 넣을 때까지 쉽니다'));

  const check = () => run(checkTerminator, (data) => (
    tr('terminatorCheckOk', '{model} 이 {ms}ms 만에 답했습니다')
      .replace('{model}', data.model).replace('{ms}', String(data.ms))
  ));

  if (!config) {
    return notice ? <div style={{ ...styles.hint, color: DANGER }}>{notice.text}</div> : null;
  }

  return (
    <>
      <div style={styles.hint}>
        {config.configured
          ? tr('terminatorConfigured', '연결됨 · 키 끝자리 {hint} · {model}')
            .replace('{hint}', config.key_hint || '****').replace('{model}', config.model)
          : tr('terminatorNotConfigured', '키가 없습니다. Z.ai 에서 받은 키를 넣으면 화면 도움말이 켜집니다')}
      </div>
      <Field
        label={tr('terminatorKey', 'Z.ai API 키')}
        hint={tr('terminatorKeyHint', '이 서버의 ~/.config/zai/api_key 에만 저장되고 다시 보이지 않습니다')}
      >
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={config.configured
            ? tr('terminatorKeyReplace', '바꾸려면 새 키를 붙여 넣습니다')
            : tr('terminatorKeyPaste', '키를 붙여 넣습니다')}
          style={styles.input}
        />
      </Field>
      <Field
        label={tr('terminatorModel', '모델')}
        hint={tr('terminatorModelHint', '비우면 기본값({model})을 씁니다').replace('{model}', config.default_model)}
      >
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={config.default_model}
          style={styles.input}
        />
      </Field>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <Button variant="primary" onClick={save} disabled={busy || !changed}>
          {tr('save', '저장')}
        </Button>
        <Button variant="secondary" onClick={check} disabled={busy || !config.configured}>
          {tr('terminatorCheck', '연결 확인')}
        </Button>
        {config.configured && (
          <Button variant="ghost" onClick={clearKey} disabled={busy}>
            {tr('terminatorKeyClear', '키 지우기')}
          </Button>
        )}
      </div>
      {notice && (
        <div role="status" style={{ ...styles.hint, color: notice.ok ? SUCCESS : DANGER }}>{notice.text}</div>
      )}
    </>
  );
};

export default TerminatorSection;
