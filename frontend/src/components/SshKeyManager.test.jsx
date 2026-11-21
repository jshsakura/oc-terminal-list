import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  // The add button once called a prop AppModals never passed (onCreate vs onAdd), so adding
  // a key always failed. Lock the wiring and the call.
  it('AppModals 가 넘기는 추가 함수 이름이 이 컴포넌트가 부르는 이름과 같다', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/AppModals.jsx'), 'utf8');
    const block = src.slice(src.indexOf('<SshKeyManager'), src.indexOf('/>', src.indexOf('<SshKeyManager')));
    expect(block).toMatch(/\bonAdd=\{/);
    expect(block).not.toMatch(/\bonCreate=/);
  });

  it('추가를 누르면 입력한 키로 onAdd 를 부른다', async () => {
    const onAdd = vi.fn(async () => {});
    open({ onAdd });
    fireEvent.click(screen.getByText(ko.addKey));
    const [name, pem] = screen.getAllByRole('textbox');
    fireEvent.change(name, { target: { value: 'laptop' } });
    fireEvent.change(pem, { target: { value: '-----BEGIN KEY-----' } });
    const submit = screen.getAllByRole('button').filter((b) => /추가|저장/.test(b.textContent)).at(-1);
    fireEvent.click(submit);
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'laptop', privateKey: '-----BEGIN KEY-----' });
  });

  it('설정에서 키를 눌러 열면 그 키의 편집 폼이 열린다', () => {
    open({ keys: [{ id: 'k1', name: 'laptop' }], initialEditKey: { id: 'k1', name: 'laptop' } });
    expect(screen.getByDisplayValue('laptop')).toBeTruthy();
  });
});
