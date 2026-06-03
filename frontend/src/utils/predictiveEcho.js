/**
 * Predictive local echo (mosh 식) — 키 입력을 서버 RTT 를 기다리지 않고 즉시 화면에
 * "유령(ghost) 글자" 로 먼저 그려 체감 latency 를 0 에 가깝게 만든다.
 *
 * 안전 원칙 (잘못된 예측은 "허접" 이므로 보수적으로):
 *  - xterm 버퍼는 절대 건드리지 않는다. 예측은 .xterm-screen 위 오버레이로만 그린다
 *    → 틀려도 버퍼 오염/글자 중복 없음. 서버 출력이 항상 진실(authoritative).
 *  - 일반 버퍼(normal)에서만. alt-screen(vim/less/htop/tmux copy-mode 등)은 자동 제외.
 *  - 인쇄 가능한 단일 문자 타이핑만 예측. Enter/방향키/제어문자/백스페이스는 예측 취소.
 *  - 비밀번호 안전: (1) 커서가 있는 줄이 password/passphrase 류면 예측 안 함,
 *    (2) 타이핑해도 에코로 커서가 안 움직이면(no-echo) 짧은 타임아웃 뒤 지우고 쿨다운,
 *    (3) 에코된 실제 글자가 예측과 다르면(예: '*' 마스킹) 즉시 지우고 쿨다운.
 *  - 커서가 줄을 넘어가거나(wrap/scroll) 뒤로 가는 등 모델이 깨지면 즉시 전부 정리.
 */

// 킬 스위치 — 브라우저 크래시 조사 중 강제 비활성(저장된 설정과 무관하게 OFF). 원인 규명 후 해제.
const KILL_SWITCH = true;

const PRINTABLE_RE = /^[\x20-\x7e]$/; // ASCII 인쇄 가능 (보수적 v1; 추후 유니코드 확장 가능)
const PASSWORD_LINE_RE = /(password|passphrase|secret|pin|비밀번호|암호)\s*[:：]?\s*$/i;
// no-echo 판정 타임아웃 — RTT 보다 길어야 정상 프롬프트 오탐이 안 난다. 이 안에 에코로
// 커서가 안 움직이면 echo-off(비번 등)로 보고 정리.
const NO_ECHO_TIMEOUT_MS = 500;
// echo-off/마스킹 감지 후 이 시간 동안 예측 중단.
const COOLDOWN_MS = 4000;

export class PredictiveEcho {
  constructor(term) {
    this.term = term;
    this.enabled = false;
    this.predicted = '';      // 아직 서버 에코로 확정 안 된, 로컬에서 친 문자열
    this.startCol = 0;        // 예측 시작 절대 컬럼
    this.startRow = 0;        // 예측 시작 절대 행 (baseY + cursorY)
    this.cooldownUntil = 0;
    this.timer = null;
    this.cellW = 0;
    this.cellH = 0;
    this.ghostColor = 'rgba(255,255,255,0.38)';
    this.el = null;
    this._mount();
  }

  _mount() {
    const screen = this.term?.element?.querySelector('.xterm-screen');
    if (!screen) return;
    const el = document.createElement('span');
    el.setAttribute('aria-hidden', 'true');
    // z-index 높게 — WebGL 캔버스가 .xterm-screen 에 나중에 붙어도 그 위에 그려지게.
    el.style.cssText = [
      'position:absolute', 'pointer-events:none', 'white-space:pre',
      'z-index:10', 'top:0', 'left:0', 'display:none',
      'will-change:transform,opacity', 'opacity:0.85',
    ].join(';');
    // 폰트는 .xterm-screen 에서 상속 — 글자 폭이 정확히 일치하게.
    el.style.font = 'inherit';
    screen.appendChild(el);
    this.el = el;
    this._screen = screen;
  }

  setEnabled(on) {
    this.enabled = KILL_SWITCH ? false : !!on;
    if (!this.enabled) this.clear();
  }

  setGhostColor(color) {
    if (color) this.ghostColor = color;
    if (this.el) this.el.style.color = this.ghostColor;
  }

  /** 폰트/리사이즈 변경 시 셀 크기 캐시 무효화. */
  refreshMetrics() {
    this.cellW = 0;
    this.cellH = 0;
    this.clear();
  }

  _metrics() {
    if (this.cellW && this.cellH) return true;
    const screen = this._screen || this.term?.element?.querySelector('.xterm-screen');
    if (!screen) return false;
    const cols = this.term.cols || 80;
    const rows = this.term.rows || 24;
    const w = screen.clientWidth / cols;
    const h = screen.clientHeight / rows;
    if (!w || !h || !isFinite(w) || !isFinite(h)) return false;
    this.cellW = w;
    this.cellH = h;
    if (this.el) {
      this.el.style.font = getComputedStyle(screen).font;
      this.el.style.color = this.ghostColor;
    }
    return true;
  }

