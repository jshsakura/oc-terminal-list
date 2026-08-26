import { useCallback, useEffect, useState } from 'react';
import { Field, Toggle } from './SettingsFields';
import { styles } from './settingsStyles';
import { authHeaders } from '../../utils/auth';

/**
 * 텔레그램 연동 — 알림에 **버튼**을 붙이기 위한 채널.
 *
 * 웹 푸시로도 알림은 오지만, 액션 버튼(`showNotification`의 `actions`)이 iOS 에서
 * 렌더되지 않는다. 아이폰에서는 "계속" 버튼 자체가 안 보인다는 뜻이다.
 * 텔레그램 인라인 키보드는 플랫폼을 가리지 않는다.
 *
 * ⚠️ 켜면 pane 타이틀(작업 내용)이 텔레그램 서버를 지난다. 그리고 그 방에 들어올 수
 * 있는 사람은 버튼을 눌러 터미널에 입력을 넣을 수 있다 — 그래서 chat ID 를 고정하고,
 * 버튼이 보낼 수 있는 문구도 서버가 정한 것만 허용한다.
 */
const TelegramSection = ({ t }) => {
  const [configured, setConfigured] = useState(false);
  const [chatId, setChatId] = useState('');
  const [token, setToken] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [baseUrlFromEnv, setBaseUrlFromEnv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  /* 하루 한 번 가는 사용량·누수 요약. **기본은 꺼짐**이고 여기서만 켠다 —
     밖으로 나가는 알림을 묻지 않고 켜면 안 된다. */
  const [reportEnabled, setReportEnabled] = useState(false);
  const [reportFromEnv, setReportFromEnv] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/push/telegram', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setConfigured(!!d.configured);
        setChatId(d.chat_id || '');
        setBaseUrl(d.base_url || '');
        setBaseUrlFromEnv(!!d.base_url_from_env);
      })
      .catch(() => { /* 설정 화면이 못 뜰 이유는 아니다 */ });
    fetch('/api/push/usage-report', { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setReportEnabled(!!d.enabled);
        setReportFromEnv(!!d.from_env);
      })
      .catch(() => { /* 상동 */ });
    return () => { cancelled = true; };
  }, []);

  /* 스위치는 **즉시** 반영한다. 저장 버튼 뒤에 숨기면 "껐는데 또 왔다" 가 된다. */
  const toggleReport = useCallback(async (next) => {
    setReportEnabled(next);              // 낙관적 — 실패하면 되돌린다
    try {
      const res = await fetch('/api/push/usage-report', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setReportEnabled(!!d.enabled);
    } catch {
      setReportEnabled(!next);
      setNotice({ kind: 'error', text: t?.('usageReportSaveFailed') || '설정을 저장하지 못했습니다' });
    }
  }, [t]);

  const save = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/push/telegram', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ token: token.trim(), chat_id: chatId.trim(), base_url: baseUrl.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice({ kind: 'error', text: data?.detail || t?.('telegramSaveFailed') || '저장 실패' });
      } else {
        setConfigured(!!data.configured);
        setToken('');   // 토큰은 화면에 남기지 않는다
        setNotice({
          kind: 'ok',
          text: data.bot ? `@${data.bot} ${t?.('telegramConnected') || '연결됨'}` : (t?.('telegramSaved') || '저장됨'),
        });
      }
    } catch {
      setNotice({ kind: 'error', text: t?.('telegramSaveFailed') || '저장 실패' });
    }
    setBusy(false);
  }, [token, chatId, baseUrl, t]);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/push/telegram/test', { method: 'POST', headers: authHeaders() });
      const data = await res.json().catch(() => null);
      setNotice(res.ok
        ? { kind: 'ok', text: t?.('telegramTestSent') || '테스트 메시지를 보냈습니다' }
        : { kind: 'error', text: data?.detail || t?.('telegramTestFailed') || '전송 실패' });
    } catch {
      setNotice({ kind: 'error', text: t?.('telegramTestFailed') || '전송 실패' });
    }
    setBusy(false);
  }, [t]);

  return (
    <>
      <Field
        label={t?.('telegramBotToken') || 'Bot token'}
        hint={t?.('telegramBotTokenHint')
          || '@BotFather 에서 봇을 만들고 받은 토큰. 저장 후에는 다시 보여주지 않습니다.'}
      >
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={configured ? '••••••••  (저장됨)' : '123456:ABC-DEF...'}
          style={styles.input}
          autoComplete="off"
        />
      </Field>
      <Field
        label={t?.('telegramChatId') || 'Chat ID'}
        hint={t?.('telegramChatIdHint')
          || '알림을 받을 대화방 ID. 이 방에서 온 버튼만 처리합니다.'}
      >
        <input
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder="123456789"
          style={styles.input}
          inputMode="numeric"
        />
      </Field>
      <Field
        label={t?.('telegramBaseUrl') || '앱 주소 (열기 버튼)'}
        hint={baseUrlFromEnv
          ? (t?.('telegramBaseUrlEnv') || 'PUBLIC_BASE_URL 환경변수로 설정됨 — 여기서는 수정할 수 없습니다.')
          : (t?.('telegramBaseUrlHint')
            || '알림의 "열기" 버튼이 가리킬 공개 주소(예: https://term.example.com). 비우면 버튼이 붙지 않습니다.')}
      >
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://term.example.com"
          style={styles.input}
          inputMode="url"
          autoComplete="off"
          disabled={baseUrlFromEnv}
        />
      </Field>
      <Toggle
        label={t?.('usageReportToggle') || '하루 한 번 사용량 요약 받기'}
        checked={reportEnabled}
        /* env 로 정해진 경우 눌러도 아무 일 없게 — Toggle 은 onChange 를 무조건 부르므로
           undefined 를 넘기면 클릭에서 터진다. */
        onChange={reportFromEnv ? () => {} : toggleReport}
        hint={reportFromEnv
          ? (t?.('usageReportEnv') || 'USAGE_REPORT_ENABLED 환경변수로 설정됨 — 여기서는 바꿀 수 없습니다.')
          : (t?.('usageReportHint')
            || '어제 쓴 토큰과 누수 신호를 매일 아침 이 방으로 보냅니다. 기본은 꺼짐이며, 보낼 내용이 없는 날은 아무것도 오지 않습니다.')}
      />
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={save} disabled={busy} style={styles.inlineLogoutBtn}>
          {t?.('telegramSave') || '연결 저장'}
        </button>
        <button type="button" onClick={sendTest} disabled={busy || !configured} style={styles.inlineLogoutBtn}>
          {t?.('telegramTest') || '테스트 전송'}
        </button>
        {notice && (
          <span style={{ ...styles.hint, color: notice.kind === 'error' ? 'var(--ui-danger)' : 'var(--ui-success)' }}>
            {notice.text}
          </span>
        )}
      </div>
    </>
  );
};

export default TelegramSection;
