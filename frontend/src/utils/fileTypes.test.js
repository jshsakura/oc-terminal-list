import { describe, it, expect } from 'vitest';
import {
  extOf, isImageFile, isVideoFile, isAudioFile, isPdfFile, isMediaPreviewFile,
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
