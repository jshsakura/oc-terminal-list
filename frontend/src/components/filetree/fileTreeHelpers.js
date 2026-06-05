import {
  File, FileText, FileCode, FileImage, FileJson,
} from 'lucide-react';
import { tokens } from '../../styles/tokens';

const { color } = tokens;

export const iconForFile = (name) => {
  const ext = name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'].includes(ext)) return FileImage;
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return FileJson;
  if (['md', 'mdx', 'rst', 'txt'].includes(ext)) return FileText;
  if (['js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'rb', 'java', 'c', 'cpp', 'h', 'sh', 'lua'].includes(ext)) return FileCode;
  return File;
};

export const fileIconColor = (name) => {
  const ext = name.split('.').pop().toLowerCase();
  if (['md', 'mdx'].includes(ext)) return color.success;
  if (['json', 'yaml', 'yml'].includes(ext)) return color.warning;
  if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) return color.info;
  if (['py'].includes(ext)) return color.success;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return color.dotPalette[5];
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
