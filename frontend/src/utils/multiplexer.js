/**
 * 무엇으로 세션을 잡아 둘 것인가 — **선택이고, 안 골라도 된다.**
 *
 * `backend/multiplexer.py` 의 거울이다. 두 쪽이 어긋나면 화면이 "tmux" 라고 그리는데
 * 서버는 herdr 를 띄우는 조합이 되고, 그건 **저장하고 다시 연결해 보기 전까지 안
 * 드러난다.** 그래서 되짚기 규칙(`fromHost`)까지 여기 함께 둔다.
 *
 * ⚠️ **`none` 은 고장이 아니다.** 셸이 하나 뜨고 탭을 닫으면 끝난다 — 많은 쓰임에 그게
 * 맞다. 다만 그 사실은 **닫기 전에** 알려야 하고, 그 판정이 `persists()` 하나다.
 *
 * ⚠️ **고르는 자리는 설정 한 곳뿐이다**(설정 → 세션 멀티플렉서). 이 서버의 pane 도
 * 호스트의 pane 도 같은 값을 따른다 — "herdr 로 두면 앞으로 여는 건 전부 herdr".
 * 호스트마다 또 고르게 두면 같은 결정이 두 자리에 생기고, 전역 값을 바꿔도 옛 호스트가
 * 따라오지 않는다. 호스트 행의 값은 옛 `use_remote_tmux=0` 을 존중하기 위해서만 읽는다.
 */

export const TMUX = 'tmux';
export const HERDR = 'herdr';
export const NONE = 'none';

/** 화면의 선택지 순서이기도 하다. */
export const CHOICES = [TMUX, HERDR, NONE];

/** 아무 것도 안 고른 호스트의 기본. 이 저장소가 tmux 위에 지어졌으므로 tmux 다. */
export const DEFAULT = TMUX;

export const normalize = (value, fallback = DEFAULT) => (
  CHOICES.includes(value) ? value : fallback
);

/** 이 선택에서 세션이 접속을 넘어 살아남는가. 안내는 이 한 줄만 본다. */
export const persists = (choice) => normalize(choice) !== NONE;

/**
 * 호스트 행 → 선택. 새 칸이 없으면 옛 `use_remote_tmux` 로 되짚는다.
 *
 * 되짚기는 **끄기만** 표현할 수 있다: 옛 스키마에는 herdr 라는 값이 아예 없었으므로
 * `use_remote_tmux=1` 은 "tmux" 가 아니라 "기본값 그대로" 라는 뜻이다.
 */
export const fromHost = (host, fallback = DEFAULT) => {
  if (!host) return normalize(null, fallback);
  if (host.multiplexer) return normalize(host.multiplexer, fallback);
  if (!host.use_remote_tmux) return NONE;
  return normalize(null, fallback);
};

/** 설정 셀렉트의 라벨 — 도구 이름은 번역하지 않는다. */
export const OPTIONS = [
  { value: TMUX, label: 'tmux' },
  { value: HERDR, label: 'herdr' },
  { value: NONE, label: 'none' },
];

/** 고른 값이 실제로 무엇을 뜻하는지 한 줄. 특히 `none` 은 반드시 읽혀야 한다. */
export const HINTS = {
  [TMUX]: (t) => t?.('muxHintTmux')
    || '연결이 끊겨도 원격 tmux 가 세션을 살려둡니다.',
  [HERDR]: (t) => t?.('muxHintHerdr')
    || '연결이 끊겨도 herdr 가 세션을 살려둡니다. 없으면 도구 설치에서 깔 수 있습니다.',
  // tmux 를 밑에 깔지 않는다 — 고른 것 하나만 돈다(backend/local_mux.py).
  [NONE]: (t) => t?.('muxHintNone')
    || '평범한 SSH 셸입니다. 탭을 닫거나 연결이 끊기면 실행 중이던 작업도 끝납니다.',
};
