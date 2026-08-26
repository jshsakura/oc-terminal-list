import { tokens } from '../../styles/tokens';

const { color, fontSize, radius, space, motion } = tokens;

/* 트랙과 손잡이는 **함께 움직이는 한 벌**이다. 이동 거리를 손으로 적어 두면 폭을 바꿀 때
   손잡이가 트랙 밖으로 튀어나간다 — 그래서 치수에서 계산한다. */
const TRACK_W = 30;
const TRACK_H = 16;
const KNOB = 12;
const PAD = (TRACK_H - KNOB) / 2;
const TRAVEL = TRACK_W - KNOB - PAD * 2;

/**
 * 설정 스위치 — 라벨(+설명)과 트랙 한 벌.
 *
 * ⚠️ 예전에는 이 컴포넌트가 **두 벌**이었다(설정 · 호스트 편집기). 치수는 같은데 설정 쪽에만
 * `flexShrink: 0` 이 빠져 있어서, 설명이 붙은 긴 라벨(모바일처럼 폭이 좁을 때)이 트랙을
 * 눌러 찌그러뜨렸다. 손잡이는 absolute 라 안 줄어드니 트랙 밖으로 삐져나왔다 — 화면에서는
 * "토글이 깨졌다" 로 보이고, 코드에서는 두 파일이 서로를 모르니 티가 안 났다.
 *
 * 행 전체가 버튼이다. 예전 설정판은 <label> 로 감싸 커서만 손가락 모양이었는데,
 * <label> 은 button 을 활성화하지 못하므로 **글자를 눌러도 아무 일이 없었다**(폰에서
 * 정확히 그 넓은 면적을 누르게 된다).
 */
const Toggle = ({ label, hint, checked, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={!!checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    style={styles.row}
  >
    <span style={styles.textCol}>
      <span style={styles.label}>{label}</span>
      {hint ? <span style={styles.hint}>{hint}</span> : null}
    </span>
    <span
      style={{
        ...styles.track,
        background: checked ? color.accent : color.surface1,
      }}
    >
      <span
        style={{
          ...styles.knob,
          /* 손잡이 색은 **트랙을 따라** 바뀐다. 흰색으로 박아 두면 밝은 테마의 꺼짐
             (연회색 트랙)과 어두운 테마의 켜짐(밝은 액센트)에서 둘 다 묻힌다.
             crust/subtext 는 테마가 정하므로 어느 쪽에서도 대비가 선다. */
          background: checked ? color.crust : color.subtext,
          transform: checked ? `translateX(${TRAVEL}px)` : 'translateX(0)',
        }}
      />
    </span>
  </button>
);

const styles = {
  row: {
    // 버튼 기본값 지우기 — 이 버튼은 "행" 처럼 보여야 한다.
    display: 'flex',
    alignItems: 'center',
    gap: space['3'],
    width: '100%',
    padding: 0,
    border: 'none',
    background: 'none',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  textCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: 1,
    minWidth: 0,      // 긴 한글 라벨이 트랙을 밀어내지 못하게
  },
  label: {
    fontSize: fontSize['13'],
    color: color.text,
  },
  hint: {
    fontSize: fontSize['11'],
    color: color.muted,
    lineHeight: 1.45,
    wordBreak: 'keep-all',
    overflowWrap: 'anywhere',
  },
  track: {
    position: 'relative',
    flexShrink: 0,        // ⚠️ 이게 빠지면 라벨이 트랙을 찌그러뜨린다
    display: 'block',
    width: `${TRACK_W}px`,
    height: `${TRACK_H}px`,
    borderRadius: radius.full,
    transition: `background ${motion.fast}`,
  },
  knob: {
    position: 'absolute',
    top: `${PAD}px`,
    left: `${PAD}px`,
    width: `${KNOB}px`,
    height: `${KNOB}px`,
    borderRadius: radius.full,
    transition: `transform ${motion.fast}, background ${motion.fast}`,
  },
};

export default Toggle;
