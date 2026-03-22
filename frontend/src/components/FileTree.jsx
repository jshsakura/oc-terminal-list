import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Tree } from 'react-arborist';
import { 
  Folder, File, ChevronRight, ChevronDown, FolderOpen, 
  FilePlus, FolderPlus, X, Trash2, Copy, Terminal, RefreshCw,
  FileCode, FileText, Image as ImageIcon, Search, Edit
} from 'lucide-react';

/**
 * FileTree 컴포넌트 (react-arborist 기반)
 * VSCode 수준의 사용성 제공: 가상화, 드래그 앤 드롭, 인플레이스 편집 등
 */

// 파일 아이콘 결정 함수
const getFileIcon = (filename, color, isExpanded) => {
  if (isExpanded !== undefined) {
    return isExpanded ? <FolderOpen size={16} color="#89b4fa" /> : <Folder size={16} color="#89b4fa" />;
  }
  
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'js': case 'jsx': case 'ts': case 'tsx':
    case 'py': case 'html': case 'css': case 'c': case 'cpp': case 'go': case 'rs':
      return <FileCode size={16} color="#89b4fa" />;
    case 'json': case 'md': case 'txt': case 'csv': case 'env':
    case 'gitignore': case 'dockerignore':
      return <FileText size={16} color="#f9e2af" />;
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'ico': case 'webp':
      return <ImageIcon size={16} color="#a6e3a1" />;
    default:
      return <File size={16} color="#cdd6f4" />;
  }
};

