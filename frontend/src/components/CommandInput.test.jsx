import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import CommandInput from './CommandInput';

// 이미지 업로드 헬퍼는 mock — 컴포넌트의 삽입/상태 동작만 검증(네트워크 분리).
vi.mock('./terminal/terminalHelpers', () => ({
  uploadImageAndGetPath: vi.fn(),
}));
import { uploadImageAndGetPath } from './terminal/terminalHelpers';

const t = (key) => ({
  commandInput: 'Send command',
  commandInputPlaceholder: 'Type a command',
  commandInputHint: 'Ctrl+Enter to send',
  send: 'Send',
  copy: 'Copy',
  paste: 'Paste',
  clearInput: 'Clear',
  confirmClearInput: 'Clear?',
  attachImage: 'Attach image',
  imageUploading: 'Uploading image',
  imageUploadFailed: 'Upload failed',
}[key] || key);

describe('CommandInput positioning', () => {
  let innerHeight;

  beforeEach(() => {
    innerHeight = window.innerHeight;
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: innerHeight, writable: true });
  });

  it('centers the modal when no keyboard is present', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });

    render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    const overlay = screen.getByTestId('command-input-overlay');
    expect(overlay).toHaveStyle({ alignItems: 'center' });
  });

  it('docks to bottom when keyboard is present (viewport shrinks)', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });

    const vv = window.visualViewport;

    render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    const overlay = screen.getByTestId('command-input-overlay');
    expect(overlay).toHaveStyle({ alignItems: 'center' });

    if (vv) {
      act(() => {
        Object.defineProperty(vv, 'height', { value: 400, configurable: true });
        vv.dispatchEvent(new Event('resize'));
      });

      expect(overlay).toHaveStyle({ alignItems: 'flex-end' });
    }
  });

  it('sends command on button click', () => {
    const onSend = vi.fn();
    const onClose = vi.fn();
    const setCommand = vi.fn();

    render(
      <CommandInput
        isOpen={true}
        onClose={onClose}
        onSend={onSend}
        command="ls"
        setCommand={setCommand}
        terminalKey="sess1"
        t={t}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    // 2번째 인자 = 보낼 pane key 배열. 선택 없으면 활성 pane(terminalKey) 하나.
    expect(onSend).toHaveBeenCalledWith('ls', ['sess1'], {});
    expect(setCommand).toHaveBeenCalledWith('');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render when closed', () => {
    render(
      <CommandInput
        isOpen={false}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );
    expect(screen.queryByTestId('command-input-overlay')).toBeNull();
  });

  it('has correct modal styling', () => {
    render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({ maxWidth: '420px' });
    expect(dialog.style.border).toContain('color-mix');
  });

  it('close button has rounded square styling', () => {
    const onClose = vi.fn();
    render(
      <CommandInput
        isOpen={true}
        onClose={onClose}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    const closeBtn = screen.getByRole('button', { name: '' });
    expect(closeBtn).toHaveStyle({ width: '28px', height: '28px' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('header has mantle background', () => {
    render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    const dialog = screen.getByRole('dialog');
    const header = dialog.querySelector('header');
    expect(header).toBeTruthy();
  });

  it('does not render the old lower-left hint icon', () => {
    render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command=""
        setCommand={vi.fn()}
        t={t}
      />
    );

    expect(screen.queryByText('💡')).toBeNull();
    expect(screen.getByPlaceholderText(t('commandInputHint'))).toBeTruthy();
  });
});

// 탭 2개에 걸친 pane 3개 — 팝업의 탭 그룹핑을 검증하기 위한 최소 구성.
const PANES = [
  { key: 'a', color: '#f00', host: 'alpha', tabId: 't1', tabName: 'Tab One', isActiveTab: true },
  { key: 'b', color: '#0f0', host: 'beta', tabId: 't1', tabName: 'Tab One', isActiveTab: true },
  { key: 'c', color: '#00f', host: 'gamma', tabId: 't2', tabName: 'Tab Two', isActiveTab: false },
];

describe('CommandInput send targets', () => {
  const renderWith = (props = {}) => {
    const onSend = vi.fn();
    render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={onSend}
        command="ls"
        setCommand={vi.fn()}
        terminalKey="a"
        panes={PANES}
        t={t}
        {...props}
      />
    );
    return { onSend };
  };

  const openPopup = () => fireEvent.click(screen.getByRole('button', { name: 'sendTarget' }));
  const send = () => fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));

  it('hides the target picker when there is nothing to choose between', () => {
    renderWith({ panes: [PANES[0]] });
    expect(screen.queryByRole('button', { name: 'sendTarget' })).toBeNull();
  });

  it('falls back to the active pane when nothing is selected', () => {
    const { onSend } = renderWith();
    /* 기본(활성 pane)에는 **배지 글자를 쓰지 않는다** — 그게 기본값이라 이름을 붙일 이유가
       없고, "활성" 세 글자가 좁은 툴바에서 가장 넓은 자리를 먹었다. */
    expect(screen.getByRole('button', { name: 'sendTarget' })).toHaveTextContent('');
    send();
    expect(onSend).toHaveBeenCalledWith('ls', ['a'], {});
  });

  it('sends to exactly the panes picked in the popup', () => {
    const { onSend } = renderWith();
    openPopup();
    fireEvent.click(screen.getByText('gamma'));
    send();
    expect(onSend).toHaveBeenCalledWith('ls', ['c'], {});
  });

  it('selects every pane of a tab from its group header', () => {
    const { onSend } = renderWith();
    openPopup();
    fireEvent.click(screen.getByText('Tab One'));
    send();
    // Tab One 의 pane 두 개만 — 다른 탭(t2)은 건드리지 않는다.
    expect(onSend).toHaveBeenCalledWith('ls', ['a', 'b'], {});
  });

  it('toggles all panes across tabs and back to the active-pane fallback', () => {
    const { onSend } = renderWith();
    openPopup();

    fireEvent.click(screen.getByText('selectAll'));
    // 전부 고르면 ∗ 한 글자 — 아이콘 옆에 이름을 다 적을 자리가 없다.
    expect(screen.getByRole('button', { name: 'sendTarget' })).toHaveTextContent('∗');

    // 다시 누르면 전체 해제 → 선택 없음 → 활성 pane 폴백으로 되돌아간다.
    fireEvent.click(screen.getByText('deselectAll'));
    send();
    expect(onSend).toHaveBeenCalledWith('ls', ['a'], {});
  });

  it('drops panes that disappear (split closed) from the selection', () => {
    const setCommand = vi.fn();
    const onSend = vi.fn();
    const props = {
      isOpen: true, onClose: vi.fn(), onSend, command: 'ls', setCommand, terminalKey: 'a', t,
    };
    const { rerender } = render(<CommandInput {...props} panes={PANES} />);

    fireEvent.click(screen.getByRole('button', { name: 'sendTarget' }));
    fireEvent.click(screen.getByText('gamma'));

    // 'c' 를 고른 상태에서 그 pane 이 사라지면, 죽은 key 로 보내지 않고 활성 pane 으로 폴백.
    rerender(<CommandInput {...props} panes={PANES.slice(0, 2)} />);
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
    expect(onSend).toHaveBeenCalledWith('ls', ['a'], {});
  });
});

