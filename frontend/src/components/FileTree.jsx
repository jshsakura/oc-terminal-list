import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Tree } from 'react-arborist';
import { 
  Folder, File, ChevronRight, ChevronDown, FolderOpen, 
  FilePlus, FolderPlus, RefreshCw,
  FileCode, FileText, Image as ImageIcon, Search
} from 'lucide-react';

// 파일 아이콘 결정 함수
const getFileIcon = (filename, isDirectory, isExpanded) => {
  if (isDirectory) {
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
      if (!res.ok) throw new Error(`API Error: ${res.status}`);
      return await res.json();
    } catch (error) {
      console.error(`[Explorer API Error] ${url}:`, error);
      throw error;
    }
  }, []);

  // 트리 데이터 변환
  const transformItems = useCallback((items) => {
    if (!items || !Array.isArray(items)) return [];
    return items.map(item => ({
      id: item.path,
      name: item.name,
      path: item.path,
      type: item.type,
      // react-arborist는 폴더인 경우 children 속성이 반드시 배열이어야 함
      children: item.type === 'directory' ? [] : null
    }));
  }, []);

  // 데이터 로드
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    console.log("[Explorer] Loading initial data...");
    try {
      const ws = await apiCall('/api/files/workspace');
      setWorkspaceInfo(ws);

      const timestamp = new Date().getTime();
      const result = await apiCall(`/api/files?path=&_t=${timestamp}`);
      
      if (result && result.items) {
        const transformed = transformItems(result.items);
        console.log("[Explorer] Data loaded successfully:", transformed);
        setData(transformed);
      }
    } catch (err) {
      console.error("[Explorer] Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  }, [apiCall, transformItems]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // 폴더 확장 (Lazy Loading)
  const onToggle = async (id, isOpen) => {
    if (isOpen) {
      const node = treeRef.current?.get(id);
      if (node && node.data.type === 'directory' && (!node.data.children || node.data.children.length === 0)) {
        try {
          const result = await apiCall(`/api/files?path=${encodeURIComponent(id)}`);
          const children = transformItems(result.items);
          
          setData(prevData => {
            const updateRecursive = (items) => {
              return items.map(item => {
                if (item.id === id) return { ...item, children };
                if (item.children) return { ...item, children: updateRecursive(item.children) };
                return item;
              });
            };
            return updateRecursive(prevData);
          });
        } catch (err) {
          console.error("[Explorer] Failed to load children:", err);
        }
      }
    }
  };

  // 노드 렌더러
  const Node = ({ node, style, dragHandle }) => {
    return (
      <div
        ref={dragHandle}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '4px',
          backgroundColor: node.isSelected ? `${theme.ui.accent}33` : 'transparent',
          cursor: 'pointer',
          height: '24px',
          color: node.isSelected ? theme.ui.accent : theme.ui.text,
        }}
        onClick={() => {
          node.toggle();
          if (node.data.type === 'file') onFileSelect?.(node.data.path);
          if (node.data.type === 'directory') onFolderSelect?.(node.data.path);
        }}
      >
        <div style={{ width: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {node.data.type === 'directory' && (
            <span style={{ color: theme.ui.textSecondary }}>
              {node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          )}
        </div>
        <div style={{ width: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '6px' }}>
          {getFileIcon(node.data.name, node.data.type === 'directory', node.isOpen)}
        </div>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontSize: '13px' }}>
          {node.data.name}
        </span>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: theme.ui.bg, userSelect: 'none' }}>
      {/* 헤더 */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${theme.ui.border}`, backgroundColor: theme.ui.bgSecondary }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: theme.ui.textSecondary }}>{workspaceInfo.name.toUpperCase()}</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={() => treeRef.current?.createLeaf(treeRef.current?.focusedNode?.id || null)} style={{ background: 'none', border: 'none', color: theme.ui.textSecondary, cursor: 'pointer', padding: '4px' }}><FilePlus size={14} /></button>
            <button onClick={() => treeRef.current?.createInternal(treeRef.current?.focusedNode?.id || null)} style={{ background: 'none', border: 'none', color: theme.ui.textSecondary, cursor: 'pointer', padding: '4px' }}><FolderPlus size={14} /></button>
            <button onClick={loadInitialData} style={{ background: 'none', border: 'none', color: theme.ui.textSecondary, cursor: 'pointer', padding: '4px' }}><RefreshCw size={14} /></button>
          </div>
        </div>
      </div>

      {/* 검색 */}
      <div style={{ padding: '4px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', backgroundColor: theme.ui.bgTertiary, padding: '0 6px', height: '24px', borderRadius: '4px' }}>
          <Search size={12} style={{ color: theme.ui.textSecondary, marginRight: '6px' }} />
          <input type="text" placeholder="Filter..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: theme.ui.text, fontSize: '11px' }} />
        </div>
      </div>

      {/* 트리 본체 - 높이 확보가 핵심 */}
      <div style={{ flex: 1, minHeight: '300px', position: 'relative' }}>
        {loading && data.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: theme.ui.textSecondary, fontSize: '12px' }}>Loading...</div>
        ) : data.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: theme.ui.textSecondary, fontSize: '12px', opacity: 0.6 }}>No files found</div>
        ) : (
          <Tree
            ref={treeRef}
            data={data}
            searchTerm={searchTerm}
            searchMatch={(node, term) => node.data.name.toLowerCase().includes(term.toLowerCase())}
            onToggle={onToggle}
            width="100%"
            height={500} /* 임시로 고정 높이를 주어 가시성 테스트 */
            indent={16}
            rowHeight={24}
            padding={4}
          >
            {Node}
          </Tree>
        )}
      </div>
    </div>
  );
};

export default FileTree;
