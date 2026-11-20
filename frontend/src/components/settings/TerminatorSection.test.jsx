import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../utils/terminatorApi', () => ({
  fetchTerminatorConfig: vi.fn(),
  saveTerminatorConfig: vi.fn(),
  checkTerminator: vi.fn(),
}));

import TerminatorSection from './TerminatorSection';
import * as api from '../../utils/terminatorApi';

const t = () => undefined;
const UNSET = { configured: false, key_hint: null, model: 'glm-5.3-flash', default_model: 'glm-5.3-flash' };
const SET = { configured: true, key_hint: 'zyxw', model: 'glm-5.3-flash', default_model: 'glm-5.3-flash' };

describe('TerminatorSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves a pasted key, clears the field and shows only the key tail', async () => {
    api.fetchTerminatorConfig.mockResolvedValueOnce(UNSET);
    api.saveTerminatorConfig.mockResolvedValueOnce(SET);
    render(<TerminatorSection t={t} />);
    expect(await screen.findByText(/키가 없습니다/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: '저장' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: '연결 확인' })).toBeDisabled();

    const input = screen.getByPlaceholderText('키를 붙여 넣습니다');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: ' secret-key-123456 ' } });
    fireEvent.click(save);
    await waitFor(() => expect(api.saveTerminatorConfig).toHaveBeenCalledWith({ api_key: 'secret-key-123456', model: '' }));
    expect(await screen.findByText(/키 끝자리 zyxw/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('바꾸려면 새 키를 붙여 넣습니다')).toHaveValue('');
  });

  it('checks the connection and says how fast it answered', async () => {
    api.fetchTerminatorConfig.mockResolvedValueOnce(SET);
    api.checkTerminator.mockResolvedValueOnce({ ok: true, model: 'glm-5.3-flash', ms: 812 });
    render(<TerminatorSection t={t} />);
    fireEvent.click(await screen.findByRole('button', { name: '연결 확인' }));
    expect(await screen.findByText('glm-5.3-flash 이 812ms 만에 답했습니다')).toBeInTheDocument();
  });

  it('shows the server refusal and can remove the key', async () => {
    api.fetchTerminatorConfig.mockResolvedValueOnce(SET);
    api.saveTerminatorConfig
      .mockRejectedValueOnce(new Error('모델 이름은 영문 소문자·숫자·점·하이픈으로 씁니다'))
      .mockResolvedValueOnce(UNSET);
    render(<TerminatorSection t={t} />);
    fireEvent.change(await screen.findByPlaceholderText('glm-5.3-flash'), { target: { value: 'Bad Model!' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText(/영문 소문자/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '키 지우기' }));
    await waitFor(() => expect(api.saveTerminatorConfig).toHaveBeenLastCalledWith({ clear_key: true }));
    expect(await screen.findByText(/키가 없습니다/)).toBeInTheDocument();
  });
});
