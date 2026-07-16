import { useEffect } from 'react';
import { isFileDrag } from '../utils/fileDrag';

/**
 * 빗맞은 파일 드롭이 페이지를 날려먹지 않게 창 전체에서 삼킨다.
 *
 * 터미널을 조준하다 탭 바나 여백에 떨어뜨리면 브라우저 기본동작이 그 파일을 열어버린다
 * = 앱에서 이탈(탭 상태·열려있던 pane 다 날아감). 드롭 하나 빗맞았다고 치르기엔 너무 큰 대가다.
 *
 * 진짜 드롭 존(터미널·파일탐색기)은 자기 핸들러에서 stopPropagation 하므로 여기까지 오지 않는다.
 * 즉 여기 도달했다 = 아무도 안 받는 드롭 = 무시해야 하는 드롭.
 * 탭/pane 내부 드래그는 자체 MIME 이라 isFileDrag 에서 걸러진다.
 */
const useBlockStrayFileDrop = () => {
  useEffect(() => {
    // dragover 를 preventDefault 해야 브라우저가 이 지점을 "드롭 가능"으로 보고
    // 뒤이은 drop 이벤트를 준다. 그래야 drop 의 기본동작(파일 열기)도 막을 수 있다.
    const handleDragOver = (e) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none'; // 여긴 못 놓는다고 커서로 알려준다
    };
    const handleDrop = (e) => {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);
};

export default useBlockStrayFileDrop;
