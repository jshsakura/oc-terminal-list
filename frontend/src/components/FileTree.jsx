/**
 * FileTree 컴포넌트
 * VS Code 스타일 파일 브라우저 트리
 */
import { useState, useEffect } from 'react';
import { Folder, File, ChevronRight, ChevronDown, FolderOpen, FilePlus, FolderPlus } from 'lucide-react';

const FileTree = ({ theme, onFileSelect, language = 'en' }) => {
  const [expandedDirs, setExpandedDirs] = useState(new Set([''])); // 루트는 기본 확장
  const [rootItems, setRootItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState('/workspace');
  const [selectedPath, setSelectedPath] = useState(''); // 선택된 경로 (파일 생성용)

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

  const handleCreateFile = async () => {
    const fileName = prompt('파일 이름을 입력하세요:');
    if (!fileName) return;

    try {
      const token = localStorage.getItem('auth_token');
      // 선택된 경로가 있으면 그 안에, 없으면 루트에 생성
      const fullPath = selectedPath ? `${selectedPath}/${fileName}` : fileName;

      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ path: fullPath, type: 'file' })
      });

      if (res.ok) {
        // 루트 디렉토리 새로고침
        const items = await loadDirectory('');
        setRootItems(items);
      } else {
        const error = await res.json();
        alert('파일 생성 실패: ' + (error.detail || '알 수 없는 오류'));
      }
    } catch (error) {
      console.error('Failed to create file:', error);
      alert('파일 생성 실패');
    }
  };

  const handleCreateFolder = async () => {
    const folderName = prompt('폴더 이름을 입력하세요:');
    if (!folderName) return;

    try {
      const token = localStorage.getItem('auth_token');
      // 선택된 경로가 있으면 그 안에, 없으면 루트에 생성
      const fullPath = selectedPath ? `${selectedPath}/${folderName}` : folderName;

      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ path: fullPath, type: 'directory' })
      });

      if (res.ok) {
        // 루트 디렉토리 새로고침
        const items = await loadDirectory('');
        setRootItems(items);
      } else {
        const error = await res.json();
        alert('폴더 생성 실패: ' + (error.detail || '알 수 없는 오류'));
      }
    } catch (error) {
      console.error('Failed to create folder:', error);
      alert('폴더 생성 실패');
    }
  };

  const handleFolderSelect = (path) => {
    setSelectedPath(path);
    setCurrentPath(path ? `/workspace/${path}` : '/workspace');
  };

  return (
    <>
      <style>{`
        .file-tree-btn:hover {
          opacity: 0.7;
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
            />
          ))
        )}
      </div>
    </div>
    </>
  );
};

// 재귀적 트리 노드
const FileTreeNode = ({ item, depth, expanded, onToggle, onSelect, onFolderSelect, selectedPath, loadDirectory, theme }) => {
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
};

export default FileTree;
