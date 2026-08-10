import { describe, it, expect } from 'vitest';
import { workspaceRootFrom, shellPathForTreeDrop } from './droppedTreePath';

describe('workspaceRootFrom', () => {
  it('절대 cwd 에서 상대 cwd 만큼 걷어내면 루트', () => {
    expect(workspaceRootFrom('/w/notebooks/proj/backend', 'proj/backend')).toBe('/w/notebooks');
  });

  it('cwd 가 루트 자신이면 절대 경로가 곧 루트', () => {
    expect(workspaceRootFrom('/w/notebooks', '')).toBe('/w/notebooks');
    expect(workspaceRootFrom('/w/notebooks/', '/')).toBe('/w/notebooks');
  });

  /* 셸이 워크스페이스 밖으로 cd 하면 두 표현이 어긋난다. 그때 억지로 자르면 없는 루트를
     만들어내므로 모른다고 답해야 한다. */
  it('두 표현이 안 맞으면 빈 문자열', () => {
    expect(workspaceRootFrom('/tmp/elsewhere', 'proj/backend')).toBe('');
    expect(workspaceRootFrom('', 'proj')).toBe('');
  });
});

describe('shellPathForTreeDrop', () => {
  it('로컬은 워크스페이스 상대 → 절대로 바꾼다', () => {
    expect(shellPathForTreeDrop({
      treePath: 'proj/src', isLocal: true, cwdAbs: '/w/notebooks/proj', cwdRel: 'proj',
    })).toBe('/w/notebooks/proj/src');
  });

  it('원격 트리 경로는 이미 절대라 그대로', () => {
    expect(shellPathForTreeDrop({
      treePath: '/home/pi/app', isLocal: false, cwdAbs: '/home/pi', cwdRel: '',
    })).toBe('/home/pi/app');
  });

  /* 상대 경로를 그대로 넣으면 셸의 cwd 에 따라 다른 곳을 가리킨다. 조용히 틀리느니
     아무것도 넣지 않는다. */
  it('루트를 못 구하면 상대 경로를 그대로 넣지 않는다', () => {
    expect(shellPathForTreeDrop({
      treePath: 'proj/src', isLocal: true, cwdAbs: '/tmp/other', cwdRel: 'proj',
    })).toBe('');
  });

  it('로컬이라도 이미 절대면 그대로', () => {
    expect(shellPathForTreeDrop({ treePath: '/etc/hosts', isLocal: true })).toBe('/etc/hosts');
  });

  it('빈 입력은 빈 문자열', () => {
    expect(shellPathForTreeDrop({ treePath: '', isLocal: true })).toBe('');
    expect(shellPathForTreeDrop()).toBe('');
  });
});
