// 포맷 지원 여부 판정만 담는 초경량 모듈 — 동기 함수 하나뿐.
// FileEditor(정적 import)가 포맷 버튼 노출 판단에 쓰고, format.js(지연 import)도 이 맵을 공유한다.
// 무거운 prettier 로딩 코드와 분리해, 정적/동적 import 충돌 및 eager 번들 오염을 막는다.

// Monaco language id → Prettier parser. 여기 없는 언어는 포맷 미지원(버튼 숨김).
export const PARSER_BY_LANGUAGE = {
  javascript: 'babel',
  typescript: 'typescript',
  json: 'json',
  css: 'css',
  html: 'html',
  markdown: 'markdown',
  yaml: 'yaml',
};

export function canFormatLanguage(language) {
  return Object.prototype.hasOwnProperty.call(PARSER_BY_LANGUAGE, language);
}