  _buf() {
    try { return this.term.buffer.active; } catch { return null; }
  }

  _isNormalBuffer() {
    const b = this._buf();
    return !!b && b.type === 'normal';
  }

  _cursorLineText() {
    const b = this._buf();
    if (!b) return '';
    try {
      const line = b.getLine(b.baseY + b.cursorY);
      return line ? line.translateToString(true) : '';
    } catch { return ''; }
  }

  _cellChars(row, col) {
    const b = this._buf();
    if (!b) return '';
    try {
      const line = b.getLine(row);
      const cell = line && line.getCell(col);
      return cell ? cell.getChars() : '';
    } catch { return ''; }
  }

  /** 사용자가 친 데이터. 인쇄 가능 단일 문자만 예측, 그 외는 진실로 리셋. */
  onInput(data) {
    if (!this.enabled) return;
    if (typeof data !== 'string' || !PRINTABLE_RE.test(data)) {
      // Enter/방향키/제어/백스페이스/붙여넣기 등 — 예측 모델이 깨지니 정리.
      this.clear();
      return;
    }
    if (Date.now() < this.cooldownUntil) return;
    if (!this._isNormalBuffer()) { this.clear(); return; }
    if (!this._metrics()) return;

    const b = this._buf();
    if (this.predicted === '') {
      // 예측 런 시작 — 비번 프롬프트면 시작 안 함.
      if (PASSWORD_LINE_RE.test(this._cursorLineText())) { this.cooldownUntil = Date.now() + COOLDOWN_MS; return; }
      // 오른쪽 끝 근처면 wrap 복잡 → 예측 안 함.
      if (b.cursorX >= (this.term.cols - 1)) return;
      this.startCol = b.cursorX;
      this.startRow = b.baseY + b.cursorY;
    }
    // 같은 줄에서만 누적 — 줄 바뀌었으면 새 런으로.
    if (b.baseY + b.cursorY !== this.startRow) { this.clear(); return; }
    if (this.startCol + this.predicted.length >= this.term.cols - 1) return; // 줄 끝 보호
    this.predicted += data;
    this._render();
    this._armTimer();
  }

  /** 서버 출력이 xterm 에 반영된 직후 호출 — 에코로 확정된 만큼 유령을 줄인다. */
  onServerOutput() {
    if (!this.enabled || this.predicted === '') return;
    if (!this._isNormalBuffer()) { this.clear(); return; }
    const b = this._buf();
    const curRow = b.baseY + b.cursorY;
    if (curRow !== this.startRow) { this.clear(); return; } // 줄 바뀜/스크롤 → 정리
    const echoed = b.cursorX - this.startCol;
    if (echoed < 0) { this.clear(); return; }               // 커서 후진 → 정리
    if (echoed === 0) return;                                 // 아직 에코 전 — 유령 유지

    // 에코된 실제 글자가 예측과 일치하는지 검사 — 다르면(마스킹 '*' 등) 비번류로 보고 중단.
    const n = Math.min(echoed, this.predicted.length);
    for (let i = 0; i < n; i++) {
      const real = this._cellChars(this.startRow, this.startCol + i);
      if (real !== this.predicted[i]) {
        this.clear();
        this.cooldownUntil = Date.now() + COOLDOWN_MS;
        return;
      }
    }
    if (echoed >= this.predicted.length) { this.clear(); return; } // 전부 확정
    // 부분 확정 — 앵커를 전진시키고 남은 유령만 다시 그린다.
    this.startCol += echoed;
    this.predicted = this.predicted.slice(echoed);
    this._render();
    this._armTimer();
  }

  _armTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      // 타임아웃까지 에코 없음 = echo-off(비번 등) 또는 멈춤 → 정리 + 쿨다운.
      if (this.predicted !== '') {
        this.cooldownUntil = Date.now() + COOLDOWN_MS;
        this.clear();
      }
    }, NO_ECHO_TIMEOUT_MS);
  }

  _render() {
    if (!this.el) return;
    if (this.predicted === '' || !this._metrics()) { this.el.style.display = 'none'; return; }
    const b = this._buf();
    const screenRow = this.startRow - b.baseY; // 뷰포트 기준 행
    if (screenRow < 0 || screenRow >= this.term.rows) { this.el.style.display = 'none'; return; }
    const x = Math.round(this.startCol * this.cellW);
    const y = Math.round(screenRow * this.cellH);
    this.el.textContent = this.predicted;
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    this.el.style.lineHeight = `${this.cellH}px`;
    this.el.style.height = `${this.cellH}px`;
    this.el.style.color = this.ghostColor;
    this.el.style.display = 'block';
  }

  clear() {
    this.predicted = '';
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.el) this.el.style.display = 'none';
  }

  dispose() {
    this.clear();
    try { this.el?.remove(); } catch { /* noop */ }
    this.el = null;
    this._screen = null;
    this.term = null;
  }
}