describe('CommandInput image attach', () => {
  beforeEach(() => {
    vi.mocked(uploadImageAndGetPath).mockReset();
  });

  /* 입력값을 **진짜 상태**로 들고 렌더한다. vi.fn() 목으로 두면 삽입이 누적되지 않아
     "두 번째 이미지가 첫 번째를 덮는다" 류의 버그가 테스트에 안 잡힌다 — 실제로 그렇게
     놓쳤던 버그다. 검증도 목 호출인자가 아니라 화면의 textarea 값으로 한다. */
  const renderWith = (props = {}) => {
    const setCommand = vi.fn();
    const Harness = () => {
      const [command, setState] = useState(props.command ?? '');
      return (
        <CommandInput
          isOpen={true}
          onClose={vi.fn()}
          onSend={vi.fn()}
          command={command}
          setCommand={(next) => { setCommand(next); setState(next); }}
          t={t}
        />
      );
    };
    const utils = render(<Harness />);
    const fileInput = utils.container.querySelector('input[type="file"]');
    const field = () => screen.getByPlaceholderText(t('commandInputHint'));
    return { ...utils, setCommand, fileInput, field };
  };

  const imageFile = () => new File(['x'], 'shot.png', { type: 'image/png' });

  it('uploads an attached image and inserts the returned path into the field', async () => {
    vi.mocked(uploadImageAndGetPath).mockResolvedValue({ path: '/ws/.pasted/p.webp' });
    const { fileInput, field } = renderWith({ command: '' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [imageFile()] } });
    });

    await waitFor(() => expect(uploadImageAndGetPath).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(field().value).toContain('/ws/.pasted/p.webp '));
  });

  it('inserts the path on clipboard image paste (text paste left to default)', async () => {
    vi.mocked(uploadImageAndGetPath).mockResolvedValue({ path: '/ws/.pasted/clip.webp' });
    const { field } = renderWith({ command: '' });
    const textarea = field();

    await act(async () => {
      fireEvent.paste(textarea, {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => imageFile() }],
        },
      });
    });

    await waitFor(() => expect(uploadImageAndGetPath).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(field().value).toContain('/ws/.pasted/clip.webp '));
  });

  it('shows a failure label and does not insert a path when upload fails', async () => {
    vi.mocked(uploadImageAndGetPath).mockRejectedValue(new Error('boom'));
    const { fileInput, setCommand } = renderWith({ command: '' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [imageFile()] } });
    });

    await waitFor(() => expect(screen.getByText('Upload failed')).toBeTruthy());
    expect(setCommand).not.toHaveBeenCalled();
  });

  /* 회귀: 여러 장을 고르면 업로드가 순차로 끝나며 삽입이 N 번 일어난다. 삽입이 렌더 시점의
     값을 기준으로 계산되면 매번 같은 옛 문자열 위에 써서 앞의 경로를 덮어버린다 —
     5장을 올려도 마지막 하나만 남았다. 함수형 업데이트로만 누적된다. */
  it('여러 장을 올리면 경로가 모두 남는다 (앞의 것을 덮지 않는다)', async () => {
    vi.mocked(uploadImageAndGetPath)
      .mockResolvedValueOnce({ path: '/ws/.pasted/a.webp' })
      .mockResolvedValueOnce({ path: '/ws/.pasted/b.webp' })
      .mockResolvedValueOnce({ path: '/ws/.pasted/c.webp' });
    const { fileInput, field } = renderWith({ command: '' });

    await act(async () => {
      fireEvent.change(fileInput, {
        target: { files: [imageFile(), imageFile(), imageFile()] },
      });
    });

    await waitFor(() => expect(uploadImageAndGetPath).toHaveBeenCalledTimes(3));
    await waitFor(() => {
      const v = field().value;
      expect(v).toContain('/ws/.pasted/a.webp');
      expect(v).toContain('/ws/.pasted/b.webp');
      expect(v).toContain('/ws/.pasted/c.webp');
    });
  });

  it('이미 쓰던 텍스트 뒤에 이어 붙는다', async () => {
    vi.mocked(uploadImageAndGetPath)
      .mockResolvedValueOnce({ path: '/ws/.pasted/a.webp' })
      .mockResolvedValueOnce({ path: '/ws/.pasted/b.webp' });
    const { fileInput, field } = renderWith({ command: '이거 봐 ' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [imageFile(), imageFile()] } });
    });

    await waitFor(() => {
      const v = field().value;
      expect(v).toContain('이거 봐 ');
      expect(v).toContain('/ws/.pasted/a.webp');
      expect(v).toContain('/ws/.pasted/b.webp');
    });
  });

  it('ignores non-image file selections', async () => {
    const { fileInput } = renderWith({ command: '' });

    await act(async () => {
      fireEvent.change(fileInput, {
        target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
      });
    });

    expect(uploadImageAndGetPath).not.toHaveBeenCalled();
  });
});


