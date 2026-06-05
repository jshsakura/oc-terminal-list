import { useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { tokens } from '../../styles/tokens';
import HostIcon from '../../utils/hostIcons';
import SkeletonRow from '../common/SkeletonRow';

const { color, font, fontSize, fontWeight, radius, space, motion } = tokens;

export const IconButton = ({ value, colorIndex, onOpen, t }) => {
  const iconColor = color.dotPalette[(colorIndex || 0) % color.dotPalette.length];
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        height: '32px',
        padding: `0 10px`,
        background: color.mantle,
        color: color.text,
        border: `1px solid ${color.border}`,
        borderRadius: radius.sm,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: fontSize['12'],
        alignSelf: 'flex-start',
        transition: `background ${motion.fast}, border-color ${motion.fast}`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = color.surface0; e.currentTarget.style.borderColor = color.borderStrong; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = color.mantle; e.currentTarget.style.borderColor = color.border; }}
    >
      <span style={{ color: iconColor, display: 'inline-flex', alignItems: 'center' }}>
        <HostIcon value={value} size={16} />
      </span>
      <span style={{ color: value ? color.text : color.muted }}>
        {value || (t?.('chooseIcon') || 'Choose icon…')}
      </span>
      <ChevronDown size={12} strokeWidth={1.8} style={{ color: color.muted }} />
    </button>
  );
};

export const ColorPicker = ({ value, onChange }) => (
  <div style={{ display: 'flex', gap: space['1.5'], flexWrap: 'wrap' }}>
    {color.dotPalette.map((c, i) => (
      <button
        key={c}
        type="button"
        onClick={() => onChange(i)}
        title={`color ${i + 1}`}
        style={{
          width: '22px',
          height: '22px',
          padding: 0,
          background: c,
          border: i === value ? `2px solid ${color.text}` : `2px solid transparent`,
          borderRadius: radius.full,
          cursor: 'pointer',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)',
          transition: `border-color ${motion.fast}, transform ${motion.fast}, box-shadow ${motion.fast}`,
        }}
        onMouseEnter={(e) => {
          if (i === value) return;
          e.currentTarget.style.transform = 'scale(1.12)';
          e.currentTarget.style.boxShadow = `inset 0 0 0 1px rgba(0,0,0,0.25), 0 0 0 2px ${c}55`;
        }}
        onMouseLeave={(e) => {
          if (i === value) return;
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,0.25)';
        }}
      />
    ))}
  </div>
);

// 주소 형식 선택 버튼 — TailscalePicker 행에서 DNS/IP 둘 중 하나 선택.
export const PickBtn = ({ children, onClick, disabled, title }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      padding: '4px 8px',
      fontSize: '10px',
      fontWeight: fontWeight.semibold,
      fontFamily: font.mono,
      letterSpacing: '0.04em',
      background: disabled ? 'transparent' : color.surface0,
      color: disabled ? color.muted : color.subtext,
      border: `1px solid ${disabled ? color.border : color.borderStrong}`,
      borderRadius: radius.sm,
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'background 120ms, color 120ms, border-color 120ms',
      lineHeight: 1.2,
    }}
    onMouseEnter={(e) => {
      if (disabled) return;
      e.currentTarget.style.background = color.accent;
      e.currentTarget.style.color = color.crust;
      e.currentTarget.style.borderColor = color.accent;
    }}
    onMouseLeave={(e) => {
      if (disabled) return;
      e.currentTarget.style.background = color.surface0;
      e.currentTarget.style.color = color.subtext;
      e.currentTarget.style.borderColor = color.borderStrong;
    }}
  >
    {children}
  </button>
);

export const TailscalePicker = ({ data, onPick, onClose, t }) => {
  useEffect(() => {
    const handle = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 50 }} />
      <div style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        right: 0,
        zIndex: 51,
        background: color.base,
        border: `1px solid ${color.borderStrong}`,
        borderRadius: radius.md,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        maxHeight: '260px',
        overflow: 'auto',
        fontFamily: font.sans,
      }}>
        {!data.available ? (
          <div style={{ padding: '12px', fontSize: fontSize['12'], color: color.subtext, textAlign: 'center' }}>
            {t?.('tailscaleUnavailable') || 'Tailscale not available on the server.'}
          </div>
        ) : data.loading ? (
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0' }}>
                <SkeletonRow width="8px" height="8px" borderRadius="50%" />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <SkeletonRow width={`${55 + ((i * 11) % 25)}%`} height="12px" />
                  <SkeletonRow width="40%" height="10px" />
                </div>
              </div>
            ))}
          </div>
        ) : data.peers.length === 0 ? (
          <div style={{ padding: '12px', fontSize: fontSize['12'], color: color.subtext, textAlign: 'center' }}>
            {t?.('tailscaleNoPeers') || 'No tailnet peers found.'}
          </div>
        ) : (
          data.peers.map((peer) => {
            const hasDns = !!peer.dns_name;
            const hasIp = !!peer.ip;
            return (
              <div
                key={peer.id || peer.ip}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  width: '100%', padding: '8px 10px 8px 12px',
                  borderBottom: `1px solid ${color.border}`,
                  fontFamily: font.sans,
                  opacity: peer.is_self ? 0.5 : 1,
                }}
              >
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: peer.online ? color.success : color.muted,
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: fontSize['12'], fontWeight: fontWeight.medium, color: color.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {peer.hostname}
                    {peer.is_self && ` (${t?.('thisMachine') || 'this machine'})`}
                  </div>
                  <div style={{ fontSize: '10.5px', color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {peer.dns_name || peer.ip} · {peer.os}
                  </div>
                </div>
                {/* IP / DNS 선택 버튼 — 사용자가 명시적으로 어떤 주소 형식으로 호스트를 박을지 결정. */}
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <PickBtn
                    onClick={() => onPick(peer, false)}
                    disabled={peer.is_self || !hasDns}
                    title={hasDns ? peer.dns_name : (t?.('tailscaleNoDns') || 'No MagicDNS')}
                  >
                    DNS
                  </PickBtn>
                  <PickBtn
                    onClick={() => onPick(peer, true)}
                    disabled={peer.is_self || !hasIp}
                    title={hasIp ? peer.ip : (t?.('tailscaleNoIp') || 'No IP')}
                  >
                    IP
                  </PickBtn>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
};
