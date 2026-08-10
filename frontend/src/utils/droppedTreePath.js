/**
 * 파일 탐색기에서 끌어다 터미널에 떨군 경로 → 그 셸에 타이핑할 문자열.
 *
 * 바깥(OS)에서 온 드롭과 다른 점: **파일이 이미 그 기계에 있다.** 업로드할 게 없고
 * 경로만 넣으면 된다. 대신 트리가 내는 경로의 형태가 pane 종류마다 달라서 그대로는 못 쓴다:
 *
 *   로컬  워크스페이스 상대 (`iTerminaLlist/backend`)
 *   원격  절대            (`/home/pi/app`)
 *
 * 상대 경로를 그대로 넣으면 셸의 cwd 가 워크스페이스 루트가 아닐 때 엉뚱한 곳을 가리킨다.
 * 그래서 로컬은 절대 경로로 바꿔 넣는다 — 셸이 어디에 있든 같은 곳을 가리킨다.
 *
 * ⚠️ 엔터는 치지 않는다(호출부 규칙). 드롭이 곧 실행이면 vim/claude 한가운데서 사고가 난다.
 */

/**
 * pane 의 두 cwd 표현에서 워크스페이스 루트를 역산한다.
 *
 * 백엔드에 물어볼 수도 있지만, pane 은 이미 같은 위치를 절대·상대 두 벌로 들고 있다.
 * 둘의 차이가 곧 루트다. 못 구하면 '' — 호출부가 폴백을 고른다.
 */
export function workspaceRootFrom(cwdAbs, cwdRel) {
  const abs = String(cwdAbs || '').replace(/\/+$/, '');
  if (!abs) return '';
  const rel = String(cwdRel || '').replace(/^\/+|\/+$/g, '');
  if (!rel) return abs;                       // cwd 가 루트 자신
  const suffix = `/${rel}`;
  return abs.endsWith(suffix) ? abs.slice(0, -suffix.length) : '';
}

/**
 * 떨군 트리 경로를 셸에 넣을 문자열로. 판단이 안 서면 '' 를 돌려준다(아무것도 넣지 않는다).
 *
 * 원격은 트리 경로가 이미 절대라 그대로. 로컬은 루트를 알면 절대로 바꾸고, 모르면
 * **상대 경로를 그대로 넣지 않는다** — 조용히 다른 디렉토리를 가리키느니 안 넣는 편이 낫다.
 */
export function shellPathForTreeDrop({ treePath, isLocal, cwdAbs = '', cwdRel = '' } = {}) {
  const path = String(treePath || '').trim();
  if (!path) return '';
  if (!isLocal) return path;                  // 원격 트리는 절대 경로를 낸다
  if (path.startsWith('/')) return path;      // 이미 절대면 그대로
  const root = workspaceRootFrom(cwdAbs, cwdRel);
  return root ? `${root}/${path}` : '';
}

export default shellPathForTreeDrop;
