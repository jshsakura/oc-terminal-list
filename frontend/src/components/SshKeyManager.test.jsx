import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SshKeyManager from './SshKeyManager';
import { ko } from '../i18n/locales/ko';

const t = (key) => ko[key] || key;

const open = (props = {}) => render(
  <SshKeyManager
    isOpen
    keys={[]}
    onAdd={vi.fn()}
    onUpdate={vi.fn()}
    onDelete={vi.fn()}
    onClose={vi.fn()}
    t={t}
    {...props}
  />,
);

describe('SshKeyManager', () => {
  /* Handing a private key to an app is the moment a user wants to know where it goes.
     The second half — that it never reaches the remote host — is the same promise the
     cross-machine handoff rests on, so it is worth saying here rather than nowhere. */
  it('키를 어디에 보관하고 어디로는 보내지 않는지 폼 위에서 말한다', () => {
    open();
    fireEvent.click(screen.getByText(ko.addKey));
    expect(screen.getByText(ko.sshKeyManagerNote)).toBeTruthy();
  });

  it('추가할 때는 암호 칸에도 설명이 붙는다 — 편집 때와 다른 이야기다', () => {
    open();
    fireEvent.click(screen.getByText(ko.addKey));
    expect(screen.getByText(ko.passphraseAddHint)).toBeTruthy();
    expect(screen.queryByText(ko.passphraseEditHint)).toBeNull();
  });

  it('이름 칸은 그 이름이 나중에 어디에 쓰이는지 알려준다', () => {
    open();
    fireEvent.click(screen.getByText(ko.addKey));
    expect(screen.getByText(ko.keyNameFieldHint)).toBeTruthy();
  });
});
