import { tokens } from '../../styles/tokens';
import { OPTIONS as MUX_OPTIONS, normalize as normalizeMux, HERDR } from '../../utils/multiplexer';
import { SHELL_CHOICES, INHERIT } from '../../utils/launchOptions';

const { color, font, fontSize, radius, space } = tokens;

/**
 * 폴더 픽커 아래 한 줄 — **이 터미널 하나를 무엇으로 열까.**
 *
 * ⚠️ **herdr 는 셸 선택을 쓰지 않는다 — 로컬이든 원격이든.** `herdr --session <이름>`
 * 하나가 생성과 접속을 겸하고 셸을 인자로 받지 않기 때문이다(tmux 는 `new-session` 에
 * 받고, `none` 은 그 셸을 직접 exec 한다). 그래서 herdr 일 때는 칸을 **지우지 않고
 * 비활성으로 두고 이유를 적는다** — 사라지면 "왜 아까는 있었지" 가 되고, 그대로 두면
 * 골라도 아무 일이 없는 조용한 실패가 된다.
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
  // 안 골랐으면 설정값이 곧 이 pane 이 뜰 방식이다 — 판정도 그걸 따라야 한다.
  const effectiveMux = normalizeMux(multiplexer || defaultMultiplexer);
  const shellIgnored = effectiveMux === HERDR;
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
        <label
          style={{ ...styles.field, opacity: shellIgnored ? 0.5 : 1 }}
          title={shellIgnored ? (t?.('launchShellIgnored') || 'herdr 는 자기 셸로 엽니다') : undefined}
        >
          <span style={styles.label}>{t?.('launchShell') || '셸'}</span>
          <select
            style={styles.select}
            value={shell}
            disabled={shellIgnored}
            onChange={(e) => onChange?.({ multiplexer, shell: e.target.value })}
          >
            <option value={INHERIT}>{inheritShell}</option>
            {SHELL_CHOICES.map((sh) => <option key={sh} value={sh}>{sh}</option>)}
          </select>
        </label>
      )}
      {showShell && shellIgnored && (
        <span style={styles.note}>{t?.('launchShellIgnored') || 'herdr 는 자기 셸로 엽니다'}</span>
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
  note: {
    fontSize: fontSize['10'],
    color: color.muted,
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
