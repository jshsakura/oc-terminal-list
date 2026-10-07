import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ko } from '../../i18n/locales/ko';
import GlassModal from '../common/GlassModal';
import KeyCombinationModal from './KeyCombinationModal';

it('registers in a separate modal with a fixed footer and closes only the child on Escape', () => {
  const parentClose = vi.fn();
  const add = vi.fn(() => true);
  const Parent = () => {
    const [open, setOpen] = useState(false);
    return <GlassModal isOpen title="Parent" onClose={parentClose}>
      <button onClick={() => setOpen(true)}>Register</button>
      {open && <KeyCombinationModal t={key => ko[key]} onAddShortcut={add} onClose={() => setOpen(false)} />}
    </GlassModal>;
  };
  render(<Parent />);
  fireEvent.click(screen.getByRole('button', { name: 'Register' }));
  const modal = screen.getByRole('dialog', { name: '조합키 등록' });
  expect(modal.closest('[data-key-combination-modal]').parentElement).toBe(document.body);
  fireEvent.click(within(modal).getByRole('button', { name: 'Ctrl', exact: true }));
  fireEvent.click(within(modal).getByRole('button', { name: 'F12', exact: true }));
  const register = within(modal).getByRole('button', { name: '현재 퀵바 세트에 추가' });
  expect(register.closest('footer')).toBeInTheDocument();
  const close = within(modal).getByRole('button', { name: '닫기' });
  act(() => close.focus());
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(register).toHaveFocus();
  fireEvent.keyDown(register, { key: 'Tab' });
  expect(close).toHaveFocus();
  fireEvent.click(register);
  expect(add).toHaveBeenCalledExactlyOnceWith({ label: 'Ctrl + F12', payload: '\x1b[24;5~' });
  fireEvent.keyDown(within(modal).getByRole('button', { name: '닫기' }), { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '조합키 등록' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Parent' })).toBeInTheDocument();
  expect(parentClose).not.toHaveBeenCalled();
});
