import { defaultUrlTransform } from 'react-markdown';
import { parseFileKey } from '../components/fileEditor/fileEditorHelpers';

export const documentWindowUrl = (fileKey) => `/?document=${encodeURIComponent(fileKey)}`;

export const openDocumentWindow = (fileKey, { newTab = false } = {}) => {
  const mobile = window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches;
  const popup = mobile || newTab
    ? window.open(documentWindowUrl(fileKey), '_blank')
    : window.open(documentWindowUrl(fileKey), '_blank', 'popup,width=1200,height=900,resizable=yes,scrollbars=yes');
  if (!popup) {
    return false;
  }
  popup.opener = null;
  popup.focus();
  return true;
};

export const resolveDocumentPath = (url, fileKey, workspaceRoot = '') => {
  if (!url || url.startsWith('#') || url.startsWith('//')) {
    return null;
  }
  let raw = url;
  if (/^file:\/\//i.test(raw)) {
    try {
      const file = new URL(raw);
      if (file.hostname && file.hostname !== 'localhost') {
        return null;
      }
      raw = file.pathname;
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(raw)) {
    return null;
  }
  try {
    raw = decodeURIComponent(raw.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (!raw || /[\x00-\x1f\\]/.test(raw) || raw.startsWith('~')) {
    return null;
  }
  const { path, hostId } = parseFileKey(fileKey);
  if (!path) {
    return null;
  }
  let joined;
  if (raw.startsWith('/')) {
    if (hostId) {
      joined = raw;
    } else {
      const root = workspaceRoot.replace(/\/+$/, '');
      if (!root || !raw.startsWith(`${root}/`)) {
        return null;
      }
      joined = raw.slice(root.length + 1);
    }
  } else {
    const slash = path.lastIndexOf('/');
    joined = `${slash < 0 ? '' : path.slice(0, slash + 1)}${raw}`;
  }
  const parts = [];
  for (const part of joined.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (!parts.length) {
        return null;
      }
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  const resolved = `${hostId && joined.startsWith('/') ? '/' : ''}${parts.join('/')}`;
  if (!resolved || resolved === '/') {
    return null;
  }
  return { path: resolved, hostId, fileKey: hostId ? `remote:${hostId}:${resolved}` : resolved };
};

export const documentLinkUrl = (url, key, fileKey, workspaceRoot = '') => {
  if (!url || url.startsWith('#') || /^(https?:|mailto:|tel:|\/\/)/i.test(url)) {
    return defaultUrlTransform(url);
  }
  const target = resolveDocumentPath(url, fileKey, workspaceRoot);
  if (!target) {
    return '';
  }
  if (key === 'src') {
    const base = target.hostId ? `/api/hosts/${encodeURIComponent(target.hostId)}/files/raw` : '/api/files/raw';
    return `${base}?path=${encodeURIComponent(target.path)}`;
  }
  return documentWindowUrl(target.fileKey);
};
