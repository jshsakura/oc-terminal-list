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

/* ── 외부 파일 드롭 대상 판정 (Zed project panel 과 같은 모델) ────────────────────
   대상과 하이라이트를 분리한다. 파일 행 위에 떨구면 대상은 그 파일의 *부모 폴더* 고,
   하이라이트는 부모 폴더 + 하위 트리 전체를 칠한다 — 한 줄만 칠하면 "어디로 들어가지?"
   가 남는다. 대상이 루트('')면 칠할 행이 없으므로 패널 외곽선이 그 역할을 한다. */

/** 이 행에 파일을 떨궜을 때 실제로 들어갈 폴더. 폴더 행이면 자신, 파일 행이면 부모. */
export const dropFolderForRow = (row) => {
  if (!row) return '';
  if (row.type === 'directory') return row.path || '';
  return computeParent(row.path) ?? '';
};

/** 이 행이 드롭 대상 폴더의 하이라이트 영역(폴더 자신 + 하위 전부)에 속하는가. */
export const isRowInDropTarget = (dropTargetPath, path) => {
  if (!dropTargetPath || typeof path !== 'string') return false; // ''(루트)는 외곽선이 맡는다
  return path === dropTargetPath || path.startsWith(`${dropTargetPath}/`);
};

export const stripHostPathPrefix = (path) => {
  if (!path || typeof path !== 'string') return path || '';
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/') || trimmed.startsWith('~/') || trimmed === '~' || trimmed.startsWith('./')) return trimmed;
  const match = trimmed.match(/^[^\s/:]+(?:@[^\s/:]+)?:([/~].*)$/);
  return match ? match[1] : trimmed;
};

/**
 * 드래그 이동의 목적지를 계산하고, 해서는 안 되는 이동을 걸러낸다.
 *
 * 반환: { ok: true, destination } | { ok: false, reason: 'noop' | 'intoSelf' }
 *  - 'noop'     같은 폴더 안 — 아무것도 안 한다(경고도 필요 없다).
 *  - 'intoSelf' 폴더를 자기 자신이나 자기 하위로 옮기려 함 — 허용하면 트리가 끊긴다.
 *
 * ⚠️ 하위 판정에 후행 슬래시가 반드시 있어야 한다. `startsWith(sourcePath)` 로만 보면
 * 이름이 겹치는 형제 폴더(`src` 로 옮기려는데 `src2`)가 자기 하위로 오인된다.
 */
export const planMove = (sourcePath, destFolder) => {
  if (!sourcePath) return { ok: false, reason: 'noop' };
  const name = sourcePath.split('/').pop();
  const destination = destFolder ? `${destFolder}/${name}` : name;
  if (destination === sourcePath) return { ok: false, reason: 'noop' };
  if (destFolder === sourcePath || destFolder.startsWith(`${sourcePath}/`)) {
    return { ok: false, reason: 'intoSelf' };
  }
  return { ok: true, destination };
};
