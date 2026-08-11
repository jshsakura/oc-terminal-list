import { isFileDrag, readTreeDragPayload, TREE_PATH_MIME } from '../../utils/fileDrag';
import { shellPathForTreeDrop } from '../../utils/droppedTreePath';
import { uploadFileAndGetPath } from './terminalHelpers';

/**
 * PC 에서 터미널로 파일 드래그&드롭 → 업로드 → 저장 경로 삽입.
 *
 * PTY 는 텍스트만 나르므로 파일 자체는 못 보낸다 — 클립보드 이미지 붙여넣기와 같은 우회를 쓴다.
 * 서버(.pasted/)에 올리고 그 *경로* 를 타이핑한 것처럼 넣는다. 엔터는 치지 않는다:
 * 드롭이 곧 실행이면 vim/claude 안에서 사고가 난다. 경로만 주고 판단은 사용자가.
 *
 * 전부 DOM 리스너다. detach() 로 한 번에 걷는다.
 */

const TOAST_DONE_MS = 1200;
const TOAST_ERROR_MS = 2500;

/**
 * 삽입된 경로는 셸 인자로 바로 쓰인다 — 공백·특수문자가 있으면 인자가 쪼개지므로 감싼다.
 * 백엔드가 파일명을 [A-Za-z0-9._-] 로 정규화하니 보통은 그냥 통과하고,
 * WORKSPACE_ROOT 자체에 공백이 있는 경우에만 실제로 걸린다.
 */
export const quotePathForShell = (path) => {
  if (/^[A-Za-z0-9._\-/=:@,+]+$/.test(path)) return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
};

/**
 * drop 순간에 동기로 훑어야 한다 — await 을 한 번이라도 넘기면 DataTransfer 가 비워진다.
 * 폴더도 File 로 오지만 읽으면 실패한다. webkitGetAsEntry 만이 확실한 구분법.
 */
export const collectDroppedFiles = (dataTransfer) => {
  const items = Array.from(dataTransfer?.items || []);
  if (!items.length) return { files: Array.from(dataTransfer?.files || []), skippedDirs: 0 };

  const files = [];
  let skippedDirs = 0;
  for (const item of items) {
    if (item.kind !== 'file') continue;
    if (item.webkitGetAsEntry?.()?.isDirectory) { skippedDirs += 1; continue; }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, skippedDirs };
};

