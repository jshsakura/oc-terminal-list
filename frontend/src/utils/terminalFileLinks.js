/**
 * 터미널 출력에서 파일 경로를 찾아 클릭 가능한 링크로 만든다.
 *
 * `created src/components/Button.tsx:12:7` 를 클릭하면 그 파일의 12번 줄로.
 * 지금은 http 링크(WebLinksAddon)만 클릭되고 파일 경로는 죽은 텍스트다 —
 * "이게 될까" 하고 반사적으로 눌러보는 동작이라(feedback_obvious_features_natural),
 * 안 되면 버그로 인식조차 안 하고 참으며 쓴다.
 *
 * ⚠️ 공백 든 경로(`/tmp/My Project/x.md`)는 의도적으로 안 잡는다.
 * xterm 의 링크 모델은 "한 줄에서 연속된 문자 범위" 라, 공백으로 끊긴 경로를
 * 하나의 링크로 묶으려면 어느 공백이 경로 안이고 어느 게 문장 구분인지 추측해야
 * 한다(orca 는 hover 지점으로 그걸 했지만 우리 range 모델엔 안 맞는다).
 * 잘못 잡아 엉뚱한 파일을 여느니, **확실한 것만** 잡는다.
 */

// 경로 후보로 볼 문자: 경로/파일명에 흔한 것들. 공백은 제외(위 주석 참고).
// 뒤에 `:line[:col]` 이 붙을 수 있다.
const PATH_RE = new RegExp(
  // 앞은 경계 — 공백/시작/흔한 구두점 뒤부터
  '(?:^|[\\s\'"`(\\[<])' +
  '(' +
    '(?:' +
      '~?/' +              // 절대경로(/…) 또는 홈(~/…)
      '|\\.{1,2}/' +       // ./ 또는 ../
      '|(?:[\\w.-]+/)' +   // 상대경로: 최소 한 번의 dir/ 를 요구
    ')' +
    '[\\w./-]*' +          // 나머지 경로 문자
    '[\\w-]' +             // 파일명은 확장자/문자로 끝나야(구두점으로 안 끝나게)
  ')' +
  '(?::(\\d+)(?::(\\d+))?)?',  // 선택적 :line[:col]
  'g',
);

// 확장자 없는 순수 디렉터리 경로도 허용하되, 너무 흔한 오탐(URL 조각 등)은 배제.
const MIN_PATH_LEN = 3;

/**
 * 한 줄에서 파일 링크 후보를 모두 찾는다.
 * 반환: [{ path, line, column, start, end }] — start/end 는 줄 안의 0-based 인덱스.
 *
 * start/end 는 xterm 이 밑줄 칠 범위다. 앞 경계 문자는 범위에서 뺀다.
 */
