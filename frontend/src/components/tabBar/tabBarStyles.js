import { tokens } from '../../styles/tokens';

const { color, font, fontSize, fontWeight, radius, motion } = tokens;

export const styles = {
  bar: {
    display: 'flex',
    alignItems: 'stretch',
    height: '34px',
    // 크롬이 콘텐츠 위로 뜨는 모델(themeUI 다크 분기 참고)이라 바는 단색 crust 로 둔다.
    // mantle→crust 그라데이션은 crust 가 더 어둡던 시절의 잔재 — 뒤집힌 지금은 아래로
    // 갈수록 밝아져 바가 붕 떠 보인다.
    background: `var(--ui-crust, ${color.crust})`,
    // 바닥 실선 없음 — 크롬(crust)과 콘텐츠(base)의 면 차이가 경계를 대신한다.
    // 덤으로 바 총높이가 35 → 34 가 되어 우측 레일 첫 아이콘(32+2)과 정확히 맞는다.
    fontFamily: font.sans,
    overflow: 'hidden',
    flexShrink: 0,
    // 화면 양끝에 너무 붙지 않도록 좌우에 미세한 breathing room 을 둔다.
    padding: '0 3px 0 4px',
    gap: '0',
  },
  barMobile: {
    /* 모바일도 데스크탑 탭바처럼 유지한다. 탭을 억지로 압축/드래그하지 않고
       중앙 탭 스트립만 자연스럽게 좌우 스크롤한다. */
    height: '34px',
    padding: '0 3px 0 4px',
    gap: '0',
  },
  // 히트 영역(바깥) — 바 높이를 꽉 채우고, 위아래 3px 패딩이 칩을 안쪽으로 밀어넣는다.
  tabHit: {
    display: 'flex',
    alignItems: 'stretch',
    height: '100%',
    /* 위아래 5px — 칩에 면이 생기니 3px 로는 바 위아래에 거의 붙어 보였다.
       바깥(히트)은 바 높이를 그대로 채우고 안쪽 칩만 얇다(§15). */
    padding: '5px 0',
    boxSizing: 'border-box',
    minWidth: '46px',
    maxWidth: '168px',
    /* 균일 고정 폭(144px 기준, 넘칠 때만 축소). 세 조합 중 이것만 셋 다 만족한다:
         - 1 1 auto (늘림)    → 탭이 가로를 항상 꽉 채워 바가 빈틈없는 덩어리가 된다
         - 0 1 auto (내용맞춤) → 활성 탭에만 뜨는 ⋯ 버튼 때문에 선택할 때마다 폭이 17px 요동
         - 0 1 144px (균일)   → 남는 자리는 비고, 버튼이 뜨든 말든 폭은 그대로 */
    /* 156 = 숫자타일16 + 아이콘16 + ⋯17 + 패딩18 + 갭21 = 88 고정 + 라벨 68px.
       144 에선 활성 탭("⋯" 가 뜨는 쪽)만 라벨이 잘렸다. */
    flex: '0 1 156px',
    position: 'relative',
    userSelect: 'none',
  },
  tabHitMobile: {
    /* 150px 은 폰에서 과하게 넓었다. 132 까지 줄여봤더니 "workspace" 가 잘려서 140 —
       번호10+타일14+더보기17+패딩18+갭15 = 74px 이 고정이라 라벨에 66px 이 남는 지점. */
    minWidth: '116px',
    maxWidth: '160px',
    flex: '0 0 140px',
  },
  tabMobile: {
    fontSize: fontSize['12'],
    paddingLeft: '5px',
    paddingRight: '5px',
    gap: '5px',
    borderRadius: radius.sm,
    // 안전망 — 호스트 아이콘 스택 등 고정폭 요소가 좁은 탭 폭을 넘으면 이웃 탭으로
    // 삐져나가는 대신 여기서 잘리게.
    overflow: 'hidden',
  },
  miniBtnMobile: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
  },
  brandBtn: {
    /* 데스크탑 — 슬림한 24px 정사각, 좌우 마진 최소. */
    width: '24px',
    height: '24px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: color.accent,
    cursor: 'pointer',
    transition: 'background 150ms',
    padding: 0,
    borderRadius: '3px',
    margin: '5px 7px 0 0',
  },
  brandBtnMobile: {
    width: '24px',
    height: '24px',
    margin: '5px 7px 0 0',
    borderRadius: '3px',
  },
  /* 탭바는 **크롬**이다 — 콘텐츠를 담는 컨트롤이 아니라 창틀이다. 스트립을 움푹한 트랙으로
     파봤더니 탭이 없는 오른쪽까지 홈이 파여 창틀 한가운데 웬 컨트롤이 박힌 꼴이 됐다.
     세그먼트 트랙은 홈의 터미널/대시보드·기간 스위치처럼 **선택지가 유한한 컨트롤**의
     언어다(`styles/segmented.js`). 여기서는 칩만 얹는다.
     간격은 그룹 경계에서만 준다(같은 호스트 탭끼리는 붙는다) — tabHitGroupStart. */
  tabList: {
    display: 'flex',
    alignItems: 'stretch',
    gap: '0',
    overflowX: 'auto',
    overflowY: 'hidden',
    flex: '1 1 auto',
    paddingTop: '0',
    paddingBottom: '0',
    paddingRight: '0',
    boxSizing: 'border-box',
    scrollbarWidth: 'none',           // Firefox
    msOverflowStyle: 'none',           // IE/Edge legacy
  },
  tabListMobile: {
    gap: '0',
    flex: '1 1 auto',
    paddingTop: '0',
    paddingBottom: '0',
    WebkitOverflowScrolling: 'touch',
  },
  // 보이는 칩(안쪽) — 상자 보더 없이 면과 모서리로만 존재한다.
  // 히트 영역(tabHit)이 바 높이를 채우므로 칩은 28px 로 얇아져도 누르기 어렵지 않다.
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    /* 좌우 = 상하(tabHit 의 5px) 와 같은 값. 칩 안쪽 여백이 사방 균일해진다. */
    padding: '0 5px',
    flex: 1,
    /* 탭 많을 때 인디케이터를 다 보이게 — 이름은 tabName 의 ellipsis 가 처리.
       너무 좁아지면 결국 아이콘 타일 + 점 정도만 남아도 OK. */
    minWidth: 0,
    cursor: 'pointer',
    transition: `background ${motion.fast}, color ${motion.fast}, box-shadow ${motion.fast}`,
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    border: 'none',
    borderRadius: radius.sm,
    boxSizing: 'border-box',
  },
  // 탭 스트립 양 끝의 짧은 세로 rule — 홈 버튼 쪽과 액션 그룹 쪽에 대칭으로 들어간다.
  railDivider: {
    width: '1px',
    height: '16px',
    alignSelf: 'center',
    flexShrink: 0,
    margin: '0 5px',
    background: 'var(--ui-border-strong)',
  },
  /* 호스트가 바뀌는 자리에만 **틈**. 같은 기계의 탭들은 붙어서 한 덩어리로 읽힌다.
     선은 긋지 않는다 — 탭 사이사이 세로선이 서면 그게 곧 소음이고, 어차피 경계는 칩의
     면이 이미 만든다. 틈 하나면 충분하다. */
  tabHitGroupStart: {
    marginLeft: '10px',
  },
  tabName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    letterSpacing: '0.005em',
  },
  miniBtn: {
    width: '17px',
    height: '17px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
    color: 'inherit',
    padding: 0,
    transition: 'background 150ms, color 150ms, opacity 150ms',
  },
};
