import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AuthPromptOverlay, TerminalContextMenu, TerminalEdgeGutter } from './TerminalOverlays';

const themeUi = {
  base: '#11111b',
  surface0: '#1e1e2e',
  surface1: '#313244',
  border: '#45475a',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  accent: '#89b4fa',
  warning: '#f9e2af',
  danger: '#f38ba8',
};

const t = (key) => key; // 라벨 = 키 — 어떤 항목이 떴는지로만 판단한다

describe('TerminalEdgeGutter', () => {
  // 분수 셀 잔여를 테마색으로 마감한다. 1px 미만은 눈에 안 보이므로 아예 그리지 않는다.
  it('잔여가 1px 이상일 때만 그린다', () => {
    const { queryByTestId, rerender } = render(<TerminalEdgeGutter right={0.4} bottom={0.4} themeUi={themeUi} />);
    expect(queryByTestId('terminal-edge-gutter-right')).toBeNull();

    rerender(<TerminalEdgeGutter right={3} bottom={0} themeUi={themeUi} />);
    expect(queryByTestId('terminal-edge-gutter-right')).toBeTruthy();
  });

  it('우측과 하단을 독립적으로 그린다', () => {
    const { queryByTestId } = render(<TerminalEdgeGutter right={0} bottom={5} themeUi={themeUi} />);
    expect(queryByTestId('terminal-edge-gutter-right')).toBeNull();
    expect(queryByTestId('terminal-edge-gutter-bottom')).toBeTruthy();
  });
});

/* SSH keyboard-interactive (TOTP/OTP/2FA). 여기가 깨지면 MFA 를 쓰는 호스트에
   아예 못 붙는다 — 그런데 정작 마우스로는 재현이 잘 안 된다. */
