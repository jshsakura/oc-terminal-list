import { tokens } from '../../styles/tokens';

const { color, font, fontSize, fontWeight } = tokens;

export const styles = {
  bar: {
    display: 'flex',
    alignItems: 'stretch',
    height: '34px',
    background: `linear-gradient(180deg, var(--ui-mantle, ${color.crust}), var(--ui-crust, ${color.crust}))`,
    borderBottom: '1px solid var(--ui-border)',
    fontFamily: font.sans,
    overflow: 'hidden',
    flexShrink: 0,
    // 화면 양끝에 너무 붙지 않도록 좌우에 미세한 breathing room 을 둔다.
    padding: '0 4px 0 6px',
    gap: '0',
  },
  barMobile: {
    /* 모바일도 데스크탑 탭바처럼 유지한다. 탭을 억지로 압축/드래그하지 않고
       중앙 탭 스트립만 자연스럽게 좌우 스크롤한다. */
    height: '34px',
    padding: '0 4px 0 6px',
    gap: '0',
  },
  tabMobile: {
    height: 'calc(100% + 1px)',
    minWidth: '128px',
    maxWidth: '190px',
    flex: '0 0 150px',
    fontSize: fontSize['12'],
    paddingLeft: '10px',
    paddingRight: '8px',
    gap: '5px',
    borderRadius: 0,
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
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: '0 8px 0 10px',
    height: 'calc(100% + 1px)',
    /* 탭 많을 때 인디케이터를 다 보이게 — flex-shrink 1 + 작은 minWidth 로 자동 압축.
       이름은 tabName 의 ellipsis 가 처리. 너무 좁아지면 결국 아이콘 타일 + 점 정도만 남아도 OK. */
    minWidth: '46px',
    maxWidth: '200px',
    cursor: 'pointer',
    transition: 'background 150ms, color 150ms',
    userSelect: 'none',
    flex: '1 1 auto',
    fontSize: fontSize['12'],
    fontWeight: fontWeight.medium,
    borderRadius: 0,
    boxSizing: 'border-box',
    marginLeft: '-1px',
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
  actionGroup: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    // 우측 TerminalHeader.activityBar (36px, border-box, borderLeft 포함) 와 borderLeft 가
    // 같은 x 에 오게 — box-sizing: border-box + 명시 width.
    // 데스크탑 (split×2 + settings = 3 버튼) 은 더 넓게, 모바일 (settings 1) 은 36 고정.
    boxSizing: 'border-box',
    paddingLeft: '2px',
    paddingRight: '2px',
    borderLeft: `1px solid ${color.border}`,
    flexShrink: 0,
  },
  actionGroupMobile: {
    width: '36px',         // 우측 rail 폭과 동일 → borderLeft 같은 x
    paddingLeft: '1px',    // border 1 + padL 1 + button 32 + padR 2 = 36
  },
  closeGroup: {
    display: 'flex',
    alignItems: 'center',
    paddingLeft: '4px',
    paddingRight: '4px',
    flexShrink: 0,
  },
};