export const findFileLinks = (lineText) => {
  if (!lineText) return [];
  const links = [];
  PATH_RE.lastIndex = 0;
  let match;
  while ((match = PATH_RE.exec(lineText)) !== null) {
    const [full, rawPath, lineNo, colNo] = match;
    if (!rawPath || rawPath.length < MIN_PATH_LEN) continue;

    // 캡처 그룹의 실제 시작 = 전체 매치에서 앞 경계 문자만큼 뒤로.
    const boundaryLen = full.length - full.replace(/^[\s'"`(\[<]/, '').length;
    const start = match.index + boundaryLen;
    // line/col 접미사까지 포함해 밑줄을 긋는다(클릭 영역을 넓게).
    const suffixLen = full.length - boundaryLen - rawPath.length;
    const end = start + rawPath.length + suffixLen;

    links.push({
      path: rawPath,
      line: lineNo ? Number(lineNo) : null,
      column: colNo ? Number(colNo) : null,
      start,
      end,
    });
  }
  return links;
};

/* 접힌 줄을 되살릴 때 훑는 최대 행 수. 폭 52 기준 8행이면 400자가 넘는다 —
   그보다 긴 경로는 실재하지 않고, 상한이 없으면 병적인 출력에서 버퍼를 통째로 훑는다. */
export const MAX_WRAPPED_ROWS = 8;

/**
 * 화면 폭에서 접힌 줄을 **논리적인 한 줄로** 되살린다.
 *
 * xterm 버퍼는 접힌 줄을 행마다 따로 담고(이어지는 행은 `isWrapped=true`), 링크
 * 프로바이더는 행 단위로 불린다. 그래서 한 행만 보면 긴 경로가 중간에서 잘린 **조각**이
 * 매치된다 — 실제로 `/tmp/…/game-a` + `nd-watch-retro-go-sd/…/scratchp` 로 접힌 경로에서
 * 뒷조각만 잡혀, 있지도 않은 경로로 빈 편집기 탭이 열렸다.
 *
 * 이어붙일 때 각 행은 **자르지 않고**(translateToString(false)) 정확히 cols 폭으로 둔다 —
 * 중간 행의 공백을 트림하면 오프셋이 밀려 밑줄이 엉뚱한 칸에 그려진다.
 *
 * @returns {{ text: string, startRow: number }} startRow 는 0-based 버퍼 행.
 */
export const readLogicalLine = (buffer, bufferLineNumber, cols) => {
  const index = bufferLineNumber - 1;
  if (!buffer || index < 0) return { text: '', startRow: index };

  let startRow = index;
  let back = 0;
  while (startRow > 0 && back < MAX_WRAPPED_ROWS && buffer.getLine(startRow)?.isWrapped) {
    startRow -= 1;
    back += 1;
  }

  const parts = [];
  for (let row = startRow; row < startRow + MAX_WRAPPED_ROWS; row += 1) {
    const line = buffer.getLine(row);
    if (!line) break;
    if (row > startRow && !line.isWrapped) break;
    parts.push(line.translateToString(false));
  }
  return { text: parts.join(''), startRow };
};

/**
 * 논리 줄 안의 오프셋 → xterm 셀 좌표(1-based). 접힌 행은 정확히 cols 폭이므로
 * 나눗셈으로 떨어진다.
 */
export const offsetToCell = (offset, startRow, cols) => ({
  x: (offset % cols) + 1,
  y: startRow + 1 + Math.floor(offset / cols),
});

/**
 * 클릭한 경로를 워크스페이스 상대 경로로 정규화한다.
 *
 * 로컬 pane 은 편집기가 워크스페이스 루트 기준이다. 절대경로가 워크스페이스 안에
 * 있으면 상대로 바꾸고, 밖이면 null(못 여는 경로 — 클릭 무시). `~/` 와 `./` 도 처리.
 * cwd 는 pane 의 현재 디렉터리(상대경로 해석 기준).
 */
export const resolveWorkspacePath = (rawPath, { workspaceRoot = '', cwd = '' } = {}) => {
  if (!rawPath) return null;
  let p = rawPath;

  // 홈 경로는 이 함수로 워크스페이스 상대화할 수 없다 — 편집기가 못 연다.
  if (p.startsWith('~')) return null;

  if (p.startsWith('/')) {
    // 절대경로: 워크스페이스 안일 때만.
    if (!workspaceRoot) return null;
    const root = workspaceRoot.replace(/\/+$/, '');
    if (p === root) return '';
    if (!p.startsWith(root + '/')) return null;   // 워크스페이스 밖
    return p.slice(root.length + 1);
  }

  // 상대경로: cwd 기준으로 이어붙인 뒤 정규화. cwd 자체가 워크스페이스 상대라고 본다.
  p = p.replace(/^\.\//, '');
  const base = (cwd || '').replace(/^\/+|\/+$/g, '');
  const joined = base ? `${base}/${p}` : p;
  return normalizeRelative(joined);
};

/** `a/b/../c` → `a/c`. 워크스페이스를 벗어나면(선행 ..) null. */
const normalizeRelative = (path) => {
  const out = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;   // 워크스페이스 루트 위로
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
};
