import { tokens as designTokens } from '../../styles/tokens';
import SkeletonRow from '../common/SkeletonRow';
import { dashboardCardStyle } from '../../styles/dashboardCard';
import { segmentedTrackStyle } from '../../styles/segmented';

const { color, space } = designTokens;

/**
 * 대시보드 로딩 자리.
 *
 * 스켈레톤은 **완성된 화면과 같은 자리에 같은 크기로** 서야 한다. 대충 회색 상자를 뿌리면
 * 값이 들어오는 순간 레이아웃이 튀어 오히려 로딩보다 산만하다 — 타일 3개, 그래프 한 장,
 * 막대 카드 한 장이라는 최종 구조를 그대로 흉내낸다.
 *
 * 기간 스위치까지 포함한다. 머리만 완성된 채 아래가 비어 있으면 화면이 반쯤 그려진 것처럼
 * 보인다 — 로딩은 한 덩어리여야 한다.
 */
/* 펄스는 `common/SkeletonRow` 것을 쓴다 — 클래스 기반 애니메이션을 여기서 또 정의하면
   그 클래스를 심는 컴포넌트가 화면에 없을 때 조용히 멈춘 회색 상자가 된다(실제로
   `dc-skel` 이 DashboardCards 안에서만 주입돼 그럴 뻔했다). */
const Bar = ({ w = '60%', h = '10px', r = '4px', style = null }) => (
  <SkeletonRow width={w} height={h} borderRadius={r} style={style} />
);

/** 기간 스위치 자리 — 트랙은 진짜와 같은 것을 쓰고 안의 칸만 회색이다. */
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

/** 타일 한 줄 — 개수만 다르다(터미널 3개 / LLM 4개). */
export const TileRowSkeleton = ({ count = 3 }) => (
  <div style={tilesStyle}>
    {Array.from({ length: count }, (_, i) => <TileSkeleton key={i} />)}
  </div>
);

/** 그래프 카드 한 장 — 실제 카드와 같은 높이라 값이 들어와도 자리가 안 밀린다. */
export const ChartCardSkeleton = () => (
  <div style={{ ...dashboardCardStyle({ padding: '12px' }), display: 'flex', flexDirection: 'column', gap: '10px' }}>
    <Bar w="24%" h="10px" />
    <Bar w="100%" h="150px" r="6px" />
  </div>
);

/** 막대 카드 한 장 — 이름/트랙/값 세 칸의 리듬까지 같게. */
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
