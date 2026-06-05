import { X } from 'lucide-react';
import { parseFileKey, getFileIcon } from './fileEditorHelpers';

export const FileEditorTabs = ({ openFiles, activeFile, fileStates, theme, editorSection, onFileSelect, onCloseClick }) => (
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        height: '32px',
        minHeight: '32px',
        maxHeight: '32px',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        background: editorSection.background,
        borderBottom: `1px solid ${editorSection.borderColor}`,
        gap: 0,
      }}>
        {openFiles.map((path) => {
          const isActive = path === activeFile;
          const { path: filePath } = parseFileKey(path);
          const filename = (filePath || path).split('/').pop();
          const fileHasChanges = fileStates[path]?.hasChanges;
          const dotColor = theme.ui.accent || '#89b4fa';
          const inactiveBg = `color-mix(in srgb, ${theme.ui.bgSecondary || theme.ui.bg} 70%, transparent)`;
          const activeBg = `color-mix(in srgb, ${theme.ui.bg} 86%, transparent)`;
          const hoverBg = `color-mix(in srgb, ${theme.ui.bgTertiary || theme.ui.bgSecondary || theme.ui.bg} 84%, ${dotColor} 8%)`;

          return (
            <div
              key={path}
              onClick={() => onFileSelect(path)}
              onAuxClick={(e) => {
                if (e.button === 1) { e.preventDefault(); onCloseClick(path); }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0 8px 0 10px',
                height: 'calc(100% + 1px)',
                cursor: 'pointer',
                background: isActive ? activeBg : inactiveBg,
                color: isActive ? theme.ui.text : theme.ui.textSecondary,
                fontWeight: isActive ? 600 : 400,
                border: `1px solid ${editorSection.borderColor}`,
                borderTop: isActive ? `2px solid ${dotColor}` : `1px solid ${editorSection.borderColor}`,
                borderBottom: `1px solid ${isActive ? activeBg : inactiveBg}`,
                borderRadius: 0,
                minWidth: '80px',
                maxWidth: '180px',
                flexShrink: 0,
                flex: '1 1 auto',
                marginLeft: '-1px',
                boxSizing: 'border-box',
                userSelect: 'none',
                transform: 'translateY(0)',
                boxShadow: isActive ? `inset 0 1px 0 ${dotColor}33` : 'none',
                transition: 'background 150ms, color 150ms, border-color 150ms, box-shadow 150ms, transform 150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = hoverBg;
                e.currentTarget.style.color = theme.ui.text;
                e.currentTarget.style.borderColor = dotColor;
                e.currentTarget.style.boxShadow = `inset 0 1px 0 ${dotColor}44, 0 0 0 1px ${dotColor}18`;
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isActive ? activeBg : inactiveBg;
                e.currentTarget.style.color = isActive ? theme.ui.text : theme.ui.textSecondary;
                e.currentTarget.style.borderColor = editorSection.borderColor;
                e.currentTarget.style.boxShadow = isActive ? `inset 0 1px 0 ${dotColor}33` : 'none';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <span style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px',
                flexShrink: 0,
                color: isActive ? theme.ui.text : dotColor,
                opacity: isActive ? 1 : 0.75,
              }}>
                {getFileIcon(filename, isActive ? theme.ui.text : dotColor)}
                {fileHasChanges && (
                  <span style={{
                    position: 'absolute',
                    top: '-3px',
                    right: '-3px',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: dotColor,
                    boxShadow: `0 0 0 1.5px ${activeBg}`,
                    pointerEvents: 'none',
                  }} />
                )}
              </span>
              <span style={{
                fontSize: '11px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
                fontFamily: theme.ui.fontFamily,
              }}>
                {filename}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onCloseClick(path); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = isActive ? '0.65' : '0.45'; }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '14px',
                  height: '14px',
                  flexShrink: 0,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '3px',
                  padding: 0,
                  cursor: 'pointer',
                  color: theme.ui.textSecondary,
                  opacity: isActive ? 0.65 : 0.45,
                  transition: 'opacity 120ms, background 120ms',
                }}
              >
                <X size={9} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>
);
