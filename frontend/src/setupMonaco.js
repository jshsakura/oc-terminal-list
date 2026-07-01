// Monaco 초기화(워커 환경 + @monaco-editor/react loader 를 번들 monaco 로 고정)를 분리한 모듈.
//
// 이 모듈을 import 하는 순간 monaco-vendor 청크(~2.5MB)가 로드된다. 그래서 앱 시작(main.jsx)에서는
// 절대 import 하지 않는다 — 시작 경로에서 빼야 모바일 초기 로딩바가 무거운 에디터 청크를 안 기다린다.
// 대신: (1) FileEditor(지연 로드)가 모듈 로드 시 호출하고, (2) main.jsx 가 앱 뜬 뒤 idle 에 prefetch.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
// 언어 서비스 contribution — 이게 있어야 아래 워커들이 실제로 물려 IntelliSense/검증이 동작한다.
// (editor.api 코어만으론 monarch 색상만 있고 자동완성·hover·진단은 없다.) monaco-vendor 는
// 앱 시작이 아닌 에디터 최초 오픈 시점에 지연 로드되므로 시작 성능엔 영향 없다.
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

let configured = false;

// 한 번만 실행 — 워커 매핑 + loader 를 CDN 이 아닌 번들 monaco 로 고정(self-host/오프라인 대응).
// <Editor> 가 mount 되며 loader.init() 하기 전에 호출돼야 한다. (FileEditor 모듈 로드 시점에 호출)
export function setupMonaco() {
  if (configured) return monaco;
  configured = true;
  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === 'json') return new jsonWorker();
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      return new editorWorker();
    },
  };
  loader.config({ monaco });
  configureLanguages(monaco);
  return monaco;
}

// JS/TS 언어 서비스 + Prettier 포맷 프로바이더를 한 번만 설정한다.
function configureLanguages(monaco) {
  // typescript 네임스페이스는 언어 contribution 이 로드된 뒤에만 존재한다. editor-core API 만
  // 로드된 순간엔 undefined 일 수 있으므로 방어적으로 접근 — 없으면 조용히 건너뛴다(현행 동작 유지).
  const ts = monaco.languages?.typescript;
  if (ts?.typescriptDefaults && ts?.javascriptDefaults) {
    // 프로젝트 컨텍스트 없는 단일 파일 편집 — 의미검증(빨간 물결: "모듈 못 찾음" 등)은 끄고,
    // 자동완성·hover·시그니처 도움말(TS 워커가 제공)은 그대로 살린다. eager sync 로 반응성 향상.
    const compilerOptions = {
      target: ts.ScriptTarget.Latest,
      allowNonTsExtensions: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      allowJs: true,
      esModuleInterop: true,
    };
    const diagnostics = { noSemanticValidation: true, noSyntaxValidation: false };
    for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
      defaults.setCompilerOptions(compilerOptions);
      defaults.setEagerModelSync(true);
      defaults.setDiagnosticsOptions(diagnostics);
    }
  }

  // Prettier 기반 Format Document — 우클릭 메뉴 / Shift+Alt+F / editor.action.formatDocument 에서
  // 네이티브로 동작. format 모듈은 실제 포맷 시점에만 지연 import 된다.
  const FORMAT_LANGS = ['javascript', 'typescript', 'json', 'css', 'html', 'markdown', 'yaml'];
  for (const language of FORMAT_LANGS) {
    monaco.languages.registerDocumentFormattingEditProvider(language, {
      async provideDocumentFormattingEdits(model) {
        try {
          const { formatCode } = await import('./utils/format');
          const next = await formatCode(model.getValue(), language, {
            tabWidth: model.getOptions().tabSize || 2,
          });
          if (next == null || next === model.getValue()) return [];
          return [{ range: model.getFullModelRange(), text: next }];
        } catch (e) {
          console.warn('format failed:', e?.message || e);
          return [];
        }
      },
    });
  }
}

export default setupMonaco;
