import { tokens as designTokens } from '../../styles/tokens';

const { color, font, fontSize } = designTokens;

const BAR_MAX_H = 34;   // 막대가 차지하는 세로. 이보다 크면 타일보다 그래프가 주인공이 된다.
const BAR_MIN_H = 2;    // 0 인 날도 바닥선은 남긴다 — "안 썼다" 와 "없는 날" 은 다르다.

/**
 * 일별 사용 시간 막대.
 *
 * 대시보드 맨 위의 숫자는 "얼마나" 만 말한다. 리듬 — 매일 조금씩인지 하루에 몰아서인지 —
 * 은 막대 몇 개면 충분히 드러나고, 그게 없으면 합계는 그냥 큰 숫자다.
 *
 * 축도 격자도 그리지 않는다. 여기서 읽을 것은 값이 아니라 **모양**이고, 정확한 값은
 * 막대에 호버하면 나온다(title). 눈금을 붙이면 아래 카드들의 차트와 경쟁한다.
 */
export const buildDayBars = (byDay = [], { max = null } = {}) => {
  const rows = Array.isArray(byDay) ? byDay : [];
  const peak = max ?? rows.reduce((m, r) => Math.max(m, Number(r?.seconds) || 0), 0);
  return rows.map((r) => {
    const seconds = Math.max(0, Number(r?.seconds) || 0);
    return {
      day: r?.day || '',
      seconds,
      // 비율은 peak 기준. peak 이 0(전부 쉼)이면 전부 바닥선.
      height: peak > 0 ? Math.max(BAR_MIN_H, Math.round((seconds / peak) * BAR_MAX_H)) : BAR_MIN_H,
      isEmpty: seconds === 0,
    };
  });
};

const DayBars = ({ byDay = [], label, format, t }) => {
  const bars = buildDayBars(byDay);
  if (bars.length === 0) return null;
  const shortDay = (day) => (day || '').slice(5).replace('-', '/');

  return (
    <div style={wrapStyle}>
      <div style={rowStyle}>
        {bars.map((bar) => (
          <div
            key={bar.day}
            style={slotStyle}
            title={`${shortDay(bar.day)} · ${format ? format(bar.seconds) : bar.seconds}`}
          >
            <div
              style={{
                ...barStyle,
                height: `${bar.height}px`,
                /* 안 쓴 날은 색이 아니라 **흔적**만 남긴다. 같은 색으로 낮게 그리면
                   "조금 썼다" 로 읽혀 쉰 날이 사라진다. */
                background: bar.isEmpty
                  ? `color-mix(in srgb, ${color.text} 12%, transparent)`
                  : color.accent,
                opacity: bar.isEmpty ? 1 : 0.85,
              }}
            />
          </div>
        ))}
      </div>
      {label && (
        <div style={footStyle}>
          <span>{shortDay(bars[0].day)}</span>
          <span>{label}</span>
          <span>{t?.('today') || shortDay(bars[bars.length - 1].day)}</span>
        </div>
      )}
    </div>
  );
};

const wrapStyle = { display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 };
const rowStyle = {
  display: 'flex', alignItems: 'flex-end', gap: '2px',
  height: `${BAR_MAX_H}px`,
};
const slotStyle = { flex: 1, minWidth: '2px', display: 'flex', alignItems: 'flex-end' };
const barStyle = { width: '100%', borderRadius: '2px 2px 0 0' };
const footStyle = {
  display: 'flex', justifyContent: 'space-between', gap: '8px',
  fontSize: fontSize['10'], color: color.muted, fontFamily: font.sans,
};

export default DayBars;
