import { describe, it, expect } from 'vitest';
import {
  extOf, isImageFile, isVideoFile, isAudioFile, isPdfFile, isMediaPreviewFile,
  monacoLanguageForFile,
} from './fileTypes';

describe('fileTypes single source', () => {
  it('extOf handles paths, dotfiles, no-extension', () => {
    expect(extOf('/a/b/c.PNG')).toBe('png');
    expect(extOf('README')).toBe('');
    expect(extOf('.gitignore')).toBe('');
    expect(extOf('archive.tar.gz')).toBe('gz');
  });

  it('classifies the formats that regressed before (bmp/avif/ico)', () => {
    for (const n of ['x.bmp', 'x.avif', 'x.ico', 'x.webp', 'x.PNG']) {
      expect(isImageFile(n)).toBe(true);
    }
  });

  it('video/audio/pdf only match browser-playable + pdf', () => {
    expect(isVideoFile('clip.mp4')).toBe(true);
    expect(isVideoFile('clip.mkv')).toBe(false); // 네이티브 재생 불가 → 미디어 아님
    expect(isVideoFile('clip.avi')).toBe(false);
    expect(isAudioFile('song.flac')).toBe(true);
    expect(isPdfFile('doc.pdf')).toBe(true);
  });

  it('isMediaPreviewFile unions image/video/audio/pdf, excludes text/code', () => {
    expect(isMediaPreviewFile('a.png')).toBe(true);
    expect(isMediaPreviewFile('a.mp3')).toBe(true);
    expect(isMediaPreviewFile('a.pdf')).toBe(true);
    expect(isMediaPreviewFile('a.js')).toBe(false);
    expect(isMediaPreviewFile('a.md')).toBe(false);
  });
});

describe('monacoLanguageForFile', () => {
  it('흔한 확장자를 언어로', () => {
    expect(monacoLanguageForFile('src/x.ts')).toBe('typescript');
    expect(monacoLanguageForFile('a.jsx')).toBe('javascript');
    expect(monacoLanguageForFile('main.py')).toBe('python');
    expect(monacoLanguageForFile('go.mod')).toBe('plaintext');   // 미등록은 plaintext
    expect(monacoLanguageForFile('app.go')).toBe('go');
  });

  it('다중 점 파일은 마지막 확장자만', () => {
    expect(monacoLanguageForFile('vite.config.ts')).toBe('typescript');
    expect(monacoLanguageForFile('a.test.jsx')).toBe('javascript');
  });

  it('확장자 없는 특수 파일은 이름으로', () => {
    expect(monacoLanguageForFile('Dockerfile')).toBe('dockerfile');
    expect(monacoLanguageForFile('Makefile')).toBe('makefile');
    expect(monacoLanguageForFile('path/to/Dockerfile')).toBe('dockerfile');
  });

  it('빈 값 / 모르는 것 → plaintext', () => {
    expect(monacoLanguageForFile('')).toBe('plaintext');
    expect(monacoLanguageForFile(null)).toBe('plaintext');
    expect(monacoLanguageForFile('README')).toBe('plaintext');
  });
});