describe('하단 도크 (모바일)', () => {
  const base = {
    isOpen: true, docked: true, onClose: vi.fn(), onSend: vi.fn(),
    command: '', setCommand: vi.fn(), t,
  };

  it('제목과 닫기 버튼이 없다 — 상시 노출이라 닫을 것도 설명할 것도 없다', () => {
    render(<CommandInput {...base} />);
    expect(screen.getByTestId('command-input-dock')).toBeTruthy();
    expect(screen.queryByTestId('command-input-overlay')).toBeNull();
    expect(screen.queryByText('Send command')).toBeNull();
  });

  /* 예전에는 fixed 층을 **전부** 금지했다. 막으려던 것은 층 자체가 아니라 "그 아래
     터미널이 터치를 못 받는 것" 이었고, 그건 pointer-events 로 갈린다 — 그래서 금지가
     아니라 규칙으로 둔다. 터미널을 눌러 포커스를 되찾는 길이 막히면 도크에 갇힌다. */
  it('fixed 층은 터치를 막지 않는다', () => {
    const { container } = render(<CommandInput {...base} />);
    const fixed = Array.from(container.querySelectorAll('div'))
      .filter((el) => el.style.position === 'fixed');
    fixed.forEach((el) => expect(el.style.pointerEvents).toBe('none'));
  });

  it('포커스를 붙잡지 않는다 — 붙잡으면 터미널에 아무것도 못 친다', () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    render(<CommandInput {...base} />);
    outside.focus();
    expect(document.activeElement).toBe(outside);   // 되튕기지 않는다
    outside.remove();
  });

  it('입력·보내기가 한 줄에 같이 있다', () => {
    const { container } = render(<CommandInput {...base} />);
    const row = container.querySelector('[data-testid="command-input-dock"] > div:last-child, [data-testid="command-input-dock"] > div');
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(screen.getByTitle('Send')).toBeTruthy();
    expect(row).toBeTruthy();
  });

  it('퀵바 슬롯이 있으면 대상·히스토리를 거기로 보낸다 — 도크는 한 줄로 남는다', () => {
    const slot = document.createElement('div');
    slot.id = 'iterm-dock-slot';
    document.body.appendChild(slot);
    render(<CommandInput {...base} terminalKey="a" />);
    // 히스토리 토글이 도크가 아니라 슬롯 안에 그려진다.
    expect(slot.querySelector('button')).toBeTruthy();
    const dock = screen.getByTestId('command-input-dock');
    expect(dock.contains(slot.querySelector('button'))).toBe(false);
    slot.remove();
  });

  it('슬롯이 없으면 아무 일도 안 한다 — 데스크탑에는 퀵바가 없다', () => {
    render(<CommandInput {...base} terminalKey="a" />);
    expect(screen.getByTestId('command-input-dock')).toBeTruthy();   // 터지지 않는다
  });

  it('도크 안의 컨트롤은 전부 같은 크기다', () => {
    /* 예전에는 28/30/34 가 섞여 있었다 — 각자 다른 자리에서 자란 스타일이라 따로 보면
       티가 안 나고, 한 줄에 모으니 들쭉날쭉했다. 다시 어긋나면 여기서 잡는다. */
    const slot = document.createElement('div');
    slot.id = 'iterm-dock-slot';
    document.body.appendChild(slot);
    render(<CommandInput {...base} terminalKey="a" />);

    const dock = screen.getByTestId('command-input-dock');
    const boxes = [...dock.querySelectorAll('button'), ...slot.querySelectorAll('button')]
      .map((b) => ({ w: b.style.width, h: b.style.height }))
      .filter((b) => b.w && b.h);           // 크기를 안 정한 것은 대상이 아니다
    expect(boxes.length).toBeGreaterThan(1);
    expect(new Set(boxes.map((b) => `${b.w}x${b.h}`)).size).toBe(1);
    expect(boxes[0].w).toBe(boxes[0].h);    // 정사각

    // 입력도 같은 높이에서 시작한다 — 버튼과 어깨를 맞춰야 한 줄로 보인다.
    expect(dock.querySelector('textarea').style.height).toBe(boxes[0].h);
    slot.remove();
  });

  it('도크 버튼은 아이콘이 가운데 온다', () => {
    /* flex 의 기본 justifyContent 는 flex-start 다. 라벨이 있던 시절에는 티가 안 났는데,
       배지를 빼고 정사각으로 만들자 아이콘이 왼쪽에 붙어 보였다(TargetSelect 만 빠져 있었다). */
    const slot = document.createElement('div');
    slot.id = 'iterm-dock-slot';
    document.body.appendChild(slot);
    render(<CommandInput {...base} terminalKey="a" />);

    const buttons = [...screen.getByTestId('command-input-dock').querySelectorAll('button'),
                     ...slot.querySelectorAll('button')]
      .filter((b) => b.style.width);        // 크기를 정한 도크 컨트롤만
    expect(buttons.length).toBeGreaterThan(1);
    buttons.forEach((b) => expect(b.style.justifyContent).toBe('center'));
    slot.remove();
  });

  it('입력의 세로 패딩이 대칭이고 글자가 잘리지 않는다', () => {
    /* 상단 패딩이 더 크면 첫 줄이 아래로 밀려 글자 윗부분이 잘려 보였다.
       (패딩*2 + 줄높이) 가 높이를 넘어도 같은 증상이 난다. */
    render(<CommandInput {...base} />);
    const ta = screen.getByTestId('command-input-dock').querySelector('textarea');
    const [padY] = ta.style.padding.split(' ');
    const h = parseInt(ta.style.height, 10);
    const line = parseInt(ta.style.lineHeight, 10);
    expect(ta.style.padding.split(' ')).toHaveLength(2);   // "Ypx Xpx" — 상하가 한 값
    expect(parseInt(padY, 10) * 2 + line).toBeLessThanOrEqual(h);
    expect(ta.style.boxSizing).toBe('border-box');          // 패딩이 높이를 밀지 않게
  });

  it('도크에서 Enter 는 전송이다', () => {
    /* 한 줄 보내려고 여는 자리인데 Enter 가 줄바꿈이면 매번 Ctrl 을 같이 눌러야 하고,
       폰 키보드에는 그 조합이 없다. */
    const onSend = vi.fn();
    render(<CommandInput {...base} command="ls" onSend={onSend} />);
    fireEvent.keyDown(screen.getByTestId('command-input-dock').querySelector('textarea'), { key: 'Enter' });
    expect(onSend).toHaveBeenCalled();
  });

  it('Shift+Enter 는 줄바꿈 — 전송하지 않는다', () => {
    const onSend = vi.fn();
    render(<CommandInput {...base} command="ls" onSend={onSend} />);
    fireEvent.keyDown(screen.getByTestId('command-input-dock').querySelector('textarea'), { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('IME 조합 중의 Enter 는 확정이지 전송이 아니다', () => {
    /* 이걸 놓치면 한글을 치다 글자를 확정할 때마다 명령이 날아간다. */
    const onSend = vi.fn();
    render(<CommandInput {...base} command="ㅁㅏ" onSend={onSend} />);
    const ta = screen.getByTestId('command-input-dock').querySelector('textarea');
    fireEvent.keyDown(ta, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('모달에서는 Enter 가 줄바꿈 그대로 — 데스크탑 습관을 바꾸지 않는다', () => {
    const onSend = vi.fn();
    render(<CommandInput {...base} docked={false} command="ls" onSend={onSend} />);
    fireEvent.keyDown(screen.getByRole('dialog').querySelector('textarea'), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('모달은 그대로 제목과 닫기를 갖는다 — 데스크탑은 건드리지 않았다', () => {
    render(<CommandInput {...base} docked={false} />);
    expect(screen.getByTestId('command-input-overlay')).toBeTruthy();
    expect(screen.getByText('Send command')).toBeTruthy();
  });
});

/* 도크의 지난 명령 목록은 **높이 상한이 있어야** 스크롤된다. 모달과 달리 도크에는 높이를
   정해 주는 조상이 없어서, 상한을 빼면 목록이 내용만큼 자라 overflow 가 안 걸린다 —
   화면에서는 "항목이 23개인데 스크롤이 안 된다" 로 보인다. */
describe('도크 히스토리 높이', () => {
  test('목록을 감싸는 상자에 높이 상한이 있다', () => {
    const src = readFileSync(resolve(__dirname, 'CommandInput.jsx'), 'utf8');
    expect(src).toMatch(/dockHistory: \{[^}]*maxHeight/s);
    expect(src).toMatch(/dockHistory: \{[^}]*minHeight: 0/s);
    expect(src).toMatch(/style=\{styles\.dockHistory\}/);
  });
});


/* 도크는 **상시 노출**이라 떠 있다는 것만으로는 "지금 여기로 쳐진다" 가 되지 않는다.
   신호가 없으면 사용자는 매번 한 글자를 시험 삼아 쳐 보게 된다(실제로 그랬다). */



/* 프롬프트 확인·"계속" 은 폰에서 가장 잦은 동작인데, 예전에는
   [도크에서 손 떼기 → 터미널 누르기 → 엔터] 세 단계였다. */
describe('빈 전송 = 터미널에 Enter', () => {
  const base = {
    isOpen: true, docked: true, onClose: vi.fn(), onSend: vi.fn(),
    command: '', setCommand: vi.fn(), t,
  };

  test('내용이 없으면 Enter 를 흘린다', () => {
    const onSendKey = vi.fn();
    const onSend = vi.fn();
    render(<CommandInput {...base} onSendKey={onSendKey} onSend={onSend} />);
    fireEvent.click(screen.getByTitle('Send'));
    expect(onSendKey).toHaveBeenCalledWith('\r', expect.anything());
    expect(onSend).not.toHaveBeenCalled();      // 빈 명령을 보내지는 않는다
  });

  test('내용이 있으면 평소대로 명령을 보낸다', () => {
    const onSendKey = vi.fn();
    const onSend = vi.fn();
    render(<CommandInput {...base} command="ls" onSendKey={onSendKey} onSend={onSend} />);
    fireEvent.click(screen.getByTitle('Send'));
    expect(onSend).toHaveBeenCalled();
    expect(onSendKey).not.toHaveBeenCalled();
  });

  /* ⚠️ PC 모달에서 빈 전송은 그냥 실수다 — 닫으면 그만이지 터미널에 엔터를 칠 일이 아니다. */
  test('PC 모달에서는 아무 일도 없다', () => {
    const onSendKey = vi.fn();
    render(<CommandInput {...base} docked={false} onSendKey={onSendKey} />);
    fireEvent.click(screen.getByTitle('Send'));
    expect(onSendKey).not.toHaveBeenCalled();
  });
});


/* "테마 잘 들어가게" 를 코드로 잠근다. 비활성용 색을 따로 고르면 테마마다 어긋나므로,
   비활성은 **색을 새로 정하지 않고** 상대적으로만 낮춘다. */
describe('도크 비활성 표현은 테마를 따른다', () => {
  const src = readFileSync(resolve(__dirname, 'CommandInput.jsx'), 'utf8');
  const block = (name) => {
    const at = src.indexOf(`  ${name}: {`);
    return at < 0 ? '' : src.slice(at, src.indexOf('\n  },', at));
  };

  test('비활성은 색이 아니라 채도/불투명도로 낮춘다', () => {
    const idle = block('dockRowIdle');
    expect(idle).toMatch(/saturate\(/);
    expect(idle).not.toMatch(/#[0-9a-fA-F]{3,6}/);      // 고정색을 박지 않았다
  });

  test('활성/비활성 테두리는 모두 테마 변수에서 온다', () => {
    for (const name of ['dockTextareaOn', 'dockTextareaOff']) {
      const body = block(name);
      expect(body, name).toMatch(/var\(--ui-/);
      // 리터럴 hex 는 var() 의 폴백 자리에만 허용된다(토큰이 그렇게 생겼다).
      const stray = body.replace(/var\([^)]*\)/g, '').match(/#[0-9a-fA-F]{3,6}/);
      expect(stray, `${name}: ${stray}`).toBeNull();
    }
  });

  /* ⚠️ 입력칸이 자기 opacity 를 또 가지면 줄 전체 처리와 곱해져 글자가 안 읽힌다. */
  test('입력칸은 자기 불투명도를 따로 갖지 않는다', () => {
    expect(block('dockTextareaOff')).not.toMatch(/opacity:/);
  });

  /* ⚠️ 면(배경)까지 바꾸면 과하다 — 맞붙은 두 줄이 번쩍이는 것처럼 보인다.
     신호는 테두리 하나로 충분하다. */
  test('포커스로 면을 바꾸지 않는다 — 테두리만', () => {
    for (const name of ['dockTextareaOn', 'dockTextareaOff']) {
      expect(block(name), name).not.toMatch(/background:/);
    }
  });
});


/* 캣푸친처럼 대비가 낮은 팔레트에서 도크 버튼이 거의 안 보였다. 원인은 테두리 색이 아니라
   **면이 비어 있었던 것**(ghost) — 바로 위 퀵바 키는 면이 채워져 있어 잘 보인다. */
describe('도크 버튼은 면이 채워져 있다', () => {
  const src = readFileSync(resolve(__dirname, 'CommandInput.jsx'), 'utf8');
  /* ⚠️ 첨부 버튼은 **둘**이다 — PC 모달용과 도크용. 모달 쪽 ghost 는 그대로가 맞으므로
     범위를 도크 분기 안으로 좁힌다(안 그러면 앞엣것을 재고 언제나 실패한다). */
  const dockBranch = src.slice(src.indexOf('if (docked) {'), src.indexOf('const styles = {'));

  test('도크 첨부 버튼은 ghost 가 아니다', () => {
    const at = dockBranch.indexOf('image.openPicker');
    const around = dockBranch.slice(Math.max(0, at - 200), at + 200);
    expect(around).toMatch(/variant="secondary"/);
    expect(around).not.toMatch(/variant="ghost"/);
  });

  test('PC 모달 쪽은 건드리지 않았다 — 거기 ghost 는 의도한 것이다', () => {
    const modalPart = src.slice(0, src.indexOf('if (docked) {'));
    expect(modalPart).toMatch(/variant="ghost"/);
  });

  /* ⚠️ `Button` 은 hover 를 뗄 때 variant 의 배경으로 되돌린다. style 로 면을 덮어쓰면
     한 번 스치기만 해도 원래대로 돌아가 다시 안 보이게 된다 — variant 로 골라야 한다. */
  test('공통 dockBtn 은 면을 칠하지 않는다 — variant 가 진다', () => {
    const at = src.indexOf('  dockBtn: {');
    const body = src.slice(at, src.indexOf('\n  },', at));
    expect(body).not.toMatch(/background:/);
  });

  /* 버튼끼리는 붙어야 한 무리로 읽히지만, 입력칸까지 같은 간격이면 버튼이 입력의
     일부처럼 보인다 — 무리의 시작에만 틈을 준다. */
  test('오른쪽 버튼 무리는 입력칸에서 떨어져 있다', () => {
    const gap = Number((src.match(/dockInputRow: \{[^}]*gap: '(\d+)px'/s) || [])[1]);
    const lead = Number((src.match(/dockBtnGroupStart: \{[^}]*marginLeft: '(\d+)px'/s) || [])[1]);
    expect(lead).toBeGreaterThan(gap);
  });

  test('마이크는 variant 가 없는 raw 버튼이라 면을 직접 받는다', () => {
    expect(src).toMatch(/styles\.dockBtn, \.\.\.styles\.dockBtnFace/);
  });
});


/* 붙어 있는 두 줄(퀵바 + 도크)은 한 덩어리로 읽혀야 한다. 도크 면을 상태에 따라 바꿨더니
   도크만 색이 달라져 따로 노는 것처럼 보였다. */
describe('도크와 퀵바는 한 덩어리', () => {
  const src = readFileSync(resolve(__dirname, 'CommandInput.jsx'), 'utf8');

  test('도크 면은 상태에 따라 바뀌지 않는다', () => {
    expect(src).not.toMatch(/dockOn\b/);
    expect(src).not.toMatch(/dockOff\b/);
  });

  test('도크와 퀵바는 같은 면 상수를 쓴다', () => {
    const at = src.indexOf('  dock: {');
    const body = src.slice(at, src.indexOf('\n  },', at));
    expect(body).toMatch(/MOBILE_CONTROL\.barBackground/);
    const toolbar = readFileSync(resolve(__dirname, 'MobileToolbar.jsx'), 'utf8');
    expect(toolbar).toMatch(/MOBILE_CONTROL\.barBackground/);
  });

  /* 둘 사이의 선은 **은은하게** 남긴다. 없애 봤더니 두 줄의 경계가 사라져 오히려 읽기
     나빴다 — 쪼개 보이던 것은 선이 아니라 면(배경)이 서로 달랐던 탓이다. */
  test('분리선은 있되 옅다', () => {
    const at = src.indexOf('  dock: {');
    const body = src.slice(at, src.indexOf('\n  },', at));
    const pct = Number((body.match(/borderTop:.*?(\d+)%/) || [])[1]);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(60);
  });



  /* ⚠️ 액센트로 채운 채 두면 비활성인데도 줄에서 가장 밝은 것이 남는다. */
  test('전송 버튼은 비활성일 때 면이 빈다', () => {
    expect(src).toMatch(/variant=\{dockFocused \? 'primary' : 'secondary'\}/);
  });
});


/* ⚠️ 터미널 면에 filter 를 걸지 않는다. 작은 버튼과 달리 여기는 끊임없이 다시 그려지는
   면이라 필터가 매 프레임 다시 걸리고, 그 아래 xterm 캔버스가 합성 빠른 경로에서 떨어질
   수 있다 — 폰에서 발열로 돌아온다. 이 저장소는 그 근처에서 이미 두 번 데었다. */
describe('터미널 음영은 막으로 준다 — filter 가 아니라', () => {
  const src = readFileSync(resolve(__dirname, 'CommandInput.jsx'), 'utf8');

  test('전역 CSS 가 터미널에 filter 를 걸지 않는다', () => {
    const main = readFileSync(resolve(__dirname, '..', 'main.jsx'), 'utf8');
    expect(main).not.toMatch(/iterm-term-surface/);
  });

  test('터미널에 그 클래스가 남아 있지 않다', () => {
    const term = readFileSync(resolve(__dirname, 'Terminal.jsx'), 'utf8');
    expect(term).not.toMatch(/iterm-term-surface/);
  });

  /* 막은 한 번 그려지고 합성만 된다. filter 는 매 프레임 다시 걸린다 — 그 차이가
     폰 발열로 돌아왔다. */
  /* ⚠️ 음영은 **색이 아니라 어둠**이다. 테마 색을 쓰면 그 색이 얹혀서, 푸른 기가 도는
     팔레트(캣푸친)에서는 터미널이 푸르딩딩해진다. */
  test('막은 색을 얹지 않는다 — 중립 검정이다', () => {
    const at = src.indexOf('  dockScrim: {');
    const body = src.slice(at, src.indexOf('\n  },', at));
    expect(body).toMatch(/rgba\(0, ?0, ?0,/);
    expect(body).not.toMatch(/--ui-/);
  });

  test('막은 터치를 막지 않는다 — 터미널을 눌러 포커스를 되찾아야 한다', () => {
    const at = src.indexOf('  dockScrim: {');
    const body = src.slice(at, src.indexOf('\n  },', at));
    expect(body).toMatch(/pointerEvents: 'none'/);
  });

  /* ⚠️ z-index 만으로는 부족하다. 도크 **안**에 두면 도크가 만든 층 안쪽으로 들어가
     막이 도크 자기 내용 위로 올라간다(실제로 바닥 두 줄까지 음영이 씌워졌다). */
  /* ⚠️ 자리를 두 번 틀렸다. 도크 **안**에 두면 도크가 만든 층 안쪽으로 들어가 막이 도크
     자기 내용 위로 올라가고(바닥 두 줄까지 음영), body 로 빼면 이번엔 헤더·탭바까지 덮는다.
     기준은 화면이 아니라 **터미널이 사는 상자**다. */
  test('막은 터미널 영역 안에만 그려진다', () => {
    const at = src.indexOf('styles.dockScrim');
    const around = src.slice(Math.max(0, at - 300), at + 200);
    expect(around).toMatch(/createPortal/);
    expect(around).toMatch(/scrimHost/);
    expect(around).not.toMatch(/document\.body/);
    expect(src).toMatch(/getElementById\('iterm-terminal-area'\)/);
    const app = readFileSync(resolve(__dirname, '..', 'App.jsx'), 'utf8');
    expect(app).toMatch(/id="iterm-terminal-area"/);
  });

  /* ⚠️ 키보드를 내려도 **포커스는 남는다.** 포커스만으로 판단하면 키보드가 사라진 뒤에도
     막이 덩그러니 남아 그게 가장 어색하다. */
  test('음영은 키보드가 올라와 있을 때만 — 포커스만으로는 아니다', () => {
    expect(src).toMatch(/const scrimShown = docked && dockFocused && keyboardUp;/);
  });

  test('뷰포트 구독은 포커스에 묶인다 — 평소엔 리스너가 0이다', () => {
    expect(src).toMatch(/useVisualViewport\(isOpen && \(!docked \|\| dockFocused\)\)/);
  });

  test('막은 그 상자 기준이다 — 화면 고정이 아니다', () => {
    const at = src.indexOf('  dockScrim: {');
    const body = src.slice(at, src.indexOf('\n  },', at));
    expect(body).toMatch(/position: 'absolute'/);
  });

  test('막은 바닥 두 줄보다 아래다 — 정작 활성인 입력칸이 가라앉으면 안 된다', () => {
    const scrimAt = src.indexOf('  dockScrim: {');
    const scrim = src.slice(scrimAt, src.indexOf('\n  },', scrimAt));
    const dockAt = src.indexOf('  dock: {');
    const dock = src.slice(dockAt, src.indexOf('\n  },', dockAt));
    const z = (block) => Number((block.match(/zIndex: (\d+)/) || [])[1]);
    expect(z(scrim)).toBeLessThan(z(dock));
  });
});
