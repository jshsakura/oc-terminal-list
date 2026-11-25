import { useState } from 'react';
import useEvent from './useEvent';

export default function useDocumentTabs() {
  const [state, setState] = useState({ files: [], active: null });
  const openDocument = useEvent(file => {
    setState(previous => ({ files: previous.files.includes(file) ? previous.files : [...previous.files, file], active: file }));
  });
  const closeDocument = useEvent(file => {
    setState(previous => {
      const index = previous.files.indexOf(file);
      const files = previous.files.filter(value => value !== file);
      return { files, active: previous.active === file ? files[Math.min(index, files.length - 1)] || null : previous.active };
    });
  });
  const leaveDocument = useEvent(() => setState(previous => previous.active === null ? previous : { ...previous, active: null }));
  return { documentFiles: state.files, activeDocument: state.active, openDocument, closeDocument, leaveDocument };
}
