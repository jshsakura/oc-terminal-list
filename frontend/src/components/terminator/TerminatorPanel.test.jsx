import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../utils/terminatorApi', () => ({
  fetchTerminatorStatus: vi.fn(async () => ({ configured: true, model: 'glm-5.3-flash' })),
  fetchTerminatorMessages: vi.fn(async () => ({ messages: [] })),
  resetTerminator: vi.fn(async () => ({ ok: true })),
  sayToTerminator: vi.fn(),
}));

import TerminatorPanel from './TerminatorPanel';
import * as api from '../../utils/terminatorApi';
import { UI_ACTION_EVENT } from '../../utils/uiActions';

const t = () => undefined;

describe('TerminatorPanel', () => {
  let actions;
  const onAction = (e) => actions.push(e.detail.action);

  beforeEach(() => {
    vi.clearAllMocks();
    actions = [];
    window.addEventListener(UI_ACTION_EVENT, onAction);
  });
  afterEach(() => window.removeEventListener(UI_ACTION_EVENT, onAction));

  it('explains instead of chatting when no connection key is set', async () => {
    api.fetchTerminatorStatus.mockResolvedValueOnce({ configured: false, model: 'glm-5.3-flash' });
    render(<TerminatorPanel open t={t} />);
    expect(await screen.findByText(/연결이 아직 설정되지 않았습니다/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('이 화면에 대해 물어봅니다')).toBeDisabled();
  });

  it('greets with the model, quick action cards and suggested questions', async () => {
    render(<TerminatorPanel open t={t} />);
    expect(await screen.findByText('GLM-5.3-FLASH')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '오른쪽으로 나누기' }));
    expect(actions).toEqual(['split-right']);
  });

  it('a suggested question is sent as is', async () => {
    api.sayToTerminator.mockResolvedValueOnce({ reply: {}, messages: [] });
    render(<TerminatorPanel open t={t} />);
    fireEvent.click(await screen.findByText('파일은 어떻게 올려요?'));
    await waitFor(() => expect(api.sayToTerminator).toHaveBeenCalledWith('파일은 어떻게 올려요?'));
  });

  it('never acts by itself: it explains and offers the button to press', async () => {
    const reply = { id: 'a', role: 'assistant', text: '칸 위쪽 줄의 분할 아이콘을 누릅니다.', offer: ['split-down'], point: 'pane-split' };
    api.sayToTerminator.mockResolvedValueOnce({
      reply, messages: [{ id: 'u', role: 'user', text: '아래로 나눠줘' }, reply],
    });
    render(<TerminatorPanel open t={t} />);
    const input = await screen.findByPlaceholderText('이 화면에 대해 물어봅니다');
    fireEvent.change(input, { target: { value: '아래로 나눠줘' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('칸 위쪽 줄의 분할 아이콘을 누릅니다.')).toBeInTheDocument();
    expect(actions).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: '아래로 나누기' }).at(-1));
    expect(actions).toEqual(['split-down']);
  });

  it('points at a button when the answer says where something is', async () => {
    const spots = [];
    const onSpot = (e) => spots.push(e.detail.id);
    window.addEventListener('iterm:spotlight', onSpot);
    const reply = { id: 'a', role: 'assistant', text: '여기 있습니다.', offer: [], point: 'settings' };
    api.sayToTerminator.mockResolvedValueOnce({ reply, messages: [reply] });
    render(<TerminatorPanel open t={t} />);
    const input = await screen.findByPlaceholderText('이 화면에 대해 물어봅니다');
    fireEvent.change(input, { target: { value: '설정 어디 있어?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('여기 있습니다.');
    window.removeEventListener('iterm:spotlight', onSpot);
    expect(spots).toEqual(['settings']);
    expect(actions).toEqual([]);
  });
});
