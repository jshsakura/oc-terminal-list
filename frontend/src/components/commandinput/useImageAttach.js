import { useEffect, useRef, useState } from 'react';
import { uploadImageAndGetPath } from '../terminal/terminalHelpers';

// 업로드 실패 문구를 띄워두는 시간 — 지나면 상태를 비워 원래 아이콘으로 돌아간다.
const ERROR_HOLD_MS = 2500;

/**
 * 이미지 첨부 — 📎 버튼(파일 피커)과 textarea 붙여넣기 두 경로 모두를 담당한다.
 * PTY 는 텍스트만 보내므로 이미지 자체가 아니라 서버에 올린 뒤 그 *저장 경로* 를
 * 커서 위치에 끼워넣는 식으로 우회한다.
 *
 * @param insertAtCursor 업로드된 경로를 입력창 커서 위치에 삽입하는 콜백
 * @param hostId 지금 보고 있는 pane 의 호스트(로컬이면 null). 원격이면 이미지가 그
 *   호스트에 올라가야 상대 셸이 열 수 있다.
 *
 * ⚠️ 여러 pane 에 동시 전송할 때는 **보고 있는 pane 의 호스트** 기준으로 한 번만
 * 올린다. 경로 하나가 서로 다른 머신에서 동시에 유효할 수는 없다.
 */
const useImageAttach = (insertAtCursor, hostId = null) => {
  // 숨김 file input — 📎 버튼이 click() 으로 연다(모바일은 카메라/갤러리 선택지 노출).
  const fileInputRef = useRef(null);
  // null | 'uploading' | 'error'. 모바일은 hover title 이 없어 인라인 표시가 필요하다.
  const [uploadState, setUploadState] = useState(null);
  const errorTimerRef = useRef(0);

  useEffect(() => () => window.clearTimeout(errorTimerRef.current), []);

  const upload = async (blob) => {
    if (uploadState === 'uploading') return; // 중복 업로드 차단
    setUploadState('uploading');
    try {
      const data = await uploadImageAndGetPath(blob, hostId);
      insertAtCursor(`${data.path} `);
      setUploadState(null);
    } catch (err) {
      console.error('image upload failed', err);
      setUploadState('error');
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = window.setTimeout(() => setUploadState(null), ERROR_HOLD_MS);
    }
  };

  const openPicker = () => fileInputRef.current?.click();

  // 같은 파일을 다시 골라도 change 가 뜨도록 값부터 리셋.
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && file.type.startsWith('image/')) upload(file);
  };

  // 클립보드에 이미지가 있으면 가로채 업로드, 텍스트는 브라우저 기본 동작에 맡긴다.
  const handlePaste = (e) => {
    const imageItem = Array.from(e.clipboardData?.items || []).find(
      (it) => it.kind === 'file' && it.type.startsWith('image/'),
    );
    if (!imageItem) return;
    const blob = imageItem.getAsFile();
    if (!blob) return;
    e.preventDefault();
    upload(blob);
  };

  return {
    fileInputRef,
    uploadState,
    isUploading: uploadState === 'uploading',
    openPicker,
    handleFileChange,
    handlePaste,
  };
};

export default useImageAttach;
