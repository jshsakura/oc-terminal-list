import { X } from 'lucide-react';
import RailIconBtn from '../common/RailIconBtn';
import { parseFileKey, getFileIcon } from './fileEditorHelpers';

export const FileEditorTabs = ({
  openFiles, activeFile, fileStates, theme, editorSection,
  onFileSelect, onCloseClick, onCloseAllClick = null, t = null,
}) => (
      /* 상단 탭바와 같은 구조: 탭은 안에서 스크롤되고, 액션은 오른쪽 끝 레일에 고정된다.
         (탭 스트립 안에 sticky 로 얹으면 탭들 사이에 낀 것처럼 보인다.) */
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        height: '32px',
        minHeight: '32px',
        maxHeight: '32px',
        background: editorSection.background,
        borderBottom: `1px solid ${editorSection.borderColor}`,
      }}>
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        flex: 1,
        minWidth: 0,
        overflowX: 'auto',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
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
                /* 탭은 **줄어들지 않는다** — 늘어나면 스트립이 가로로 스크롤된다.
                   `flex: 1 1 auto` 이던 시절엔 폰에서 5개가 80px 로 짜부라져 파일명이
                   "c." 로 잘렸다. 탭바가 넘치는 건 정상이고, 못 읽는 게 사고다. */
                minWidth: '124px',
                maxWidth: '180px',
                flex: '0 0 auto',
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
                title={t?.('close') || 'Close'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  /* 22px — 손가락으로 누를 수 있는 최소치. 아이콘은 그대로 작게 두고
                     버튼만 키운다(탭 높이 32px 안에 들어간다). */
                  width: '22px',
                  height: '22px',
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
                <X size={11} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>

      {/* 우측 레일 — 탭이 하나든 열이든 **항상** 같은 자리에 있다. 개수에 따라 나타났다
          사라지면 그 자리를 믿을 수 없게 되고, 한 개일 때야말로 정리하려던 순간이다.
          글리프는 탭의 닫기와 같은 X — 목록 아이콘은 햄버거 메뉴로 읽힌다.
          색은 `ui` 를 넘기지 않아 앱 크롬 팔레트(--ui-subtext)를 그대로 쓴다: FileEditor 가
          받는 `theme.ui` 는 크롬 팔레트가 아니라 테마 원본이라 넘기면 색이 어긋난다. */}
      {onCloseAllClick && openFiles.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, paddingRight: '2px' }}>
          <div style={{
            width: '1px', height: '16px', alignSelf: 'center', flexShrink: 0,
            margin: '0 4px', background: editorSection.borderColor,
          }} />
          <RailIconBtn
            icon={X}
            compact
            onClick={onCloseAllClick}
            badge={openFiles.length > 1 ? openFiles.length : null}
            title={`${t?.('closeAllFiles') || 'Close all'} (${openFiles.length})`}
          />
        </div>
      )}
      </div>
);
