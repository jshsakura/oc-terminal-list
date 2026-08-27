import copyToClipboard from '../../utils/clipboard';

/**
 * OSC 52 — 터미널 안에서 고른 것을 **브라우저 클립보드**로.
 *
 * tmux 는 `set-clipboard on` 일 때 선택 결과를 `OSC 52 ; c ; <base64>` 로 실어 보낸다.
 * xterm.js 는 이걸 기본으로 처리하지 않으므로(우리가 붙여야 한다), 없으면 드래그 선택이
 * tmux 버퍼에만 남고 브라우저에서는 붙여넣을 수 없다 — "복사가 안 된다" 로 보인다.
 *
 * ⚠️ **쓰기만 받는다.** OSC 52 는 클립보드 *읽기*(`?`)도 정의하는데, 그건 원격이 사용자
 * 클립보드를 훔쳐볼 수 있는 통로다(다른 창에서 복사해 둔 비밀번호까지). 읽기 요청은
 * 조용히 무시한다 — 거절이 아니라 응답을 안 하는 쪽이 맞다. 응답하면 그 자체로
 * "이 터미널은 읽기를 지원한다" 를 알려주는 셈이다.
 *
 * ⚠️ 클립보드 쓰기는 `utils/clipboard` 를 지난다. 비보안 오리진·인앱 웹뷰에서
 * `navigator.clipboard` 가 아예 없거나 거절되는 케이스를 그쪽이 이미 다룬다.
 */
const MAX_BYTES = 512 * 1024;   // 붙여넣기용이지 파일 전송 통로가 아니다

export const registerOsc52 = (term) => {
  if (!term?.parser?.registerOscHandler) return () => {};
  const dispose = term.parser.registerOscHandler(52, (payload) => {
    const [, data = ''] = String(payload || '').split(';');
    if (!data || data === '?') return true;      // 읽기 요청 — 응답하지 않는다
    if (data.length > MAX_BYTES) return true;
    let text = '';
    try {
      text = decodeURIComponent(escape(window.atob(data)));
    } catch {
      try {
        text = window.atob(data);                // UTF-8 이 아니어도 붙여넣을 수 있게
      } catch {
        return true;                             // 깨진 payload — 조용히 버린다
      }
    }
    if (text) copyToClipboard(text);
    return true;                                  // 처리했다 — 화면에 흘리지 않는다
  });
  return () => { try { dispose?.dispose?.(); } catch { /* 이미 정리됨 */ } };
};

export default registerOsc52;
