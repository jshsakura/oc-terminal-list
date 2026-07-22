import { useEffect, useRef, useState } from 'react';
import { uploadImageAndGetPath } from '../terminal/terminalHelpers';

// 업로드 실패 문구를 띄워두는 시간 — 지나면 상태를 비워 원래 아이콘으로 돌아간다.
const ERROR_HOLD_MS = 2500;

/**
 * 이미지 첨부 — 📎 버튼(파일 피커)과 textarea 붙여넣기 두 경로 모두를 담당한다.
 * PTY 는 텍스트만 보내므로 이미지 자체가 아니라 서버에 올린 뒤 그 *저장 경로* 를
 * 커서 위치에 끼워넣는 식으로 우회한다.
 *
 * **여러 pane 에 동시 전송하면 각 pane 의 호스트마다 올린다.** 붙여넣는 순간에는
 * 보고 있는 pane 의 호스트로 한 번 올려 경로를 보여주고(사용자가 실제 경로를 봐야
 * 하니까), 전송할 때 다른 호스트에 있는 대상에는 같은 이미지를 그 호스트로 올린 뒤
 * 그 pane 에 갈 텍스트에서만 경로를 바꿔 끼운다. 전송은 어차피 pane 별로 나가므로
 * 경로도 pane 별로 다르면 된다.
 *
 * @param insertAtCursor 업로드된 경로를 입력창 커서 위치에 삽입하는 콜백
 * @param hostId 지금 보고 있는 pane 의 호스트(로컬이면 null)
 */
const useImageAttach = (insertAtCursor, hostId = null) => {
  // 숨김 file input — 📎 버튼이 click() 으로 연다(모바일은 카메라/갤러리 선택지 노출).
  const fileInputRef = useRef(null);
  // null | 'uploading' | 'error'. 모바일은 hover title 이 없어 인라인 표시가 필요하다.
  const [uploadState, setUploadState] = useState(null);
  const errorTimerRef = useRef(0);

  /**
   * 이번 입력창에 끼워넣은 첨부들.
   * `{ blob, pathByHost: { [hostKey]: path } }` — 같은 이미지를 같은 호스트에
   * 두 번 올리지 않도록 호스트별 경로를 캐시한다. 로컬은 키가 '' 다.
   */
  const attachmentsRef = useRef([]);

  useEffect(() => () => window.clearTimeout(errorTimerRef.current), []);

  const upload = async (blob) => {
    if (uploadState === 'uploading') return; // 중복 업로드 차단
    setUploadState('uploading');
    try {
      const data = await uploadImageAndGetPath(blob, hostId);
      attachmentsRef.current = [
        ...attachmentsRef.current,
        { blob, pathByHost: { [hostId || '']: data.path } },
      ];
      insertAtCursor(`${data.path} `);
      setUploadState(null);
    } catch (err) {
      console.error('image upload failed', err);
      setUploadState('error');
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = window.setTimeout(() => setUploadState(null), ERROR_HOLD_MS);
    }
  };

  /** 이 호스트에서 쓸 수 있는 경로 — 없으면 그 호스트로 올리고 캐시한다. */
  const pathForHost = async (attachment, targetHostId) => {
    const key = targetHostId || '';
    const cached = attachment.pathByHost[key];
    if (cached) return cached;
    const data = await uploadImageAndGetPath(attachment.blob, targetHostId);
    attachment.pathByHost[key] = data.path;   // eslint-disable-line no-param-reassign
    return data.path;
  };

  /**
   * 대상 pane 별 전송 텍스트를 만든다. `{ [paneKey]: text }`.
   *
   * 첨부가 없거나 대상이 전부 같은 호스트면 추가 업로드가 일어나지 않는다 —
   * 흔한 경우(단일 대상)에는 비용이 0 이다.
   */
  const resolveTextForTargets = async (text, targetKeys, panes) => {
    const attachments = attachmentsRef.current;
    if (!attachments.length || !text) return {};

    const hostOf = (key) => panes.find((p) => p.key === key)?.hostId || null;
    const needed = [...new Set(targetKeys.map((k) => hostOf(k) || ''))];

    // 아직 안 올린 (첨부 × 호스트) 조합만 올린다 — 대상이 전부 같은 호스트면 비용 0.
    // 하나가 실패해도 나머지 대상은 보낸다. 실패한 호스트의 pane 만 원래 경로가
    // 남아 그 pane 에서 안 열린다(전체 전송을 막는 것보다 낫다).
    await Promise.all(needed.flatMap((h) => attachments
      .filter((a) => !a.pathByHost[h])
      .map(async (a) => {
        try {
          await pathForHost(a, h || null);
        } catch (err) {
          console.error('attachment upload failed for host', h || 'local', err);
        }
      })));

    const originKey = hostId || '';
    const byKey = {};
    targetKeys.forEach((key) => {
      const targetKey = hostOf(key) || '';
      byKey[key] = attachments.reduce((acc, a) => {
        const from = a.pathByHost[originKey];
        const to = a.pathByHost[targetKey];
        return from && to && from !== to ? acc.split(from).join(to) : acc;
      }, text);
    });
    return byKey;
  };

  /** 첨부가 하나라도 있나 — **동기** 판정. 흔한 경우(첨부 없음)를 비동기로 만들지 않기 위해. */
  const hasAttachments = () => attachmentsRef.current.length > 0;

  /** 전송이 끝나면 첨부 기록을 비운다 — 다음 명령에 옛 경로가 딸려가지 않게. */
  const clearAttachments = () => { attachmentsRef.current = []; };

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
    hasAttachments,
    resolveTextForTargets,
    clearAttachments,
  };
};

export default useImageAttach;
