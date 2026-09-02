import { tokens } from '../../styles/tokens';
import { OPTIONS as MUX_OPTIONS, normalize as normalizeMux } from '../../utils/multiplexer';
import { SHELL_CHOICES, INHERIT } from '../../utils/launchOptions';

const { color, font, fontSize, radius, space } = tokens;

/**
 * 폴더 픽커 아래 한 줄 — **이 터미널 하나를 무엇으로 열까.**
 *
 * ⚠️ **셸은 로컬에만 있다.** 원격 pane 의 WS 는 `shell` 을 아예 안 싣는다 — 그쪽은 그
 * 호스트의 로그인 셸(또는 tmux/herdr 의 기본)이 뜬다. 그래서 원격 픽커에서는 이 칸을
 * 그리지 않는다. 아무 일도 안 하는 칸을 내미는 것이 이 저장소가 반복해서 피해 온
 * "조용한 실패" 다(`showShell` 이 그 판정 하나).
 *
 * 기본 선택지의 라벨에 **지금 설정값을 괄호로 적는다**(`기본 (tmux)`). "기본" 만 있으면
 * 그게 무엇인지 알려면 설정을 열어 봐야 한다.
 */
const TerminalLaunchOptions = ({
  multiplexer = INHERIT,
  shell = INHERIT,
  onChange,
  defaultMultiplexer,
  defaultShell,
  showShell = true,
  t,
}) => {
  const inheritMux = `${t?.('launchDefault') || '기본'} (${normalizeMux(defaultMultiplexer)})`;
  const shownDefaultShell = (defaultShell || 'auto') === 'auto'
    ? (t?.('shellAuto') || '자동')
    : defaultShell;
  const inheritShell = `${t?.('launchDefault') || '기본'} (${shownDefaultShell})`;

  return (
    <div style={styles.wrap}>
      <label style={styles.field}>
        <span style={styles.label}>{t?.('launchMultiplexer') || '터미널'}</span>
        <select
          style={styles.select}
          value={multiplexer}
          onChange={(e) => onChange?.({ multiplexer: e.target.value, shell })}
        >
          <option value={INHERIT}>{inheritMux}</option>
          {MUX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      {showShell && (
        <label style={styles.field}>
          <span style={styles.label}>{t?.('launchShell') || '셸'}</span>
          <select
            style={styles.select}
            value={shell}
            onChange={(e) => onChange?.({ multiplexer, shell: e.target.value })}
          >
            <option value={INHERIT}>{inheritShell}</option>
            {SHELL_CHOICES.map((sh) => <option key={sh} value={sh}>{sh}</option>)}
          </select>
        </label>
      )}
    </div>
  );
};

const styles = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space['2'],
    padding: `${space['2']} ${space['3']}`,
    borderTop: `1px solid ${color.border}`,
    fontFamily: font.sans,
  },
  field: {
    display: 'flex',
    alignItems: 'center',
    gap: space['1'],
    minWidth: 0,
  },
  label: {
    fontSize: fontSize['11'],
    color: color.subtext,
    whiteSpace: 'nowrap',
  },
  select: {
    background: color.crust,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: radius.sm,
    fontSize: fontSize['11'],
    fontFamily: font.sans,
    padding: '3px 6px',
    cursor: 'pointer',
    maxWidth: '132px',
  },
};

export default TerminalLaunchOptions;
