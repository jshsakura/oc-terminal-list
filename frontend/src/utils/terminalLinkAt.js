/**
 * 클라이언트 좌표(clientX, clientY) 위치의 터미널 셀에 URL 링크가 있으면 반환.
 *
 * 재사용: WebLinksAddon(@xterm/addon-web-links) 이 터미널에 등록해 둔 URL 인식과
 * 동일한 관심사를 다룬다. 다만 Addon 이 내부에 캡슐화한 정규식을 직접 끄낼 수 없어,
 * 여기서는 좌표 → 셀 → 라인 텍스트 → URL 매칭 경로로 같은 결과를 얻는다.
 * 새 파서를 만드는 것이 아니라 기존 링크 인식의 "좌표 조회" 보조 함수다.
 *
 * 파일 경로 링크(utils/terminalFileLinks.js + registerLinkProvider)는
 * activate 시 에디터를 여는 동작이라 URL 복사 대상이 아니다 — http/https 만 처리한다.
 */

// http/https URL — WebLinksAddon 과 동일한 관심사. 끝문자 처리로 마침표/괄호 제거.
const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

/**
 * @param {import('@xterm/xterm').Terminal | null | undefined} term
 * @param {number} clientX
 * @param {number} clientY
 * @returns {string | null} URL 텍스트, 없으면 null
 */
export function getLinkAtClient(term, clientX, clientY) {
  if (!term || !term.element) return null;
  const rect = term.element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  // DOM rect → 셀 좌표. xterm 내부 패딩이 있을 수 있지만(보통 0~수 px),
  // 링크 판정은 해당 라인의 URL 범위 안에 들어가는지만 보므로 미세 오차는 무해하다.
  const col = Math.floor(((clientX - rect.left) / rect.width) * term.cols);
  const row = Math.floor(((clientY - rect.top) / rect.height) * term.rows);
  if (col < 0 || col >= term.cols || row < 0 || row >= term.rows) return null;

  const buf = term.buffer.active;
  const line = buf.getLine(buf.viewportY + row);
  if (!line) return null;
  const text = line.translateToString(true);

  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (col >= start && col < end) return m[0];
  }
  return null;
}
