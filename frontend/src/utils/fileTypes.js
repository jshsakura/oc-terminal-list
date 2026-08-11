/**
 * 파일 확장자 → 타입 분류의 **단일 소스**.
 * 미리보기(FileEditor) · 트리 아이콘(FileTree) · 에디터 지원 판별이 전부 여기서 끌어쓴다.
 * 새 포맷은 여기 한 곳만 고치면 전 화면에 일관되게 반영된다.
 *
 * 주의: 동영상/오디오는 "브라우저 <video>/<audio> 가 네이티브 재생 가능한" 것만 넣는다.
 * (avi/mkv 는 재생 불가 → 제외, editorState 의 미지원 목록에 남는다.)
 */
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp', 'avif'];
export const VIDEO_EXTS = ['mp4', 'webm', 'ogv', 'mov', 'm4v'];
export const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'];
export const PDF_EXTS = ['pdf'];
// 표로 보여주는 것들. xlsx 리더는 OOXML 전용이라 옛 바이너리 .xls 는 뺀다(열면 깨진다).
export const SHEET_EXTS = ['xlsx', 'xlsm'];
export const DELIMITED_EXTS = ['csv', 'tsv'];

// 확장자만 소문자로. 점 없는 파일(README)·dotfile(.gitignore)은 '' 반환.
export const extOf = (name) => {
  const s = name || '';
  const i = s.lastIndexOf('.');
  return i <= 0 ? '' : s.slice(i + 1).toLowerCase();
};

const inList = (list, name) => {
  const ext = extOf(name);
  return !!ext && list.includes(ext);
};

export const isImageFile = (name) => inList(IMAGE_EXTS, name);
export const isVideoFile = (name) => inList(VIDEO_EXTS, name);
export const isAudioFile = (name) => inList(AUDIO_EXTS, name);
export const isPdfFile = (name) => inList(PDF_EXTS, name);

// FileEditor 가 텍스트가 아닌 미리보기(이미지/PDF/동영상/오디오)로 띄우는 모든 타입.
export const isMediaPreviewFile = (name) =>
  isImageFile(name) || isVideoFile(name) || isAudioFile(name) || isPdfFile(name);

export const isSheetFile = (name) => inList(SHEET_EXTS, name);       // 바이너리 → 표
export const isDelimitedFile = (name) => inList(DELIMITED_EXTS, name); // 텍스트 → 표

/**
 * 원격 파일을 브라우저가 **인라인으로 렌더해도 되는가**.
 * 백엔드 `routes/host_files.inline_media_type` 의 거울이다 — 둘이 어긋나면 프론트는
 * 미리보기를 그리려 하고 서버는 415 를 주는 조합이 된다. svg 는 확장자만 이미지이고
 * 실제로는 스크립트를 담을 수 있어 양쪽 모두에서 빠진다(원격 svg 는 텍스트로 연다).
 */
export const isRemoteInlinePreviewFile = (name) =>
  isMediaPreviewFile(name) && extOf(name) !== 'svg';

// 확장자 → Monaco 언어 id. FileEditor 가 문법 강조/포맷 판단에 쓴다.
// 여기 없으면 'plaintext'. extOf 를 재사용하므로 `.env.local` 같은 다중 점도 안전.
const MONACO_LANGUAGE_BY_EXT = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', php: 'php', java: 'java',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', swift: 'swift', kt: 'kotlin', kts: 'kotlin', scala: 'scala',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', jsonc: 'json', md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml', xml: 'xml', svg: 'xml', toml: 'ini', ini: 'ini',
  sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  dockerfile: 'dockerfile', makefile: 'makefile', lua: 'lua', vim: 'plaintext',
};

// 이름 자체가 언어를 정하는 파일(확장자가 없다).
const MONACO_LANGUAGE_BY_NAME = {
  dockerfile: 'dockerfile', makefile: 'makefile',
  '.gitignore': 'plaintext', '.env': 'plaintext',
};

/** 파일 경로/이름 → Monaco 언어 id. 모르면 'plaintext'. */
export const monacoLanguageForFile = (path) => {
  if (!path) return 'plaintext';
  const base = path.split('/').pop().toLowerCase();
  if (MONACO_LANGUAGE_BY_NAME[base]) return MONACO_LANGUAGE_BY_NAME[base];
  return MONACO_LANGUAGE_BY_EXT[extOf(base)] || 'plaintext';
};
