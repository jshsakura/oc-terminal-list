import { tokens } from '../styles/tokens';

const { color, fontSize, fontWeight } = tokens;

/**
 * 홈 대시보드의 한 구획 — 소제목 + 내용.
 *
 * HomeDashboard 안에 있던 것을 꺼냈다. **조건부로 통째로 사라져야 하는 구획**이
 * 생겼기 때문이다(LLM 사용량은 watcher 가 없으면 헤더까지 안 그려야 한다). 구획을
 * 그리는 쪽이 자기 섹션을 들고 있으면 `return null` 하나로 깔끔하게 없앨 수 있다.
 * HomeDashboard 에서 import 하면 순환이 되므로 별도 파일로 둔다.
 */
const DashboardSection = ({ icon: Icon, title, action = null, children }) => (
  <div style={styles.section}>
    <div style={styles.head}>
      <div style={styles.headLeft}>
        {Icon && <Icon size={12} strokeWidth={2.2} style={{ color: color.subtext, flexShrink: 0 }} />}
        <span style={styles.title}>{title}</span>
      </div>
      {action}
    </div>
    <div>{children}</div>
  </div>
);

const styles = {
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  headLeft: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  title: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.semibold,
    color: color.subtext,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
};

export default DashboardSection;
