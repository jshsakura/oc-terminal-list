/**
 * OS 파일 드래그인지 — 탭/pane/세션 내부 드래그(자체 MIME)와 구분한다.
 *
 * 드롭 처리부와 window 전역 방어가 같은 판정을 써야 해서 여기 둔다.
 * (드롭 모듈에서 가져다 쓰면 업로드 코드까지 시작 번들로 딸려온다.)
 */
/** 파일 탐색기 내부 드래그의 MIME — 트리 이동과 터미널 경로 삽입이 같은 값을 봐야 한다. */
export const TREE_PATH_MIME = 'application/x-filetree-path';

/** 그 경로가 **어느 기계의 것인지**. 로컬은 ''. 경로만으로는 알 수 없어 따로 싣는다 —
 *  분할 화면에서는 A pane 의 탐색기에서 B pane 으로 끌 수 있고, 두 pane 의 호스트가
 *  다르면 그 경로는 저쪽에서 아무것도 가리키지 않는다. */
export const TREE_HOST_MIME = 'application/x-filetree-host';

export const isFileDrag = (dataTransfer) => Array.from(dataTransfer?.types || []).includes('Files');

export default isFileDrag;
