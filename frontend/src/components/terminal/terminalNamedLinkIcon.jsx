import { File, Globe } from 'lucide-react';
import { getFileIcon } from '../fileEditor/fileEditorHelpers';
import { namedFileLink } from '../../utils/terminalNamedLinks';

export default function terminalNamedLinkIcon(link) {
  let path = namedFileLink(link.target).path;
  if (link.kind === 'web') {
    const url = new URL(link.target);
    path = url.searchParams.get('document') || url.pathname;
    const icon = getFileIcon(path, 'currentColor');
    if (!url.searchParams.get('document') && icon.type === File) {
      return <Globe size={14} color="currentColor" />;
    }
    return icon;
  }
  return getFileIcon(path, 'currentColor');
}
