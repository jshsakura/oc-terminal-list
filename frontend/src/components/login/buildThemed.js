import { tokens } from '../../styles/tokens';
import { themeValue, alpha } from './loginHelpers';

const { color, font, fontSize, fontWeight, radius, space, shadow, motion } = tokens;

export const buildThemed = (ui) => {
  const t = {
    crust: themeValue(ui, 'crust', color.crust),
    mantle: themeValue(ui, 'mantle', color.mantle),
    base: themeValue(ui, 'base', color.base),
    surface0: themeValue(ui, 'surface0', color.surface0),
    surface1: themeValue(ui, 'surface1', color.surface1),
    surface2: themeValue(ui, 'surface2', color.surface2),
    text: themeValue(ui, 'text', color.text),
    subtext: themeValue(ui, 'subtext', color.subtext),
    muted: themeValue(ui, 'muted', color.muted),
    accent: themeValue(ui, 'accent', color.accent),
    accentSubtle: themeValue(ui, 'accent-subtle', color.accentSubtle),
    accentBorder: themeValue(ui, 'accent-border', color.accentBorder),
    danger: themeValue(ui, 'danger', color.danger),
    border: themeValue(ui, 'border', color.border),
    borderStrong: themeValue(ui, 'border-strong', color.borderStrong),
    scrim: themeValue(ui, 'scrim', color.scrim),
  };

  return {
    ...t,
    dot: alpha(t.border, 'cc', 'rgba(255,255,255,0.06)'),

    overlay: {
      /* fixed 다 — iOS 에서 fixed 상자가 보이는 영역에 붙는다(App.jsx 의 `#root` 주석).
         정적 배치로 바꿨더니 최초 로딩에서 통째로 상단 크롬 뒤로 딸려 올라갔다. */
      position: 'fixed',
      inset: 0,
      background: `linear-gradient(135deg, ${t.crust} 0%, ${t.mantle} 48%, ${t.crust} 100%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      fontFamily: font.sans,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    },

    bgDots: {
      position: 'absolute',
      inset: 0,
      backgroundRepeat: 'repeat',
      opacity: 0.42,
      pointerEvents: 'none',
      maskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 78%, transparent 100%)',
      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 78%, transparent 100%)',
    },

    bgGlow: {
      position: 'absolute',
      inset: 0,
      background: [
        `radial-gradient(circle at 18% 18%, ${alpha(t.accent, '24', 'rgba(137, 180, 250, 0.14)')} 0, transparent 28%)`,
        `radial-gradient(circle at 78% 12%, ${alpha(t.borderStrong, '22', 'rgba(255,255,255,0.10)')} 0, transparent 24%)`,
        `radial-gradient(circle at 62% 88%, ${alpha(t.accent, '16', 'rgba(137, 180, 250, 0.08)')} 0, transparent 30%)`,
      ].join(', '),
      opacity: 0.95,
      pointerEvents: 'none',
    },

    bgVignette: {
      position: 'absolute',
      inset: 0,
      background: `radial-gradient(ellipse at center, transparent 34%, ${alpha(t.crust, '66', 'rgba(17,17,27,0.40)')} 68%, ${t.crust} 100%), linear-gradient(180deg, transparent 0%, ${alpha(t.crust, '88', 'rgba(17,17,27,0.52)')} 100%)`,
      pointerEvents: 'none',
    },

    card: {
      position: 'relative',
      width: 'calc(100% - 40px)',
      maxWidth: '380px',
      /* ⚠️ 반투명 + blur 로 두면 폰에서 "떠 있는 유리" 가 아니라 **안 읽히는 면**이 된다.
         이 카드는 뒤가 비쳐야 할 이유가 없다(뒤에 있는 건 점 패턴뿐이다) — 거의 불투명한
         면으로 두고, 테두리와 그림자로 띄운다. */
      /* ⚠️ 배경(crust→mantle 그라디언트) 위에 **mantle 로 칠하면 카드가 안 보인다** —
         투명도 문제가 아니라 같은 색이라서다. 한 단계 밝은 면(base)으로 띄운다. */
      background: alpha(t.surface0, 'fa', 'rgba(35,35,47,0.98)'),
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: radius.xl,
      boxShadow: '0 32px 90px rgba(0, 0, 0, 0.45), 0 2px 0 rgba(255,255,255,0.04) inset',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      overflow: 'hidden',
      margin: `${space['5']} 0`,
      flexShrink: 0,
    },

    accentBar: {
      height: '1px',
      background: `linear-gradient(90deg, transparent, ${alpha(t.border, '18', 'rgba(255,255,255,0.035)')}, transparent)`,
    },

    form: {
      padding: '32px 28px 28px',
      display: 'flex',
      flexDirection: 'column',
      gap: space['5'],
    },

    brand: {
      display: 'flex',
      justifyContent: 'center',
      marginBottom: space['1'],
    },
    brandIcon: {
      width: '36px',
      height: '36px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: alpha(t.surface0, '8c', 'rgba(49,50,68,0.55)'),
      border: `1px solid ${alpha(t.border, '18', 'rgba(255,255,255,0.035)')}`,
      borderRadius: radius.md,
      color: t.subtext,
    },

    heading: {
      fontSize: fontSize['18'],
      fontFamily: font.brand,
      fontWeight: 400,
      color: t.text,
      textAlign: 'center',
      lineHeight: 1.3,
      letterSpacing: 0,
    },

    sub: {
      fontSize: fontSize['13'],
      color: t.muted,
      textAlign: 'center',
      lineHeight: 1.5,
      margin: 0,
    },

    divider: {
      height: '1px',
      background: t.border,
      margin: `${space['1']} 0`,
    },

    field: {
      display: 'flex',
      flexDirection: 'column',
      gap: space['1.5'],
    },
    label: {
      fontSize: fontSize['12'],
      fontWeight: fontWeight.medium,
      color: t.subtext,
    },
    inputWrap: {
      display: 'flex',
      alignItems: 'center',
      gap: space['2'],
      height: '38px',
      padding: `0 ${space['3']}`,
      border: `1px solid ${t.border}`,
      borderRadius: radius.sm,
      transition: `border-color ${motion.fast}, box-shadow ${motion.fast}, background ${motion.fast}`,
    },
    input: {
      flex: 1,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontSize: fontSize['13'],
      color: t.text,
      height: '100%',
      padding: 0,
    },
    iconBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '26px',
      height: '26px',
      border: 'none',
      background: 'transparent',
      borderRadius: radius.xs,
      color: t.muted,
      cursor: 'pointer',
      flexShrink: 0,
      padding: 0,
      transition: `background ${motion.fast}, color ${motion.fast}`,
    },
    checkRow: {
      display: 'inline-flex',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: space['2'],
      color: t.subtext,
      fontSize: fontSize['12'],
      cursor: 'pointer',
      marginTop: `-${space['2']}`,
      userSelect: 'none',
    },
    /* 행 전체가 하나의 버튼이다 — 폰에서 14px 네이티브 체크박스는 조준이 안 된다. */
    checkBtn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: space['2'],
      alignSelf: 'flex-start',
      marginTop: `-${space['2']}`,
      padding: `${space['1']} ${space['2']} ${space['1']} ${space['1']}`,
      border: '1px solid transparent',
      borderRadius: radius.sm,
      background: 'transparent',
      color: t.subtext,
      fontFamily: 'inherit',
      fontSize: fontSize['12'],
      cursor: 'pointer',
      userSelect: 'none',
      transition: `background ${motion.fast}, color ${motion.fast}, border-color ${motion.fast}`,
    },
    checkBtnOn: {
      color: t.text,
      borderColor: alpha(t.accent, '3d', 'rgba(137,180,250,0.24)'),
      background: alpha(t.accent, '14', 'rgba(137,180,250,0.08)'),
    },
    /* 네이티브 체크박스는 접근성용으로만 남기고 화면에서는 감춘다(w/h 0 은 포커스를
       잃게 하므로 1px 로 둔다). */
    checkInput: {
      position: 'absolute',
      width: '1px',
      height: '1px',
      opacity: 0,
      pointerEvents: 'none',
      margin: 0,
    },
    checkMark: {
      width: '18px',
      height: '18px',
      flexShrink: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.xs,
      border: `1.5px solid ${alpha(t.border, '6b', 'rgba(255,255,255,0.20)')}`,
      background: t.surface0,
      color: 'transparent',
      transition: `background ${motion.fast}, border-color ${motion.fast}, color ${motion.fast}`,
    },
    checkMarkOn: {
      background: t.accent,
      borderColor: t.accent,
      color: t.crust,
    },

    error: {
      fontSize: fontSize['12'],
      color: t.danger,
      background: alpha(t.danger, '14', 'rgba(243, 139, 168, 0.08)'),
      border: `1px solid ${alpha(t.danger, '2e', 'rgba(243, 139, 168, 0.18)')}`,
      borderRadius: radius.sm,
      padding: `${space['2']} ${space['3']}`,
      textAlign: 'center',
    },
    submitBtn: {
      width: '100%',
      height: '38px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      border: `1px solid ${alpha(t.accent, '88', 'rgba(137, 180, 250, 0.54)')}`,
      background: t.accent,
      color: t.crust,
      fontFamily: 'inherit',
      fontSize: fontSize['13'],
      fontWeight: fontWeight.semibold,
      letterSpacing: 'normal',
      userSelect: 'none',
      outline: 'none',
      boxShadow: `0 10px 26px ${alpha(t.accent, '2e', 'rgba(137, 180, 250, 0.18)')}`,
      transition: `background ${motion.fast}, border-color ${motion.fast}, color ${motion.fast}, opacity ${motion.fast}, box-shadow ${motion.fast}`,
    },

    linkRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: space['2'],
      marginTop: space['1'],
    },
    linkBtn: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: space['1.5'],
      background: 'transparent',
      border: 'none',
      color: t.subtext,
      fontSize: fontSize['12'],
      cursor: 'pointer',
      padding: `${space['1.5']} ${space['2.5']}`,
      fontFamily: 'inherit',
      borderRadius: radius.sm,
      transition: `background ${motion.fast}, color ${motion.fast}, opacity ${motion.fast}`,
    },
    orDivider: {
      display: 'flex',
      alignItems: 'center',
      gap: space['2'],
      marginTop: space['3'],
      marginBottom: space['2'],
    },
    orLine: {
      flex: 1,
      height: '1px',
      background: t.border,
      opacity: 0.6,
    },
    orText: {
      fontSize: fontSize['11'],
      color: t.muted,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: fontWeight.medium,
    },
    passkeyBtn: {
      width: '100%',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space['2'],
      padding: `${space['2.5']} ${space['4']}`,
      background: 'transparent',
      color: t.text,
      border: `1px solid ${t.border}`,
      borderRadius: radius.sm,
      fontSize: fontSize['13'],
      fontWeight: fontWeight.medium,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: `background ${motion.fast}, border-color ${motion.fast}, color ${motion.fast}`,
    },

    /* 카드가 surface0 이므로 입력칸은 **더 어둡게**(mantle) — 그래야 파인 칸으로 읽힌다.
       카드와 같은 톤이면 입력칸의 경계가 사라진다. */
    _inputBg: alpha(t.mantle, 'e6', 'rgba(21,21,31,0.90)'),
    _inputFocusBg: t.crust,
    _inputBorder: t.border,
    _inputFocusBorder: t.accentBorder,
    _inputFocusShadow: `0 0 0 1px ${alpha(t.accentBorder, '88', 'rgba(137, 180, 250, 0.54)')}`,
    _iconMuted: t.muted,
    _submitHoverBg: t.accent,
    _submitHoverBorder: t.accent,
    _submitHoverShadow: `0 12px 30px ${alpha(t.accent, '45', 'rgba(137, 180, 250, 0.27)')}`,
  };
};