const attachTerminalFileDrop = ({
  term,
  container,
  logger,
  // 원격 pane 이면 드롭한 파일도 그 호스트로.
  hostId = null,
  setDropActive,
  setImagePasteState,
  // 파일 탐색기에서 끌어온 경로를 셸용으로 바꿀 때 쓴다. 트리가 내는 경로가 로컬은
  // 워크스페이스 상대, 원격은 절대라 pane 의 cwd 두 표현이 있어야 절대로 환산된다.
  getPaneCwd = () => ({ isLocal: true, cwdAbs: '', cwdRel: '' }),
}) => {
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  const flashToast = (state, ms) => {
    setImagePasteState(state);
    later(() => setImagePasteState(null), ms);
  };

  let uploading = false;

  const uploadDropped = async (files) => {
    uploading = true;
    setImagePasteState('uploading');
    const paths = [];
    let failed = 0;
    // 순차 업로드 — 공유 터널을 동시에 때리면 WS 까지 같이 느려진다(기존 업로드도 같은 방식).
    for (const file of files) {
      try {
        const data = await uploadFileAndGetPath(file, hostId);
        paths.push(quotePathForShell(data.path));
      } catch (err) {
        failed += 1;
        logger.error('file drop upload failed', file.name, err);
      }
    }
    uploading = false;
    // 일부만 실패해도 올라간 것들의 경로는 넣어준다 — 다시 드롭할 때 중복 업로드를 줄인다.
    if (paths.length) term.paste(`${paths.join(' ')} `); // 뒤 공백 — 이어서 타이핑할 수 있게
    flashToast(failed ? 'error' : 'done', failed ? TOAST_ERROR_MS : TOAST_DONE_MS);
  };

  /** 우리 파일 탐색기에서 끌어온 드래그인지 — OS 파일 드롭과 처리가 다르다(업로드 없음). */
  const isTreeDrag = (dataTransfer) => Array.from(dataTransfer?.types || []).includes(TREE_PATH_MIME);

  /** 탐색기에서 온 경로를 그대로 넣는다. 이미 그 기계에 있는 파일이라 올릴 게 없다. */
  const insertTreePath = (dataTransfer) => {
    const { path: raw, hostId: sourceHost } = readTreeDragPayload(dataTransfer);
    /* 출처와 목적지가 다른 기계면 그 경로는 여기서 아무것도 가리키지 않는다. 분할 화면에서
       A pane 의 탐색기에서 B pane 으로 끄는 건 실제로 되는 동작이라, 막지 않으면 조용히
       엉뚱한 경로가 들어간다. 값을 못 읽으면(옛 클라이언트) 로컬로 보고 판정 — fail closed. */
    if (sourceHost !== (hostId || '')) {
      logger.warn?.('tree drop: cross-host drop refused', sourceHost, '->', hostId || '');
      flashToast('error', TOAST_ERROR_MS);
      return;
    }
    const { isLocal, cwdAbs, cwdRel } = getPaneCwd() || {};
    const path = shellPathForTreeDrop({ treePath: raw, isLocal, cwdAbs, cwdRel });
    if (!path) {
      // 워크스페이스 루트를 못 구한 경우 — 상대 경로를 그대로 넣으면 셸 cwd 에 따라 딴 데를
      // 가리킨다. 조용히 틀리느니 실패로 알린다.
      logger.warn?.('tree drop: could not resolve an absolute path', raw);
      flashToast('error', TOAST_ERROR_MS);
      return;
    }
    term.focus();
    term.paste(`${quotePathForShell(path)} `);   // 뒤 공백 — 이어서 타이핑할 수 있게
  };

  const handleDragOver = (e) => {
    if (isTreeDrag(e.dataTransfer)) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setDropActive(true);
      return;
    }
    if (!isFileDrag(e.dataTransfer)) return;
    // preventDefault 를 빠뜨리면 브라우저가 드롭한 파일을 그냥 열어버린다(=페이지 이탈).
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  };

  const handleDragLeave = (e) => {
    if (!isFileDrag(e.dataTransfer) && !isTreeDrag(e.dataTransfer)) return;
    // 자식 위를 지날 때마다 dragleave 가 터진다 — 컨테이너를 진짜 벗어났을 때만 끈다.
    if (e.relatedTarget && container.contains(e.relatedTarget)) return;
    setDropActive(false);
  };

  const handleDrop = (e) => {
    if (isTreeDrag(e.dataTransfer)) {
      e.preventDefault();
      e.stopPropagation();
      setDropActive(false);
      insertTreePath(e.dataTransfer);
      return;
    }
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    if (uploading) return; // 앞 업로드가 도는 중엔 무시 — 경로가 뒤섞여 들어가지 않게

    const { files, skippedDirs } = collectDroppedFiles(e.dataTransfer);
    if (!files.length) {
      if (skippedDirs) flashToast('folder', TOAST_ERROR_MS);
      return;
    }
    if (skippedDirs) logger.warn?.(`file drop: skipped ${skippedDirs} folder(s)`);
    term.focus(); // 경로가 들어갈 곳을 보이게 — 드롭 전 포커스가 딴 데 있었을 수 있다
    uploadDropped(files);
  };

  container.addEventListener('dragover', handleDragOver);
  container.addEventListener('dragleave', handleDragLeave);
  container.addEventListener('drop', handleDrop);

  return {
    detach: () => {
      container.removeEventListener('dragover', handleDragOver);
      container.removeEventListener('dragleave', handleDragLeave);
      container.removeEventListener('drop', handleDrop);
      timers.forEach(clearTimeout);
      timers.clear();
    },
  };
};

export default attachTerminalFileDrop;
