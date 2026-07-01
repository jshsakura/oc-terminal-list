// 라이브 카메라 촬영 오버레이 — 빠른입력창에서 바로 사진을 찍어 이미지 업로드 파이프라인
// (uploadImageAndGetPath)으로 넘긴다. 데스크톱 웹캠 + 모바일 전/후면 모두 지원.
//
// getUserMedia 는 secure context(HTTPS/localhost)에서만 동작한다. 권한 거부·장치 없음은
// 조용히 삼키지 않고 사용자에게 메시지로 알린다. MediaStream 은 닫힘/언마운트 시 반드시 해제.
import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X, RefreshCw, SwitchCamera, Loader2 } from 'lucide-react';

const OVERLAY_Z = 4000;

export default function CameraCapture({ isOpen, onCapture, onClose, t }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [status, setStatus] = useState('starting'); // starting | ready | error | capturing
  const [errorMsg, setErrorMsg] = useState('');

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((tr) => { try { tr.stop(); } catch { /* noop */ } });
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // isOpen/facingMode 변화마다 스트림 재획득. cleanup 에서 반드시 해제.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setStatus('starting');
    setErrorMsg('');

    const start = async () => {
      const md = navigator.mediaDevices;
      if (!md?.getUserMedia) {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(t?.('cameraUnsupported') || 'This browser/context has no camera access (HTTPS required).');
        }
        return;
      }
      try {
        const stream = await md.getUserMedia({ video: { facingMode }, audio: false });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => { /* autoplay 정책 — 사용자 제스처로 이미 열림 */ });
        }
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        const name = err?.name || '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setErrorMsg(t?.('cameraDenied') || 'Camera permission was denied.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setErrorMsg(t?.('cameraNotFound') || 'No camera device was found.');
        } else {
          setErrorMsg(t?.('cameraError') || 'Could not start the camera.');
        }
      }
    };

    start();
    return () => { cancelled = true; stopStream(); };
  }, [isOpen, facingMode, stopStream, t]);

  const handleShutter = useCallback(() => {
    const video = videoRef.current;
    if (!video || status !== 'ready') return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    setStatus('capturing');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture?.(blob); // 압축은 업로드 파이프라인(compressPastedImage)이 담당
        stopStream();
        onClose?.();
      },
      'image/jpeg',
      0.92,
    );
  }, [status, onCapture, onClose, stopStream]);

  const handleClose = useCallback(() => { stopStream(); onClose?.(); }, [stopStream, onClose]);
  const flipCamera = useCallback(() => {
    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'));
  }, []);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: OVERLAY_Z,
        background: 'rgba(0,0,0,0.86)', display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
      }}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) handleClose(); }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <button
        type="button" onClick={handleClose} aria-label={t?.('close') || 'Close'}
        style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.12)',
          border: 'none', borderRadius: 999, color: '#fff', width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        <X size={20} />
      </button>

      {status === 'error' ? (
        <div style={{ color: '#fff', textAlign: 'center', maxWidth: 320, padding: 24 }}>
          <Camera size={40} style={{ opacity: 0.5, marginBottom: 12 }} />
          <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.5 }}>{errorMsg}</p>
          <button
            type="button" onClick={() => setFacingMode((m) => m)}
            style={{ background: '#fff', color: '#111', border: 'none', borderRadius: 8,
              padding: '8px 16px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} /> {t?.('retry') || 'Retry'}
          </button>
        </div>
      ) : (
        <>
          <div style={{ position: 'relative', width: 'min(92vw, 640px)', aspectRatio: '4 / 3',
            background: '#000', borderRadius: 12, overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video
              ref={videoRef} playsInline muted
              style={{ width: '100%', height: '100%', objectFit: 'cover',
                transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
            />
            {status !== 'ready' && (
              <div style={{ position: 'absolute', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Loader2 size={20} className="animate-spin" /> {t?.('cameraStarting') || 'Starting camera…'}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <button
              type="button" onClick={flipCamera} aria-label={t?.('switchCamera') || 'Switch camera'}
              title={t?.('switchCamera') || 'Switch camera'}
              style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 999,
                color: '#fff', width: 48, height: 48, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <SwitchCamera size={22} />
            </button>
            <button
              type="button" onClick={handleShutter} disabled={status !== 'ready'}
              aria-label={t?.('takePhoto') || 'Take photo'} title={t?.('takePhoto') || 'Take photo'}
              style={{ width: 72, height: 72, borderRadius: 999, cursor: status === 'ready' ? 'pointer' : 'default',
                background: '#fff', border: '4px solid rgba(255,255,255,0.4)', opacity: status === 'ready' ? 1 : 0.5,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Camera size={28} color="#111" />
            </button>
            <div style={{ width: 48 }} />
          </div>
        </>
      )}
    </div>
  );
}