const FileTree = ({ theme, onFileSelect, onFolderSelect, onOpenTerminalAtFolder }) => {
  const [data, setData] = useState([]);
  const [workspaceInfo, setWorkspaceInfo] = useState({ root: '', name: 'EXPLORER' });
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const treeRef = useRef();
  
  // API 호출 도우미
  const apiCall = useCallback(async (url, method = 'GET', body = null) => {
    try {
      const token = localStorage.getItem('auth_token');
      const options = {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      };
      if (body) options.body = JSON.stringify(body);
      
      const res = await fetch(url, options);
      if (!res.ok) {
        let errorMsg = 'API Error';
        try {
          const err = await res.json();
          errorMsg = err.detail || errorMsg;
        } catch (e) {}
        throw new Error(errorMsg);
      }
      const data = await res.json();
      return data || { items: [] };
    } catch (error) {
      console.error(`API Error (${url}):`, error);
      throw error;
    }
  }, []);

  // 트리 데이터 변환 (API 데이터를 arborist 형식으로)
  const transformItems = useCallback((items) => {
    return items.map(item => ({
      id: item.path,
      name: item.name,
      path: item.path,
      type: item.type,
      // 폴더인 경우 children을 빈 배열로 두어 화살표가 나오게 함 (Lazy loading은 추후 구현)
      children: item.type === 'directory' ? [] : null
    }));
  }, []);

  // 워크스페이스 정보 및 루트 데이터 로드
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      // 워크스페이스 정보 가져오기
      const ws = await apiCall('/api/files/workspace');
      setWorkspaceInfo(ws);

      // 루트 아이템 가져오기
      const result = await apiCall('/api/files?path=');
      setData(transformItems(result.items));
    } catch (err) {
      console.error("Failed to load explorer:", err);
    } finally {
      setLoading(false);
    }
  }, [apiCall, transformItems]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // 폴더 확장 시 데이터 로드 (Lazy Loading)
  const onToggle = async (id, isOpen) => {
    if (isOpen) {
      const node = treeRef.current?.get(id);
      if (node && node.data.type === 'directory' && (!node.data.children || node.data.children.length === 0)) {
        try {
          const result = await apiCall(`/api/files?path=${encodeURIComponent(id)}`);
          const children = transformItems(result.items);
          
          // 데이터 업데이트 (Immutably)
          setData(prevData => {
            const updateRecursive = (items) => {
              return items.map(item => {
                if (item.id === id) {
                  return { ...item, children };
                }
                if (item.children) {
                  return { ...item, children: updateRecursive(item.children) };
                }
                return item;
              });
            };
            return updateRecursive(prevData);
          });
        } catch (err) {
          console.error("Failed to load children:", err);
        }
      }
    }
  };

  // 파일 이동/이름 변경
  const onMove = async ({ dragIds, parentId, index }) => {
    for (const id of dragIds) {
      const source = id;
      const fileName = id.split('/').pop();
      const destination = parentId ? `${parentId}/${fileName}` : fileName;
      
      if (source === destination) continue;
      
      try {
        await apiCall('/api/files/move', 'POST', { source, destination });
      } catch (err) {
        alert(`이동 실패: ${err.message}`);
      }
    }
    loadInitialData(); // 간단하게 전체 새로고침
  };

  // 이름 변경 (인플레이스 편집 완료 시)
  const onRename = async ({ id, name }) => {
    const source = id;
    const pathParts = id.split('/');
    pathParts[pathParts.length - 1] = name;
    const destination = pathParts.join('/');
    
    if (source === destination) return;
    
    try {
      await apiCall('/api/files/move', 'POST', { source, destination });
      loadInitialData();
    } catch (err) {
      alert(`이름 변경 실패: ${err.message}`);
    }
  };

  // 삭제
  const onDelete = async ({ ids }) => {
    if (!confirm(`${ids.length}개의 항목을 삭제하시겠습니까?`)) return;
    
    for (const id of ids) {
      try {
        await apiCall(`/api/files?path=${encodeURIComponent(id)}`, 'DELETE');
      } catch (err) {
        console.error("Delete failed:", err);
      }
    }
    loadInitialData();
  };

  // 노드 렌더러 (VSCode 스타일)
  const Node = ({ node, style, dragHandle }) => {
    const isSelected = node.isSelected;
    const isFocused = node.isFocused;
    const isEditing = node.isEditing;
    
    return (
      <div
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '4px', // Arborist가 indentation을 style에 포함해줌
          backgroundColor: isSelected ? `${theme.ui.accent}33` : (isFocused ? theme.ui.bgTertiary : 'transparent'),
          cursor: 'pointer',
          height: '24px',
          fontSize: '13px',
          color: isSelected ? theme.ui.accent : theme.ui.text,
          borderLeft: isFocused ? `2px solid ${theme.ui.accent}` : '2px solid transparent',
        }}
        onClick={(e) => {
          node.toggle();
          node.focus();
          if (node.data.type === 'file' && onFileSelect) onFileSelect(node.data.path);
          if (node.data.type === 'directory' && onFolderSelect) onFolderSelect(node.data.path);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          node.focus();
          // 브라우저 기본 컨텍스트 메뉴는 일단 유지하거나 커스텀 구현
        }}
        ref={dragHandle}
      >
        {/* 화살표 */}
        <div style={{ width: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {node.data.type === 'directory' && (
            <span style={{ color: theme.ui.textSecondary }}>
              {node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          )}
        </div>

        {/* 아이콘 */}
        <div style={{ width: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '6px' }}>
          {getFileIcon(node.data.name, theme.ui.iconColor, node.data.type === 'directory' ? node.isOpen : undefined)}
        </div>

        {/* 텍스트 또는 편집창 */}
        {isEditing ? (
          <input
            autoFocus
            defaultValue={node.data.name}
            onBlur={() => node.reset()}
            onKeyDown={(e) => {
              if (e.key === "Enter") node.submit(e.currentTarget.value);
              if (e.key === "Escape") node.reset();
            }}
            style={{
              flex: 1,
              background: theme.ui.bgSecondary,
              color: theme.ui.text,
              border: `1px solid ${theme.ui.accent}`,
              outline: 'none',
              fontSize: '12px',
              padding: '0 4px',
              height: '18px',
            }}
          />
        ) : (
          <span style={{ 
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap',
            flex: 1
          }}>
            {node.data.name}
          </span>
        )}
      </div>
    );
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      backgroundColor: theme.ui.bg,
      userSelect: 'none' 
    }}>
      {/* 탐색기 헤더 */}
      <div style={{ 
        padding: '8px 12px', 
        display: 'flex', 
        flexDirection: 'column',
        borderBottom: `1px solid ${theme.ui.borderLight}`,
        backgroundColor: theme.ui.bgSecondary 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: theme.ui.textSecondary, letterSpacing: '0.5px' }}>
            {workspaceInfo.name.toUpperCase()}
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button 
              onClick={() => {
                const focused = treeRef.current?.focusedNode;
                treeRef.current?.createLeaf(focused?.id || null);
              }} 
              title="New File"
              style={{ 
                background: 'none', 
                border: 'none', 
                color: theme.ui.textSecondary, 
                cursor: 'pointer',
                padding: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.ui.bgTertiary}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <FilePlus size={16} />
            </button>
            <button 
              onClick={() => {
                const focused = treeRef.current?.focusedNode;
                treeRef.current?.createInternal(focused?.id || null);
              }} 
              title="New Folder"
              style={{ 
                background: 'none', 
                border: 'none', 
                color: theme.ui.textSecondary, 
                cursor: 'pointer',
                padding: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.ui.bgTertiary}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <FolderPlus size={16} />
            </button>
            <button 
              onClick={loadInitialData} 
              title="Refresh"
              style={{ 
                background: 'none', 
                border: 'none', 
                color: theme.ui.textSecondary, 
                cursor: 'pointer',
                padding: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.ui.bgTertiary}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
        <div style={{ 
          fontSize: '10px', 
          color: theme.ui.textSecondary, 
          opacity: 0.6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: '"JetBrains Mono", monospace'
        }} title={workspaceInfo.root}>
          {workspaceInfo.root}
        </div>
      </div>

      {/* 검색창 */}
      <div style={{ padding: '4px 8px' }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          backgroundColor: theme.ui.bgTertiary, 
          borderRadius: '2px',
          padding: '0 6px',
          height: '24px'
        }}>
          <Search size={12} style={{ color: theme.ui.textSecondary, marginRight: '6px' }} />
          <input 
            type="text" 
            placeholder="Filter files..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ 
              flex: 1, 
              background: 'none', 
              border: 'none', 
              outline: 'none', 
              color: theme.ui.text, 
              fontSize: '11px' 
            }}
          />
        </div>
      </div>

      {/* 트리 영역 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {loading && data.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: theme.ui.textSecondary, fontSize: '12px' }}>
            Loading...
          </div>
        ) : data.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: theme.ui.textSecondary, fontSize: '12px', opacity: 0.6 }}>
            No files found in workspace
          </div>
        ) : (
          <Tree
            ref={treeRef}
            data={data}
            searchTerm={searchTerm}
            searchMatch={(node, term) => node.data.name.toLowerCase().includes(term.toLowerCase())}
            onToggle={onToggle}
            onMove={onMove}
            onRename={onRename}
            onDelete={onDelete}
            onCreate={async ({ parentId, name, type }) => {
              // 경로가 중복되지 않도록 처리 (parentId가 null이거나 비어있을 수 있음)
              const cleanParentId = parentId ? (parentId.endsWith('/') ? parentId.slice(0, -1) : parentId) : '';
              const path = cleanParentId ? `${cleanParentId}/${name}` : name;
              const backendType = type === 'internal' ? 'directory' : 'file';
              
              console.log(`Creating ${backendType}: ${path} (parentId: ${parentId})`);
              
              try {
                const response = await apiCall('/api/files/create', 'POST', { path, type: backendType });
                console.log('Create success:', response);
                
                // 데이터 새로고침
                await loadInitialData();
                
                // 생성된 노드 정보 반환
                return { id: path, name, path, type: backendType };
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error('Create failed:', err);
                alert(`Creation failed: ${message}\nPath: ${path}\nType: ${backendType}`);
                return null;
              }
            }}
            width="100%"
            height="100%"
            indent={16}
            rowHeight={24}
            overscanCount={10}
            padding={4}
          >
            {Node}
          </Tree>
        )}
      </div>

      {/* 단축키 힌트 */}
      <div style={{ 
        padding: '6px 12px', 
        fontSize: '9px', 
        color: theme.ui.textSecondary, 
        borderTop: `1px solid ${theme.ui.borderLight}`,
        opacity: 0.6
      }}>
        F2: Rename • Del: Delete • Drag to Move
      </div>
    </div>
  );
};

export default FileTree;
