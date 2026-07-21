import { describe, it, expect } from 'vitest';
import { dropFolderForRow, isRowInDropTarget, planMove } from './fileTreeHelpers';

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

describe('planMove — 드래그 이동 가드', () => {
  it('폴더로 옮기면 그 안의 같은 이름으로 간다', () => {
    expect(planMove('a/b.txt', 'c')).toEqual({ ok: true, destination: 'c/b.txt' });
    expect(planMove('src/utils', 'lib')).toEqual({ ok: true, destination: 'lib/utils' });
  });

  it('루트로 옮기면 이름만 남는다', () => {
    expect(planMove('a/b.txt', '')).toEqual({ ok: true, destination: 'b.txt' });
  });

  it('같은 폴더 안이면 아무것도 안 한다', () => {
    expect(planMove('a/b.txt', 'a')).toEqual({ ok: false, reason: 'noop' });
    expect(planMove('b.txt', '')).toEqual({ ok: false, reason: 'noop' });
  });

  it('폴더를 자기 자신으로 옮길 수 없다', () => {
    expect(planMove('src', 'src')).toEqual({ ok: false, reason: 'intoSelf' });
  });

  it('폴더를 자기 하위로 옮길 수 없다 — 허용하면 트리가 끊긴다', () => {
    expect(planMove('src', 'src/utils')).toEqual({ ok: false, reason: 'intoSelf' });
    expect(planMove('src', 'src/a/b/c')).toEqual({ ok: false, reason: 'intoSelf' });
  });

  it('이름이 겹치는 형제 폴더로는 옮길 수 있다 — src2 는 src 의 하위가 아니다', () => {
    // 후행 슬래시 없이 startsWith 만 보면 여기서 잘못 막힌다.
    expect(planMove('src', 'src2')).toEqual({ ok: true, destination: 'src2/src' });
    expect(planMove('src', 'src-backup')).toEqual({ ok: true, destination: 'src-backup/src' });
  });

  it('소스가 없으면 조용히 no-op', () => {
    expect(planMove('', 'x')).toEqual({ ok: false, reason: 'noop' });
    expect(planMove(null, 'x')).toEqual({ ok: false, reason: 'noop' });
  });
});
