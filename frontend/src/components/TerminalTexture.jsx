/**
 * TerminalTexture — 테마 `texture` 필드에 따른 pane 질감 오버레이.
 *
 * 전부 정적 CSS 그라디언트(애니메이션 없음)라 컴포지터 단계에서만 처리 →
 * 저지연 원칙을 지킨다. WebGL 캔버스에 filter 를 걸지 않는다(출력 시 매 프레임
 * 재합성 비용). 네온 발광은 팔레트 채도로 표현하고, 여기선 비네트/주사선만 얹는다.
 *
 * pointer-events:none 이라 터미널 입력/스크롤/터치를 방해하지 않는다.
 *
 * props:
 *   texture : 'scanline' | 'glow' | 'flat' | undefined
 *   accent  : glow 비네트 색조에 쓸 강조색 (테마 accent)
 */
const SCANLINE = `repeating-linear-gradient(
  to bottom,
  rgba(0, 0, 0, 0.26) 0px,
  rgba(0, 0, 0, 0.26) 1px,
  transparent 1px,
  transparent 3px
)`;

const VIGNETTE = 'radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.34) 100%)';

const baseStyle = {
  position: 'absolute',
  inset: 0,
  zIndex: 3,
  pointerEvents: 'none',
  userSelect: 'none',
};

const glowTint = (accent) => `radial-gradient(ellipse at center, ${
  toRgba(accent, 0.08)
} 0%, transparent 55%)`;

// hex(#rrggbb) → rgba(). 실패 시 투명.
function toRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 'rgba(0,0,0,0)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

const TerminalTexture = ({ texture, accent }) => {
  if (texture === 'scanline') {
    return (
      <div
        aria-hidden="true"
        style={{
          ...baseStyle,
          // 주사선 위에 은은한 비네트를 겹쳐 CRT 곡률감을 준다.
          backgroundImage: `${VIGNETTE}, ${SCANLINE}`,
        }}
      />
    );
  }

  if (texture === 'glow') {
    return (
      <div
        aria-hidden="true"
        style={{
          ...baseStyle,
          backgroundImage: `${glowTint(accent)}, ${VIGNETTE}`,
        }}
      />
    );
  }

  // 'flat' / 없음 → 오버레이 없음 (e-ink 는 질감의 '부재'가 정체성)
  return null;
};

export default TerminalTexture;
