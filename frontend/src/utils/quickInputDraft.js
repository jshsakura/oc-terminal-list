// 빠른 입력에 쓰다 만 명령을 localStorage 에 보관한다.
//
// 왜 필요한가: CommandInput 은 지연 로딩 청크다. 배포가 나가면 빌드가 옛 해시 청크를
// 지우므로(vite emptyOutDir), 배포 전에 열어둔 탭이 빠른 입력을 처음 누르는 순간
// 그 청크를 404 로 못 받는다. LazyErrorBoundary 가 이를 잡아 페이지를 리로드해 복구하는데,
// 그때 App 의 commandText 상태가 통째로 날아간다. 초안을 여기 남겨 리로드를 넘긴다.
//
// 초안은 기기 로컬에만 둔다 — 서버로 보내지 않는다(명령에 비밀번호가 섞일 수 있다).

const STORAGE_KEY = 'iterm:quickInputDraft:v1';
// 붙여넣기 사고로 localStorage 를 채우지 않도록 상한을 둔다.
const MAX_LENGTH = 32768;

export const loadDraft = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return ''; // private mode / storage 비활성
  }
};

export const saveDraft = (text) => {
  try {
    if (text) localStorage.setItem(STORAGE_KEY, String(text).slice(0, MAX_LENGTH));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota 초과 / private mode — 초안 보존은 부가 기능이라 조용히 넘어간다 */
  }
};

export const clearDraft = () => saveDraft('');
