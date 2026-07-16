import { describe, it, expect } from 'vitest';
import { dropFolderForRow, isRowInDropTarget } from './fileTreeHelpers';

/* 외부 파일 드롭 대상 판정 — Zed project panel 모델(대상과 하이라이트 분리).
   "폴더에 떨궜는데 루트로 갔다" 가 원래 증상이라 경로 계산이 곧 기능이다. */

const dir = (path) => ({ path, type: 'directory' });
const file = (path) => ({ path, type: 'file' });

describe('dropFolderForRow', () => {
  it('폴더 행이면 그 폴더가 대상', () => {
    expect(dropFolderForRow(dir('src/components'))).toBe('src/components');
  });

  it('파일 행이면 그 파일의 부모 폴더가 대상 — 파일 안에 넣을 순 없으니까', () => {
    expect(dropFolderForRow(file('src/components/App.jsx'))).toBe('src/components');
  });

  it('루트 바로 아래 파일이면 루트가 대상', () => {
    expect(dropFolderForRow(file('README.md'))).toBe('');
  });

  it('루트 자신도 대상이 된다', () => {
    expect(dropFolderForRow(dir(''))).toBe('');
  });

  it('행이 없으면 루트로 떨어진다', () => {
    expect(dropFolderForRow(null)).toBe('');
  });
});

describe('isRowInDropTarget', () => {
  it('대상 폴더 자신은 칠한다', () => {
    expect(isRowInDropTarget('src', 'src')).toBe(true);
  });

  it('대상 폴더의 하위 전부를 칠한다 — 어디로 들어가는지 한눈에 보이게', () => {
    expect(isRowInDropTarget('src', 'src/a.js')).toBe(true);
    expect(isRowInDropTarget('src', 'src/deep/nested/b.js')).toBe(true);
  });

  it('이름이 겹치는 형제 폴더는 칠하지 않는다 — startsWith 만으로는 src2 가 걸린다', () => {
    expect(isRowInDropTarget('src', 'src2')).toBe(false);
    expect(isRowInDropTarget('src', 'src2/a.js')).toBe(false);
  });

  it('바깥 경로는 칠하지 않는다', () => {
    expect(isRowInDropTarget('src', 'docs/a.md')).toBe(false);
    expect(isRowInDropTarget('src/components', 'src/hooks/x.js')).toBe(false);
  });

  it('대상이 루트면 아무 행도 안 칠한다 — 그 역할은 패널 외곽선이 맡는다', () => {
    expect(isRowInDropTarget('', 'README.md')).toBe(false);
    expect(isRowInDropTarget(null, 'README.md')).toBe(false);
  });
});
