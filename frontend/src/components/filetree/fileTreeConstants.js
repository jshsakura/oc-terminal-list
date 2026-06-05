export const ROW_HEIGHT = 24;
// 100개 미만은 전부 렌더해도 가볍지만, 그 이상은 (특히 모바일) 스크롤이 끊겨
// 임계값을 낮춰 더 일찍 가상화로 전환한다.
export const VIRTUALIZE_AFTER = 80;
export const VIRTUAL_OVERSCAN = 8;
