/**
 * FileTree 컴포넌트
 * VS Code 스타일 파일 브라우저 트리
 */
import { useState, useEffect, useRef } from 'react';
import { Folder, File, ChevronRight, ChevronDown, FolderOpen, FilePlus, FolderPlus, X, Trash2, Edit3, Copy, Terminal } from 'lucide-react';

const FileTree = ({ theme, onFileSelect, onFolderSelect, language = 'en' }) => {
  const [expandedDirs, setExpandedDirs] = useState(new Set([''])); // 루트는 기본 확장
  const [rootItems, setRootItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState('/workspace');
  const [selectedPath, setSelectedPath] = useState(''); // 선택된 경로 (파일 생성용)
  const [createModalOpen, setCreateModalOpen] = useState(null); // 'file' | 'folder' | null
  const [inputValue, setInputValue] = useState('');
  const [contextMenu, setContextMenu] = useState(null); // { x, y, item }
  const [renameItem, setRenameItem] = useState(null); // 이름 변경 중인 아이템

  // 루트 디렉토리 로드
  useEffect(() => {
    loadDirectory('');
  }, []);

  const loadDirectory = async (path) => {
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        console.error('Failed to load directory:', path);
        return [];
      }

      const data = await res.json();
      return data.items;
    } catch (error) {
      console.error('Failed to load directory:', error);
      return [];
    }
  };

  const toggleDirectory = async (path) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedDirs(newExpanded);
  };

  // 루트 디렉토리 로드
  useEffect(() => {
    const fetchRoot = async () => {
      setLoading(true);
      const items = await loadDirectory('');
      setRootItems(items);
      setLoading(false);
    };
    fetchRoot();
  }, []);

  const handleCreateFile = () => {
    setInputValue('');
    setCreateModalOpen('file');
  };

  const handleCreateFolder = () => {
    setInputValue('');
    setCreateModalOpen('folder');
  };

  const handleCreate = async () => {
    if (!inputValue.trim()) return;

    try {
      const token = localStorage.getItem('auth_token');
      const fullPath = selectedPath ? `${selectedPath}/${inputValue}` : inputValue;

      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          path: fullPath,
          type: createModalOpen === 'file' ? 'file' : 'directory'
        })
      });

      if (res.ok) {
        const items = await loadDirectory('');
        setRootItems(items);
        setCreateModalOpen(null);
        setInputValue('');
      } else {
        const error = await res.json();
        alert(`${createModalOpen === 'file' ? '파일' : '폴더'} 생성 실패: ${error.detail || '알 수 없는 오류'}`);
      }
    } catch (error) {
      console.error('Failed to create:', error);
      alert(`${createModalOpen === 'file' ? '파일' : '폴더'} 생성 실패`);
    }
  };

  const handleFolderSelect = (path) => {
    setSelectedPath(path);
    setCurrentPath(path ? `/workspace/${path}` : '/workspace');

    // 외부 핸들러 호출 (터미널에 cd 명령 전송)
    if (onFolderSelect) {
      onFolderSelect(path);
    }
  };

  // 트리 새로고침
  const refreshTree = async () => {
    const items = await loadDirectory('');
    setRootItems(items);
  };

  // 파일/폴더 삭제
  const handleDelete = async (item) => {
    if (!confirm(`"${item.name}"을(를) 삭제하시겠습니까?`)) return;

    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/files?path=${encodeURIComponent(item.path)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        await refreshTree();
      } else {
        const error = await res.json();
        alert(`삭제 실패: ${error.detail || '알 수 없는 오류'}`);
      }
    } catch (error) {
      console.error('Failed to delete:', error);
      alert('삭제 실패');
    }
  };

  // 이름 변경
  const handleRename = async (item, newName) => {
    if (!newName.trim() || newName === item.name) {
      setRenameItem(null);
      return;
    }

    try {
      const token = localStorage.getItem('auth_token');
      const parentPath = item.path.substring(0, item.path.lastIndexOf('/'));
      const newPath = parentPath ? `${parentPath}/${newName}` : newName;

      // 이름 변경 = 삭제 + 생성 (또는 파일 이동 API 추가 필요)
      // 간단하게 복사 후 삭제로 구현
      alert('이름 변경 기능은 추후 추가 예정입니다');
      setRenameItem(null);
    } catch (error) {
      console.error('Failed to rename:', error);
      alert('이름 변경 실패');
    }
  };

  // 경로 복사
  const handleCopyPath = async (item) => {
    try {
      await navigator.clipboard.writeText(`/workspace/${item.path}`);
      alert('경로가 복사되었습니다');
    } catch (error) {
      console.error('Failed to copy path:', error);
      alert('경로 복사 실패');
    }
  };

  // 터미널에서 열기
  const handleOpenInTerminal = (item) => {
    if (item.type === 'directory') {
      onFolderSelect(item.path);
    } else {
      // 파일이면 부모 디렉토리로 이동
      const parentPath = item.path.substring(0, item.path.lastIndexOf('/'));
      onFolderSelect(parentPath);
    }
  };

  // 컨텍스트 메뉴 닫기
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  const inputRef = useRef(null);

  // 모달 열릴 때 포커스
  useEffect(() => {
    if (createModalOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [createModalOpen]);

  return (
    <>
      <style>{`
        .file-tree-btn:hover {
          opacity: 0.7;
        }
        .create-input::placeholder {
          color: ${theme.foreground || theme.white || '#a6adc8'};
          opacity: 0.5;
        }
        .context-menu-item:hover {
          background-color: ${theme.ui.bgTertiary || '#313244'} !important;
        }
      `}</style>
      <div style={styles.container}>
        {/* 헤더: 경로 + 버튼들 */}
        <div style={{ ...styles.header, backgroundColor: theme.ui.bgSecondary, borderBottomColor: theme.ui.border }}>
          <div style={{ ...styles.pathDisplay, color: theme.ui.textSecondary }}>
            {currentPath}
          </div>
          <div style={styles.actions}>
            <button
              onClick={handleCreateFile}
              className="file-tree-btn"
              style={{ ...styles.actionBtn, color: theme.ui.text }}
              title="새 파일"
            >
              <FilePlus size={14} />
            </button>
            <button
              onClick={handleCreateFolder}
              className="file-tree-btn"
              style={{ ...styles.actionBtn, color: theme.ui.text }}
              title="새 폴더"
            >
              <FolderPlus size={14} />
            </button>
          </div>
        </div>

      {/* 파일 트리 */}
      <div style={styles.treeContainer}>
        {loading ? (
          <div style={{ ...styles.loading, color: theme.ui.textSecondary }}>
            불러오는 중...
          </div>
        ) : (
          rootItems.map(item => (
            <FileTreeNode
              key={item.path}
              item={item}
              depth={0}
              expanded={expandedDirs.has(item.path)}
              onToggle={toggleDirectory}
              onSelect={onFileSelect}
              onFolderSelect={handleFolderSelect}
              selectedPath={selectedPath}
              loadDirectory={loadDirectory}
              theme={theme}
              onContextMenu={setContextMenu}
            />
          ))
        )}
      </div>
    </div>

    {/* 컨텍스트 메뉴 */}
    {contextMenu && (
      <div
        style={{
          ...styles.contextMenu,
          top: contextMenu.y,
          left: contextMenu.x,
          backgroundColor: theme.ui.bg,
          borderColor: theme.ui.border,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {contextMenu.item.type === 'directory' && (
          <>
            <div
              className="context-menu-item"
              style={{ ...styles.menuItem, color: theme.ui.text }}
              onClick={() => {
                setSelectedPath(contextMenu.item.path);
                handleCreateFile();
                setContextMenu(null);
              }}
            >
              <FilePlus size={14} />
              <span>새 파일</span>
            </div>
            <div
              className="context-menu-item"
              style={{ ...styles.menuItem, color: theme.ui.text }}
              onClick={() => {
                setSelectedPath(contextMenu.item.path);
                handleCreateFolder();
                setContextMenu(null);
              }}
            >
              <FolderPlus size={14} />
              <span>새 폴더</span>
            </div>
            <div style={{ ...styles.menuDivider, backgroundColor: theme.ui.border }} />
          </>
        )}
        <div
          className="context-menu-item"
          style={{ ...styles.menuItem, color: theme.ui.text }}
          onClick={() => {
            handleCopyPath(contextMenu.item);
            setContextMenu(null);
          }}
        >
          <Copy size={14} />
          <span>경로 복사</span>
        </div>
        <div
          className="context-menu-item"
          style={{ ...styles.menuItem, color: theme.ui.text }}
          onClick={() => {
            handleOpenInTerminal(contextMenu.item);
            setContextMenu(null);
          }}
        >
          <Terminal size={14} />
          <span>터미널에서 열기</span>
        </div>
        <div style={{ ...styles.menuDivider, backgroundColor: theme.ui.border }} />
        <div
          className="context-menu-item"
          style={{ ...styles.menuItem, color: theme.red || '#f38ba8' }}
          onClick={() => {
            handleDelete(contextMenu.item);
            setContextMenu(null);
          }}
        >
          <Trash2 size={14} />
          <span>삭제</span>
        </div>
      </div>
    )}

      {/* 생성 모달 */}
      {createModalOpen && (
        <>
          <div
            style={styles.backdrop}
            onClick={() => setCreateModalOpen(null)}
          />
          <div style={{
            ...styles.modal,
            backgroundColor: theme.ui.bg,
            borderColor: theme.ui.border,
          }}>
            <div style={{
              ...styles.modalHeader,
              borderBottomColor: theme.ui.border,
            }}>
              <h3 style={{
                ...styles.modalTitle,
                color: theme.foreground || theme.ui.fg || '#cdd6f4',
              }}>
                {createModalOpen === 'file' ? '새 파일' : '새 폴더'}
              </h3>
              <button
                onClick={() => setCreateModalOpen(null)}
                style={{
                  ...styles.closeButton,
                  color: theme.foreground || theme.white || '#bac2de',
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={styles.modalBody}>
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreate();
                  } else if (e.key === 'Escape') {
                    setCreateModalOpen(null);
                  }
                }}
                placeholder={createModalOpen === 'file' ? '파일 이름을 입력하세요...' : '폴더 이름을 입력하세요...'}
                className="create-input"
                style={{
                  ...styles.input,
                  backgroundColor: theme.ui.bgSecondary,
                  color: theme.foreground || theme.white || '#cdd6f4',
                  borderColor: theme.ui.border,
                }}
                autoFocus
              />
              <div style={{
                ...styles.hint,
                color: theme.foreground || theme.white || '#a6adc8',
              }}>
                💡 위치: {currentPath || '/workspace'}
              </div>
            </div>
            <div style={{
              ...styles.modalFooter,
              borderTopColor: theme.ui.border,
            }}>
              <button
                onClick={handleCreate}
                disabled={!inputValue.trim()}
                style={{
                  ...styles.createButton,
                  backgroundColor: inputValue.trim() ? theme.ui.accent : theme.ui.bgSecondary,
                  color: inputValue.trim() ? '#ffffff' : (theme.brightBlack || '#6c7086'),
                  opacity: inputValue.trim() ? 1 : 0.5,
                }}
              >
                {createModalOpen === 'file' ? <FilePlus size={14} /> : <FolderPlus size={14} />}
                <span>생성</span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
};

// 재귀적 트리 노드
const FileTreeNode = ({ item, depth, expanded, onToggle, onSelect, onFolderSelect, selectedPath, loadDirectory, theme, onContextMenu }) => {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isSelected = selectedPath === item.path;

  // 디렉토리 확장 시 자식 로드
  useEffect(() => {
    if (item.type === 'directory' && expanded && children.length === 0) {
      const fetchChildren = async () => {
        setLoading(true);
        const items = await loadDirectory(item.path);
        setChildren(items);
        setLoading(false);
      };
      fetchChildren();
    }
  }, [expanded, item.path, item.type]);

  const handleClick = () => {
    if (item.type === 'directory') {
      onToggle(item.path);
      onFolderSelect(item.path); // 폴더 선택 시 경로 업데이트
    } else {
      onSelect(item.path);
    }
  };

  return (
    <>
      <div
        style={{
          ...styles.treeItem,
          paddingLeft: `${depth * 16 + 8}px`,
          backgroundColor: isSelected ? theme.ui.bgTertiary : (isHovered ? theme.ui.bgTertiary : 'transparent'),
          color: theme.ui.text,
          borderLeft: isSelected ? `2px solid ${theme.ui.accent}` : 'none',
        }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu({ x: e.clientX, y: e.clientY, item });
        }}
      >
        {/* 폴더 확장/축소 아이콘 */}
        {item.type === 'directory' && (
          <span style={{ ...styles.icon, color: theme.ui.textSecondary }}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
        {item.type !== 'directory' && <span style={styles.icon}></span>}

        {/* 파일/폴더 아이콘 */}
        <span style={{ ...styles.icon, color: item.type === 'directory' ? theme.ui.accent : theme.ui.textSecondary }}>
          {item.type === 'directory' ? (
            expanded ? <FolderOpen size={14} /> : <Folder size={14} />
          ) : (
            <File size={14} />
          )}
        </span>

        {/* 이름 */}
        <span style={styles.name}>{item.name}</span>
      </div>

      {/* 자식 노드 (디렉토리만) */}
      {item.type === 'directory' && expanded && (
        loading ? (
          <div style={{ ...styles.loading, paddingLeft: `${(depth + 1) * 16 + 8}px`, color: theme.ui.textSecondary }}>
            ...
          </div>
        ) : (
          children.map(child => (
            <FileTreeNode
              key={child.path}
              item={child}
              depth={depth + 1}
              expanded={expanded && child.type === 'directory'}
              onToggle={onToggle}
              onSelect={onSelect}
              onFolderSelect={onFolderSelect}
              selectedPath={selectedPath}
              loadDirectory={loadDirectory}
              theme={theme}
              onContextMenu={onContextMenu}
            />
          ))
        )
      )}
    </>
  );
};

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px',
    borderBottom: '1px solid',
    gap: '8px',
  },
  pathDisplay: {
    fontSize: '11px',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  actions: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  },
  actionBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    borderRadius: '2px',
    transition: 'opacity 0.15s ease',
  },
  treeContainer: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  loading: {
    padding: '8px',
    fontSize: '12px',
  },
  treeItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    fontSize: '12px',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background-color 0.15s ease',
  },
  icon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '4px',
    flexShrink: 0,
  },
  name: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 10000,
    backdropFilter: 'blur(2px)',
  },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '90%',
    maxWidth: '400px',
    borderRadius: '8px',
    border: '1px solid',
    zIndex: 10001,
    display: 'flex',
    flexDirection: 'column',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    borderBottom: '1px solid',
  },
  modalTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.2s',
  },
  modalBody: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  input: {
    width: '100%',
    padding: '12px',
    fontSize: '14px',
    fontFamily: 'monospace',
    border: '1px solid',
    borderRadius: '4px',
    outline: 'none',
  },
  contextMenu: {
    position: 'fixed',
    minWidth: '200px',
    borderRadius: '4px',
    border: '1px solid',
    zIndex: 10000,
    padding: '4px',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    fontSize: '13px',
    cursor: 'pointer',
    borderRadius: '2px',
    transition: 'background-color 0.15s ease',
    userSelect: 'none',
  },
  menuDivider: {
    height: '1px',
    margin: '4px 0',
  },
  modalFooter: {
    display: 'flex',
    padding: '16px',
    borderTop: '1px solid',
  },
  createButton: {
    flex: 1,
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: '500',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transition: 'all 0.2s ease',
  },
};

export default FileTree;
