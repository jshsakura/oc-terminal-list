/**
 * 디자인 토큰 — UI 의 단일 진실의 출처.
 *
 * 색 토큰은 CSS 커스텀 프로퍼티(var(--ui-*)) 를 가리킨다.
 * 활성 테마가 바뀌면 ThemeProvider 가 :root 의 CSS 변수만 갱신 → 모든 컴포넌트 즉시 따라감.
 * (= React 리렌더 없이도 색이 즉시 변경됨)
 *
 * spacing/radius/typography/motion 은 정적.
 */

// ─── 색 ──────────────────────────────────────────────────────────────────
const v = (name, fallback) => `var(--ui-${name}, ${fallback})`;
const palette = {
  // base layers
  crust:    v('crust',    '#0f0f17'),
  mantle:   v('mantle',   '#15151f'),
  base:     v('base',     '#1a1a25'),
  surface0: v('surface0', '#23232f'),
  surface1: v('surface1', '#2d2d3c'),
  surface2: v('surface2', '#393949'),

  // text
  text:    v('text',    '#e4e6f1'),
  subtext: v('subtext', '#a8acc4'),
  muted:   v('muted',   '#6c7086'),
  faint:   v('faint',   '#45475a'),

  // 액센트
  accent:        v('accent',        '#89b4fa'),
  accentSubtle:  v('accent-subtle', 'rgba(137, 180, 250, 0.12)'),
  accentBorder:  v('accent-border', 'rgba(137, 180, 250, 0.32)'),

  // semantic
  success: v('success', '#a6e3a1'),
  warning: v('warning', '#f9e2af'),
  danger:  v('danger',  '#f38ba8'),
  info:    v('info',    '#74c7ec'),

  // 호스트 dot 후보
  dotPalette: ['#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7', '#94e2d5', '#fab387', '#74c7ec'],

  // 보더
  border:        v('border',         'rgba(228, 230, 241, 0.06)'),
  borderStrong:  v('border-strong',  'rgba(228, 230, 241, 0.12)'),
  borderSubtle:  v('border-subtle',  'rgba(228, 230, 241, 0.03)'),

  // overlay
  scrim: v('scrim', 'rgba(0, 0, 0, 0.55)'),
};

// ─── 타이포 ──────────────────────────────────────────────────────────────
const fonts = {
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Pretendard Variable", "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif',
  mono: '"JetBrainsMono Nerd Font Mono", "MesloLGS NF", "JetBrains Mono", Menlo, Monaco, monospace',
};

const fontSize = {
  '11': '11px',  // micro caption
  '12': '12px',  // small label
  '13': '13px',  // 본문 표준
  '14': '14px',  // 본문 강조 / 버튼
  '16': '16px',  // 섹션 타이틀
  '20': '20px',  // 페이지 타이틀
  '24': '24px',  // 모달/시작 화면 타이틀
};

const fontWeight = {
  regular:  400,
  medium:   500,
  semibold: 600,
};

const lineHeight = {
  tight:   1.25,
  normal:  1.45,
  relaxed: 1.6,
};

// ─── 스페이싱 / 라디우스 ─────────────────────────────────────────────────
const space = {
  '0.5': '2px',
  '1':   '4px',
  '1.5': '6px',
  '2':   '8px',
  '3':   '12px',
  '4':   '16px',
  '5':   '20px',
  '6':   '24px',
  '8':   '32px',
  '10':  '40px',
  '12':  '48px',
};

const radius = {
  xs: '3px',
  sm: '5px',   // 입력 필드 / 버튼 기본
  md: '7px',   // 카드
  lg: '10px',  // 모달
  xl: '14px',  // 큰 컨테이너
  full: '999px',
};

// ─── 깊이 (shadow) — Zed 처럼 거의 안 보이게 ───────────────────────────────
const shadow = {
  none:   'none',
  inset:  'inset 0 1px 0 rgba(255, 255, 255, 0.04)',  // 윗 하이라이트 (입체감)
  sm:     '0 1px 2px rgba(0, 0, 0, 0.35)',
  md:     '0 4px 12px rgba(0, 0, 0, 0.40)',
  lg:     '0 12px 32px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35)',
  pop:    '0 8px 24px rgba(0, 0, 0, 0.50), 0 0 0 1px rgba(228, 230, 241, 0.06)',
};

// ─── 모션 ────────────────────────────────────────────────────────────────
const motion = {
  fast:    '120ms cubic-bezier(0.2, 0, 0, 1)',     // hover, focus
  normal:  '180ms cubic-bezier(0.16, 1, 0.3, 1)',  // 레이아웃 변화
  slow:    '280ms cubic-bezier(0.16, 1, 0.3, 1)',  // 모달 open/close
};

// ─── z-index ─────────────────────────────────────────────────────────────
const z = {
  base: 0,
  raised: 10,
  sticky: 20,
  overlay: 50,
  modal: 100,
  popover: 200,
  toast: 300,
};

// ─── 통합 export ─────────────────────────────────────────────────────────
export const tokens = {
  color: palette,
  font: fonts,
  fontSize,
  fontWeight,
  lineHeight,
  space,
  radius,
  shadow,
  motion,
  z,
};

// 자주 쓰이는 조합 프리셋
export const presets = {
  // 카드 표면
  card: {
    background: palette.surface0,
    border: `1px solid ${palette.border}`,
    borderRadius: radius.md,
    boxShadow: shadow.sm,
  },
  // 입력 필드
  input: {
    background: palette.crust,
    border: `1px solid ${palette.border}`,
    borderRadius: radius.sm,
    color: palette.text,
    fontSize: fontSize['13'],
    padding: `${space['2']} ${space['3']}`,
    transition: `border-color ${motion.fast}, background ${motion.fast}`,
  },
  // 버튼 — primary
  buttonPrimary: {
    background: palette.accent,
    color: palette.crust,
    border: 'none',
    borderRadius: radius.sm,
    fontSize: fontSize['13'],
    fontWeight: fontWeight.medium,
    padding: `${space['2']} ${space['4']}`,
    cursor: 'pointer',
    transition: `transform ${motion.fast}, opacity ${motion.fast}`,
  },
  // 버튼 — ghost (보더만)
  buttonGhost: {
    background: 'transparent',
    color: palette.text,
    border: `1px solid ${palette.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['13'],
    fontWeight: fontWeight.medium,
    padding: `${space['2']} ${space['4']}`,
    cursor: 'pointer',
    transition: `border-color ${motion.fast}, background ${motion.fast}`,
  },
};

export default tokens;