describe('AuthPromptOverlay', () => {
  const prompt = {
    name: 'Verification',
    instructions: 'Enter your code',
    prompts: [{ prompt: 'OTP:', echo: false }],
  };

  const renderPrompt = (over = {}) => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const utils = render(
      <AuthPromptOverlay
        prompt={over.prompt || prompt}
        themeUi={themeUi}
        t={t}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
    return { ...utils, onSubmit, onCancel };
  };

  it('제목·안내문·입력칸을 보여준다', () => {
    renderPrompt();
    expect(screen.getByText('Verification')).toBeTruthy();
    expect(screen.getByText('Enter your code')).toBeTruthy();
    expect(screen.getByText('OTP:')).toBeTruthy();
  });

  // echo=false = 화면에 안 보여야 하는 값(비밀번호/OTP). 그대로 노출되면 어깨너머로 새어나간다.
  it('echo=false 는 가려서 입력받고, echo=true 는 그대로 보여준다', () => {
    const { container, rerender } = renderPrompt();
    expect(container.querySelector('input').type).toBe('password');

    rerender(
      <AuthPromptOverlay
        prompt={{ prompts: [{ prompt: 'User:', echo: true }] }}
        themeUi={themeUi}
        t={t}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(container.querySelector('input').type).toBe('text');
  });

  it('입력한 값을 순서대로 모아 제출한다', () => {
    const { container, onSubmit } = renderPrompt({
      prompt: { prompts: [{ prompt: 'A:' }, { prompt: 'B:' }] },
    });
    const [a, b] = container.querySelectorAll('input');

    fireEvent.change(a, { target: { value: '111' } });
    fireEvent.change(b, { target: { value: '222' } });
    fireEvent.submit(container.querySelector('form'));

    expect(onSubmit).toHaveBeenCalledWith(['111', '222']);
  });

  it('취소 버튼과 backdrop 클릭이 모두 취소한다', () => {
    const { container, onCancel } = renderPrompt();

    fireEvent.click(screen.getByText('cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(container.firstChild); // backdrop
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('카드 안을 클릭해도 닫히지 않는다', () => {
    const { container, onCancel } = renderPrompt();
    fireEvent.click(container.querySelector('form'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  // 폰에서 OTP 앱을 오가며 손으로 옮겨치는 건 고역이라 붙여넣기 버튼을 준다.
  it('붙여넣기 버튼이 클립보드 값을 첫 칸에 채운다', async () => {
    Object.assign(navigator, { clipboard: { readText: vi.fn(async () => '  654321  ') } });
    const { container } = renderPrompt();

    await act(async () => { fireEvent.click(screen.getByText('paste')); });

    expect(container.querySelector('input').value).toBe('654321'); // 공백 trim
  });

  it('클립보드 권한이 없어도 터지지 않는다', async () => {
    Object.assign(navigator, { clipboard: { readText: vi.fn(async () => { throw new Error('denied'); }) } });
    const { container } = renderPrompt();

    await act(async () => { fireEvent.click(screen.getByText('paste')); });

    expect(container.querySelector('input').value).toBe('');
  });
});

describe('TerminalContextMenu', () => {
  const baseProps = () => ({
    x: 10,
    y: 10,
    hasSelection: false,
    themeUi,
    t,
    onCopy: vi.fn(),
    onCopyAll: vi.fn(),
    onPaste: vi.fn(),
    onScrollToBottom: vi.fn(),
    onClose: vi.fn(),
  });

  beforeEach(() => {
    // 메뉴는 마운트 후 0ms 타이머로 바깥클릭 리스너를 단다.
    vi.useRealTimers();
  });

  it('선택이 없으면 "복사" 항목을 감춘다', () => {
    render(<TerminalContextMenu {...baseProps()} hasSelection={false} />);
    expect(screen.queryByText('copy')).toBeNull();
    expect(screen.getByText('copyAll')).toBeTruthy();
  });

  it('선택이 있으면 "복사" 항목을 보여준다', () => {
    render(<TerminalContextMenu {...baseProps()} hasSelection={true} />);
    expect(screen.getByText('copy')).toBeTruthy();
  });

  it('선택 항목은 콜백이 있을 때만 나온다 (파일 보내기 / 새로고침)', () => {
    const props = baseProps();
    const { rerender } = render(<TerminalContextMenu {...props} />);
    expect(screen.queryByText('sendFile')).toBeNull();
    expect(screen.queryByText('refresh')).toBeNull();

    rerender(<TerminalContextMenu {...props} onUploadFile={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText('sendFile')).toBeTruthy();
    expect(screen.getByText('refresh')).toBeTruthy();
  });

  it('항목을 누르면 그 액션이 실행된다', () => {
    const props = baseProps();
    render(<TerminalContextMenu {...props} hasSelection={true} />);

    fireEvent.click(screen.getByText('copy'));
    expect(props.onCopy).toHaveBeenCalled();

    fireEvent.click(screen.getByText('scrollToBottom'));
    expect(props.onScrollToBottom).toHaveBeenCalled();
  });

  it('Escape 로 닫는다', async () => {
    const props = baseProps();
    render(<TerminalContextMenu {...props} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); // 리스너 부착 대기

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('바깥을 누르면 닫는다', async () => {
    const props = baseProps();
    render(<TerminalContextMenu {...props} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    fireEvent.mouseDown(document.body);
    expect(props.onClose).toHaveBeenCalled();
  });

  /* 모바일에선 터미널이 touchstart 를 preventDefault 해서 합성 mousedown 이 안 온다 —
     touchstart 도 같이 듣지 않으면 롱프레스로 연 메뉴가 바깥 탭으로 안 닫힌다. */
  it('모바일에서 바깥을 터치해도 닫는다', async () => {
    const props = baseProps();
    render(<TerminalContextMenu {...props} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    fireEvent.touchStart(document.body);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('메뉴 안을 눌러도 닫히지 않는다', async () => {
    const props = baseProps();
    render(<TerminalContextMenu {...props} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    fireEvent.mouseDown(screen.getByText('copyAll'));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('우클릭(button=2)은 닫힘으로 치지 않는다', async () => {
    const props = baseProps();
    render(<TerminalContextMenu {...props} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    fireEvent.mouseDown(document.body, { button: 2 });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  // 화면 오른쪽/아래 끝에서 열면 메뉴가 잘려 나간다 — 안쪽으로 끌어당긴다.
  it('화면 밖으로 넘칠 위치면 안쪽으로 당겨서 띄운다', () => {
    Object.defineProperty(window, 'innerWidth', { value: 400, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 300, writable: true });
    const rect = { width: 160, height: 200 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);

    const { container } = render(<TerminalContextMenu {...baseProps()} x={390} y={290} />);
    const menu = container.firstChild;

    // 오른쪽/아래 끝 - 크기 - 여백(8)
    expect(menu.style.left).toBe('232px'); // 400 - 160 - 8
    expect(menu.style.top).toBe('92px');   // 300 - 200 - 8
    vi.restoreAllMocks();
  });
});
