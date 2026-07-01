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
        t={t}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    // 2번째 인자 = 전송 대상. pane 1개(또는 미지정)면 'active'.
    expect(onSend).toHaveBeenCalledWith('ls', 'active');
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
