import { useCallback, useEffect, useState } from 'react';
import { Toggle } from './SettingsFields';
import {
  pushCapability, subscribeToPush, unsubscribeFromPush, isSubscribed,
} from '../../utils/pushSubscription';

/**
 * "에이전트 작업이 끝나면 알림" 토글.
 *
 * 구독 자체가 opt-in 이라 서버에 따로 설정 값을 두지 않는다 — 이 기기가 구독 중이면
 * 켜진 것이고, 해제하면 꺼진 것이다. 그래서 상태를 브라우저에서 읽어온다.
 *
 * 실패 사유는 절대 "실패"로 뭉개지 않는다. 특히 http://<사설IP> 접속은 브라우저가
 * 푸시 API 자체를 막는 경우라, 설정을 뒤질 게 아니라 접속 주소를 바꿔야 한다.
 */
const PushNotificationToggle = ({ t }) => {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [capability, setCapability] = useState('ok');
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setCapability(pushCapability());
    isSubscribed().then((on) => { if (!cancelled) setEnabled(on); });
    return () => { cancelled = true; };
  }, []);

  const handleChange = useCallback(async (next) => {
    setBusy(true);
    setError(null);
    const result = next ? await subscribeToPush() : await unsubscribeFromPush();
    if (result.ok) {
      setEnabled(next);
      setCapability(pushCapability());
    } else {
      setError(result.reason);
      setCapability(pushCapability());
    }
    setBusy(false);
  }, []);

  const blocked = capability === 'insecure' || capability === 'unsupported';

  const hint = (() => {
    if (capability === 'insecure') {
      return t('pushInsecureHint')
        || 'Push needs a secure connection. Open the app over HTTPS or on localhost — browsers block it on plain-http IP addresses.';
    }
    if (capability === 'unsupported') {
      return t('pushUnsupportedHint') || 'This browser does not support web push.';
    }
    if (error === 'denied' || capability === 'denied') {
      return t('pushDeniedHint')
        || 'Notifications are blocked for this site. Allow them in your browser settings, then try again.';
    }
    if (error === 'failed') {
      return t('pushFailedHint') || 'Could not register for push. Try again.';
    }
    return t('agentDonePushHint')
      || 'Get a notification when an agent finishes a turn. Silent while you are looking at the app.';
  })();

  return (
    <Toggle
      label={t('agentDonePush') || 'Notify when an agent finishes'}
      hint={hint}
      checked={enabled && !blocked}
      onChange={busy || blocked ? () => {} : handleChange}
    />
  );
};

export default PushNotificationToggle;
