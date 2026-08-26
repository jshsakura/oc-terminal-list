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

  it('backdrop 층을 만들지 않는다 — 투명 fixed 층이 깔리면 그 아래 터미널이 터치를 못 받는다', () => {
    const { container } = render(<CommandInput {...base} />);
    const fixed = Array.from(container.querySelectorAll('div'))
      .filter((el) => el.style.position === 'fixed');
    expect(fixed).toHaveLength(0);
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

  it('모달은 그대로 제목과 닫기를 갖는다 — 데스크탑은 건드리지 않았다', () => {
    render(<CommandInput {...base} docked={false} />);
    expect(screen.getByTestId('command-input-overlay')).toBeTruthy();
    expect(screen.getByText('Send command')).toBeTruthy();
  });
});
