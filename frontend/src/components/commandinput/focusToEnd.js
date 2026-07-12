// textarea 의 caret 을 항상 텍스트 끝으로 — 다시 열 때, 붙여넣기 후, clear 후 등
// 사용자가 이어서 입력하기 좋은 위치에 두기 위함.
const focusToEnd = (ta) => {
  if (!ta) return;
  ta.focus();
  try {
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    // 멀티라인일 때 caret 위치까지 스크롤되게 강제 reflow 트릭
    ta.scrollTop = ta.scrollHeight;
  } catch { /* setSelectionRange 미지원 환경 무시 */ }
};

export default focusToEnd;
