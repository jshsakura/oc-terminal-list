import { useState, useEffect } from 'react';

/**
 * 에디터 패널 높이 드래그 리사이즈 + localStorage 영속.
 * App.jsx 에서 로직 변경 없이 추출. 외부 의존 없음(자체 state + localStorage).
 * 반환: { editorHeight, isResizingEditor, onEditorResizeStart }.
 */
export default function useEditorResize() {
  const [editorHeight, setEditorHeight] = useState(() => parseInt(localStorage.getItem('editor_height') || '400'));
  const [isResizingEditor, setIsResizingEditor] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => localStorage.setItem('editor_height', editorHeight.toString()), 150);
    return () => clearTimeout(id);
  }, [editorHeight]);

  const onEditorResizeStart = (e) => {
    if (e.preventDefault && e.cancelable !== false) e.preventDefault();
    setIsResizingEditor(true);
    const startY = e.clientY || e.touches?.[0]?.clientY;
    const startH = editorHeight;
    let resizeRaf = 0;
    let nextHeight = startH;
    const onMove = (me) => {
      const y = me.clientY || me.touches?.[0]?.clientY;
      nextHeight = Math.max(150, Math.min(window.innerHeight - 150, startH + y - startY));
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        setEditorHeight(nextHeight);
      });
    };
    const onUp = () => {
      setIsResizingEditor(false);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      setEditorHeight(nextHeight);
      localStorage.setItem('editor_height', nextHeight.toString());
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onUp);
  };

  return { editorHeight, isResizingEditor, onEditorResizeStart };
}
