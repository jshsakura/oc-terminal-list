import { useState } from 'react';
import { columnCount } from '../../utils/delimitedTable';

/**
 * Table view for spreadsheets and CSV/TSV.
 *
 * The first row is treated as the header — that is what a spreadsheet almost always is,
 * and a wrong guess costs one shifted row, not a broken screen. Everything scrolls in
 * **one** container so the sticky header stays put and the page itself never scrolls
 * sideways.
 */
const DataTable = ({ sheets = [], theme, truncatedLabel = null, emptyLabel = '—' }) => {
  const [active, setActive] = useState(0);
  const sheet = sheets[Math.min(active, Math.max(sheets.length - 1, 0))] || { rows: [] };
  const rows = sheet.rows || [];
  const columns = columnCount(rows);
  const [head, ...body] = rows;

  const border = theme.ui.borderLight || theme.ui.border;
  const cellStyle = {
    border: `1px solid ${border}`,
    padding: '4px 8px',
    fontSize: '12px',
    whiteSpace: 'pre',
    maxWidth: '360px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.ui.bg }}>
      {sheets.length > 1 && (
        <div style={{
          display: 'flex', gap: '4px', padding: '4px 8px', flexShrink: 0,
          borderBottom: `1px solid ${border}`, overflowX: 'auto',
        }}>
          {sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              onClick={() => setActive(i)}
              style={{
                border: `1px solid ${i === active ? theme.ui.accent : border}`,
                background: i === active ? `color-mix(in srgb, ${theme.ui.accent} 18%, transparent)` : 'transparent',
                color: i === active ? theme.ui.text : theme.ui.textSecondary,
                borderRadius: '4px', padding: '2px 8px', fontSize: '11px',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {s.name || `Sheet ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ padding: '16px', fontSize: '12px', color: theme.ui.textSecondary }}>{emptyLabel}</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', color: theme.ui.text, fontFamily: 'inherit' }}>
            <thead>
              <tr>
                <th style={{ ...cellStyle, position: 'sticky', top: 0, left: 0, zIndex: 2, background: theme.ui.bgSecondary || theme.ui.bg }} />
                {Array.from({ length: columns }, (_, c) => (
                  <th
                    key={c}
                    style={{
                      ...cellStyle,
                      position: 'sticky', top: 0, zIndex: 1,
                      background: theme.ui.bgSecondary || theme.ui.bg,
                      textAlign: 'left', fontWeight: 600,
                    }}
                  >
                    {head?.[c] ?? ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {/* 행 번호는 헤더를 1행으로 세는 스프레드시트 번호와 맞춘다. */}
                  <td style={{
                    ...cellStyle,
                    position: 'sticky', left: 0,
                    background: theme.ui.bgSecondary || theme.ui.bg,
                    color: theme.ui.textSecondary,
                    textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  }}>
                    {r + 2}
                  </td>
                  {Array.from({ length: columns }, (_, c) => (
                    <td key={c} style={cellStyle}>{row?.[c] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sheet.truncated && truncatedLabel && (
        <div style={{
          flexShrink: 0, padding: '4px 10px', fontSize: '11px',
          color: theme.ui.textSecondary, borderTop: `1px solid ${border}`,
        }}>
          {truncatedLabel}
        </div>
      )}
    </div>
  );
};

export default DataTable;
