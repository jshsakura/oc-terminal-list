import { tokens as designTokens } from '../../styles/tokens';
import SkeletonRow from '../common/SkeletonRow';
import { dashboardCardStyle } from '../../styles/dashboardCard';
import { segmentedTrackStyle } from '../../styles/segmented';

const { space } = designTokens;

/**
 * The dashboard's loading placeholder.
 *
 * A skeleton has to stand **in the same place at the same size** as the finished screen.
 * Scattering grey boxes makes the layout jump the moment values arrive, which is more
 * distracting than the wait — so this mirrors the final structure: three tiles, one
 * chart, one bar card.
 *
 * The range switch is part of it. A finished head above an empty body reads as a
 * half-drawn page; loading has to be one piece.
 */

/* The pulse comes from `common/SkeletonRow`. Defining another class-based animation here
   would mean the boxes freeze whenever the component that injects that class is not on
   screen (`dc-skel` was one injection away from exactly that). */
const Bar = ({ w = '60%', h = '10px', r = '4px', style = null }) => (
  <SkeletonRow width={w} height={h} borderRadius={r} style={style} />
);

/** The range switch slot — a real track with grey slots inside. */
export const RangeSkeleton = () => (
  <div style={segmentedTrackStyle()} aria-busy="true">
    {['46px', '52px', '52px', '46px'].map((w) => (
      <Bar key={w} w={w} h="26px" r="7px" style={{ margin: '0 1px' }} />
    ))}
  </div>
);

export const TileSkeleton = () => (
  <div style={{ ...dashboardCardStyle(), display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <Bar w="42%" h="9px" />
    <Bar w="66%" h="22px" r="5px" />
    <Bar w="54%" h="8px" />
  </div>
);

/** One row of tiles — only the count differs (3 for terminal usage, 4 for LLM). */
export const TileRowSkeleton = ({ count = 3 }) => (
  <div style={tilesStyle}>
    {Array.from({ length: count }, (_, i) => <TileSkeleton key={i} />)}
  </div>
);

/** One chart card — same height as the real one, so nothing shifts when data lands. */
export const ChartCardSkeleton = () => (
  <div style={{ ...dashboardCardStyle({ padding: '12px' }), display: 'flex', flexDirection: 'column', gap: '10px' }}>
    <Bar w="24%" h="10px" />
    <Bar w="100%" h="150px" r="6px" />
  </div>
);

/** One bar card — down to the name/track/value rhythm of the real rows. */
export const BarsCardSkeleton = ({ rows = 3 }) => (
  <div style={{ ...dashboardCardStyle({ padding: '12px' }), display: 'flex', flexDirection: 'column', gap: '9px' }}>
    <Bar w="20%" h="10px" />
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} style={rowStyle}>
        <Bar w="70%" h="9px" />
        <Bar w="100%" h="6px" r="3px" />
        <Bar w="38px" h="9px" />
      </div>
    ))}
  </div>
);

const DashboardSkeleton = () => (
  <div style={rootStyle} aria-busy="true">
    <TileRowSkeleton count={3} />
    <ChartCardSkeleton />
    <BarsCardSkeleton />
  </div>
);

const rootStyle = { display: 'flex', flexDirection: 'column', gap: space['3'] };
const tilesStyle = {
  display: 'grid', gap: space['3'],
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
};
const rowStyle = {
  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 2fr auto',
  alignItems: 'center', gap: '8px',
};

export default DashboardSkeleton;
