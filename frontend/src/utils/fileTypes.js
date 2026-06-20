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
