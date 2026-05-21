// Monaco 초기화(워커 환경 + @monaco-editor/react loader 를 번들 monaco 로 고정)를 분리한 모듈.
//
// 이 모듈을 import 하는 순간 monaco-vendor 청크(~2.5MB)가 로드된다. 그래서 앱 시작(main.jsx)에서는
// 절대 import 하지 않는다 — 시작 경로에서 빼야 모바일 초기 로딩바가 무거운 에디터 청크를 안 기다린다.
// 대신: (1) FileEditor(지연 로드)가 모듈 로드 시 호출하고, (2) main.jsx 가 앱 뜬 뒤 idle 에 prefetch.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
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
  return monaco;
}

export default setupMonaco;
