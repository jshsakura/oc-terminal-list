import {
  File, FileText, FileCode, FileImage, FileJson, FileVideo, FileAudio,
} from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { isImageFile, isVideoFile, isAudioFile, isPdfFile, extOf } from '../../utils/fileTypes';

const { color } = tokens;

export const iconForFile = (name) => {
  // 미디어는 단일 소스(fileTypes)로 — FileEditor 미리보기와 동일 기준.
  if (isImageFile(name)) return FileImage;
  if (isVideoFile(name)) return FileVideo;
  if (isAudioFile(name)) return FileAudio;
  if (isPdfFile(name)) return FileText;
  const ext = extOf(name);
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return FileJson;
  if (['md', 'mdx', 'rst', 'txt'].includes(ext)) return FileText;
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'rb', 'java', 'c', 'cpp', 'h', 'sh', 'lua'].includes(ext)) return FileCode;
  return File;
};

export const fileIconColor = (name) => {
  if (isImageFile(name) || isVideoFile(name) || isAudioFile(name)) return color.dotPalette[5];
  const ext = extOf(name);
  if (['md', 'mdx'].includes(ext)) return color.success;
  if (['json', 'yaml', 'yml'].includes(ext)) return color.warning;
  if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) return color.info;
  if (['py'].includes(ext)) return color.success;
  return color.muted;
};

export const gitTone = (status) => {
  if (status === 'M') return color.warning;
  if (status === '??' || status === 'A') return color.success;
  if (status === 'D') return color.danger;
  return color.muted;
};

export const computeParent = (p) => {
  if (!p) return null;
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx < 0) return '';
  if (idx === 0) return '/';
  return trimmed.substring(0, idx);
};

export const stripHostPathPrefix = (path) => {
  if (!path || typeof path !== 'string') return path || '';
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/') || trimmed.startsWith('~/') || trimmed === '~' || trimmed.startsWith('./')) return trimmed;
  const match = trimmed.match(/^[^\s/:]+(?:@[^\s/:]+)?:([/~].*)$/);
  return match ? match[1] : trimmed;
};
