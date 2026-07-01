// Prettier 기반 "Format Document" — Monaco 에디터용 지연 로드 포매터.
//
// 이 모듈은 오직 동적 import(setupMonaco 의 포맷 프로바이더)로만 진입한다. prettier/standalone 과
// 해당 언어 플러그인을 다시 동적 import 하므로, 포맷을 실제로 한 번 쓰기 전까지 초기 번들에
// 아무것도 얹지 않는다. (지원 여부 판정은 초경량 formatSupport.js 로 분리 — 정적/동적 충돌 방지)
import { PARSER_BY_LANGUAGE } from './formatSupport';

// Prettier 3 브라우저 빌드는 플러그인을 "모듈 네임스페이스" 그대로 넘긴다(.default 아님).
async function loadPlugins(parser) {
  switch (parser) {
    case 'babel':
    case 'json': {
      const [estree, babel] = await Promise.all([
        import('prettier/plugins/estree'),
        import('prettier/plugins/babel'),
      ]);
      return [estree, babel];
    }
    case 'typescript': {
      const [estree, ts] = await Promise.all([
        import('prettier/plugins/estree'),
        import('prettier/plugins/typescript'),
      ]);
      return [estree, ts];
    }
    case 'css':
      return [await import('prettier/plugins/postcss')];
    case 'html':
      return [await import('prettier/plugins/html')];
    case 'markdown':
      return [await import('prettier/plugins/markdown')];
    case 'yaml':
      return [await import('prettier/plugins/yaml')];
    default:
      return [];
  }
}

// 포맷 실패(구문 오류 등)는 호출부에서 처리하도록 그대로 throw 한다 — 조용히 삼키지 않음.
export async function formatCode(source, language, options = {}) {
  const parser = PARSER_BY_LANGUAGE[language];
  if (!parser) throw new Error(`No formatter for language "${language}"`);
  const [prettier, plugins] = await Promise.all([
    import('prettier/standalone'),
    loadPlugins(parser),
  ]);
  return prettier.format(source, {
    parser,
    plugins,
    tabWidth: options.tabWidth ?? 2,
    printWidth: options.printWidth ?? 100,
    semi: true,
    singleQuote: true,
    ...(options.prettier || {}),
  });
}
