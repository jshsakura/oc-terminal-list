import { Trash2 } from 'lucide-react';
import { tokens } from '../../styles/tokens';

const { color, fontSize, fontWeight } = tokens;

/** 남은 보관 기간을 사람이 읽는 단위로. 보관이 1년이라 "364일 후 정리" 는 눈금이 너무 잘다 —
 *  숫자가 커질수록 정밀도는 쓸모없어지고 읽는 품만 든다. 한 달 안쪽만 일 단위로 센다. */
export const retentionNote = (daysLeft, t) => {
  if (!(daysLeft > 0)) return t?.('llmRetiredExpiring') || '곧 정리됨';
  if (daysLeft <= 30) {
    return (t?.('llmRetiredDaysLeft') || '{n}일 후 정리').replace('{n}', daysLeft);
  }
  const months = Math.round(daysLeft / 30);
  return (t?.('llmRetiredMonthsLeft') || '약 {n}개월 후 정리').replace('{n}', months);
};

/**
 * 호스트 목록에서 빠졌지만 사용량은 남아 있는 소스들.
 *
 * 호스트를 지웠다고 지난달 비용까지 즉시 증발하면 되돌릴 방법이 없다. 그래서 서버는
 * 보관 기간 동안 데이터를 들고 있고, 여기서 **남은 일수를 밝히고** 기다리기 싫으면
 * 바로 지울 수 있게 한다. 유령이 조용히 쌓이던 예전 동작의 대체물이다.
 *
 * 살아 있는 호스트는 여기 오지 않는다 — 그건 위 막대 차트가 이미 말하고 있다.
 */
const RetiredSources = ({ rows = [], onDelete, t }) => {
  if (!rows.length) return null;
  return (
    <div style={styles.wrap}>
      <div style={styles.head}>{t?.('llmRetiredTitle') || 'Removed hosts'}</div>
      {rows.map((row) => (
        <div key={row.source_id} style={styles.row}>
          <span style={styles.name} title={row.name}>{row.name}</span>
          <span style={styles.note}>{retentionNote(row.retired_days_left, t)}</span>
          <button
            type="button"
            style={styles.btn}
            title={t?.('llmRetiredDeleteNow') || 'Delete usage data now'}
            onClick={() => onDelete?.(row)}
            onMouseEnter={(e) => { e.currentTarget.style.color = color.danger; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = color.subtext; }}
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
};

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' },
  head: {
    fontSize: fontSize['11'],
    fontWeight: fontWeight.medium,
    color: color.subtext,
    marginBottom: '2px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: fontSize['12'],
    color: color.text,
  },
  name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  note: { fontSize: fontSize['11'], color: color.subtext, flexShrink: 0 },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    flexShrink: 0,
    padding: 0,
    background: 'none',
    border: 'none',
    borderRadius: '4px',
    color: color.subtext,
    cursor: 'pointer',
    transition: 'color 120ms',
  },
};

export default RetiredSources;
