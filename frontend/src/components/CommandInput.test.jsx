import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    expect(screen.getByRole('button', { name: 'sendTarget' })).toHaveTextContent('sendToActive');
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
    expect(screen.getByRole('button', { name: 'sendTarget' })).toHaveTextContent('sendToAll');

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

  const renderWith = (props = {}) => {
    const setCommand = vi.fn();
    const utils = render(
      <CommandInput
        isOpen={true}
        onClose={vi.fn()}
        onSend={vi.fn()}
        command={props.command ?? ''}
        setCommand={setCommand}
        t={t}
      />
    );
    const fileInput = utils.container.querySelector('input[type="file"]');
    return { ...utils, setCommand, fileInput };
  };

  const imageFile = () => new File(['x'], 'shot.png', { type: 'image/png' });

  it('uploads an attached image and inserts the returned path into the field', async () => {
    vi.mocked(uploadImageAndGetPath).mockResolvedValue({ path: '/ws/.pasted/p.webp' });
    const { fileInput, setCommand } = renderWith({ command: '' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [imageFile()] } });
    });

    await waitFor(() => expect(uploadImageAndGetPath).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(setCommand).toHaveBeenCalledWith(expect.stringContaining('/ws/.pasted/p.webp '))
    );
  });

  it('inserts the path on clipboard image paste (text paste left to default)', async () => {
    vi.mocked(uploadImageAndGetPath).mockResolvedValue({ path: '/ws/.pasted/clip.webp' });
    const { setCommand } = renderWith({ command: '' });
    const textarea = screen.getByPlaceholderText(t('commandInputHint'));

    await act(async () => {
      fireEvent.paste(textarea, {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => imageFile() }],
        },
      });
    });

    await waitFor(() => expect(uploadImageAndGetPath).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(setCommand).toHaveBeenCalledWith(expect.stringContaining('/ws/.pasted/clip.webp '))
    );
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
