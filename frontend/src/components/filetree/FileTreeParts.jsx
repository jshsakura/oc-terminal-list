import { memo, useEffect, useRef, useState } from 'react';
import {
  Folder, FolderOpen, ChevronRight, ChevronDown,
  Plus, Pencil, Trash2, Terminal, Download, Upload, Copy, Type,
} from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { glassDividerStyle, glassMenuItemHover } from '../../styles/glass';
import { styles } from './fileTreeStyles';
import { iconForFile, fileIconColor, gitTone } from './fileTreeHelpers';

const { color, fontWeight } = tokens;

export const Row = memo(({ depth, isOpen, isFolder, isSelected, name, tone, gitStatus, isChanged, onClick, onDoubleClick, onContextMenu, draggable = false, onDragStart, onDragOver, onDragLeave, onDrop, isDropTarget = false }) => {
  const FileIcon = isFolder ? (isOpen ? FolderOpen : Folder) : iconForFile(name);
  const iconHue = isFolder ? color.accent : fileIconColor(name);
  const nameColor = isChanged && !isFolder ? gitTone(gitStatus || 'M') : tone;
  
  const touchTimerRef = useRef(null);
  const touchPosRef = useRef({ x: 0, y: 0 });

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    touchPosRef.current = { x: touch.clientX, y: touch.clientY };
    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    
    touchTimerRef.current = setTimeout(() => {
      onContextMenu({
        preventDefault: () => {},
        stopPropagation: () => {},
        clientX: touchPosRef.current.x,
        clientY: touchPosRef.current.y
      });
      touchTimerRef.current = null;
    }, 600); // 600ms long press
  };

  const handleTouchMove = (e) => {
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchPosRef.current.y);
    if ((dx > 10 || dy > 10) && touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        ...styles.row,
        background: isDropTarget ? color.accentSubtle : (isSelected ? color.accentSubtle : 'transparent'),
        boxShadow: isDropTarget ? `inset 0 0 0 1px ${color.accent}` : 'none',
        paddingLeft: 4 + depth * 14,
      }}
      onMouseEnter={(e) => { if (!isSelected && !isDropTarget) e.currentTarget.style.background = color.surface0; }}
      onMouseLeave={(e) => { if (!isSelected && !isDropTarget) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={styles.chevron}>
        {isFolder ? (
          isOpen ? <ChevronDown size={11} strokeWidth={2} /> : <ChevronRight size={11} strokeWidth={2} />
        ) : null}
      </span>
      <FileIcon size={13} strokeWidth={2} style={{ color: iconHue, flexShrink: 0 }} />
      <span style={{
        ...styles.name,
        color: nameColor,
        fontWeight: isSelected ? fontWeight.medium : fontWeight.regular,
      }}>
        {name}
      </span>
      {gitStatus && (
        <span style={{ ...styles.gitTag, color: gitTone(gitStatus) }}>
          {gitStatus === '??' ? 'U' : gitStatus}
        </span>
      )}
    </div>
  );
});

export const MenuItem = ({ icon: Icon, label, onClick, tone }) => (
  <button
    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
    style={{
      ...styles.menuItem,
      color: tone === 'danger' ? 'var(--ui-danger)' : 'var(--ui-text)',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = glassMenuItemHover(); }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
  >
    <Icon size={12} strokeWidth={2} style={{ color: tone === 'danger' ? 'var(--ui-danger)' : 'var(--ui-subtext)' }} />
    <span>{label}</span>
  </button>
);

export const ContextMenu = ({ x, y, target, t, onClose, onNewFile, onNewFolder, onRename, onDelete, onOpenTerminal, onDownload, onUpload, onCopyPath, onCopyName }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });
  const [measured, setMeasured] = useState(false);

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const margin = 8;
      let nextX = x;
      let nextY = y;

      if (nextX + rect.width > window.innerWidth - margin) {
        nextX = window.innerWidth - rect.width - margin;
      }
      if (nextX < margin) nextX = margin;

      if (nextY + rect.height > window.innerHeight - margin) {
        nextY = window.innerHeight - rect.height - margin;
      }
      if (nextY < margin) nextY = margin;

      setPos({ x: nextX, y: nextY });
      setMeasured(true);
    }
  }, [x, y]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        zIndex: 200000,
        ...styles.menu,
        opacity: measured ? 1 : 0,
      }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem icon={Plus} label={t('newFile') || 'New file'} onClick={onNewFile} />
      <MenuItem icon={Folder} label={t('newFolder') || 'New folder'} onClick={onNewFolder} />
      <MenuItem icon={Terminal} label={t('openTerminalHere') || 'Open terminal here'} onClick={onOpenTerminal} />
      {target.type === 'directory' && (
        <MenuItem icon={Upload} label={t('uploadHere') || 'Upload here'} onClick={onUpload} />
      )}
      {target.path && (
        <>
          <div style={glassDividerStyle({}, { margin: '4px 0' })} />
          <MenuItem icon={Copy} label={t('copyPath') || 'Copy path'} onClick={onCopyPath} />
          <MenuItem icon={Type} label={t('copyName') || 'Copy name'} onClick={onCopyName} />
          <MenuItem icon={Download} label={t('download') || 'Download'} onClick={onDownload} />
          <MenuItem icon={Pencil} label={t('rename') || 'Rename'} onClick={onRename} />
          <MenuItem icon={Trash2} label={t('delete') || 'Delete'} onClick={onDelete} tone="danger" />
        </>
      )}
    </div>
  );
};

export const HeadAction = ({ icon: Icon, title, onClick, active, disabled = false }) => (
  <button
    onClick={(e) => { e.stopPropagation(); if (!disabled) onClick?.(); }}
    onContextMenu={(e) => e.stopPropagation()}
    title={title}
    disabled={disabled}
    style={{
      ...styles.headActionBtn,
      color: active ? color.accent : color.muted,
      background: active ? color.accentSubtle : 'transparent',
      opacity: disabled ? 0.35 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'background 120ms, color 120ms',
    }}
    onMouseEnter={(e) => {
      if (disabled || active) return;
      e.currentTarget.style.background = color.surface0;
      e.currentTarget.style.color = color.text;
    }}
    onMouseLeave={(e) => {
      if (disabled || active) return;
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.color = color.muted;
    }}
  >
    <Icon size={12} strokeWidth={2} />
  </button>
);
