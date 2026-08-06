import { lazy, Suspense, useMemo, useState } from 'react';
import LazyErrorBoundary from './LazyErrorBoundary';
import { authHeaders } from '../utils/auth';
import { tokens } from '../styles/tokens';

const { color, font, fontSize } = tokens;

const Settings = lazy(() => import('./Settings'));
const SshKeyManager = lazy(() => import('./SshKeyManager'));
const HostEditor = lazy(() => import('./HostEditor'));
const ConfirmModal = lazy(() => import('./ConfirmModal'));
const NotificationModal = lazy(() => import('./NotificationModal'));
const CommandPalette = lazy(() => import('./CommandPalette'));

/** 모달이 오는 동안의 자리 — 스크림 + 작은 스피너. 청크가 도착하면 곧바로 교체된다. */
const ModalLoading = () => (
  <div
    style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: color.scrim, backdropFilter: 'blur(2px)',
      fontFamily: font.sans, fontSize: fontSize['12'], color: color.subtext,
    }}
    aria-busy="true"
  >
    <span style={{
      width: '18px', height: '18px', borderRadius: '50%',
      border: `2px solid ${color.border}`, borderTopColor: color.accent,
      animation: 'iterm-modal-spin 0.8s linear infinite',
    }} />
    <style>{'@keyframes iterm-modal-spin { to { transform: rotate(360deg); } }'}</style>
  </div>
);

/**
 * App 의 트레일링 모달 묶음 — 설정/SSH키/호스트편집/확인/알림/커맨드팔레트/파일피커.
 * 전부 조건부 lazy 모달이라 한 곳에 모음. App.jsx 에서 로직 변경 없이 JSX 추출.
 * (상태/핸들러는 App 이 소유 → props 로 내려받는 presentational 묶음.)
 */
export default function AppModals({
  // settings
  isSettingsOpen, setIsSettingsOpen, settings, updateSettings, username,
  hosts, sshKeys, refreshHosts,
  setHostEditorState, setLocalEditorOpen, setEditingKey, setKeyManagerOpen, logout,
  // ssh key manager
  keyManagerOpen, editingKey, createKey, updateKey, deleteKey,
  // host editor
  hostEditorState, createHost, updateHost, deleteHost, setNotification,
  // confirm / notification
  confirmModal, handleConfirmModal, setConfirmModal, notification,
  // command palette
  isCommandPaletteOpen, setIsCommandPaletteOpen, handleAddTab, openTerminalSearch, openFilePicker,
  // file picker
  isFilePickerOpen, setIsFilePickerOpen, filePickerItems, filePickerQuery, setFilePickerQuery,
  isFilePickerLoading, handleFileOpen,
  t,
}) {
  // 커맨드 팔레트의 검색어는 이 묶음이 소유한다 — App 까지 올릴 이유가 없다.
  const [paletteQuery, setPaletteQuery] = useState('');
  const closeCommandPalette = () => { setIsCommandPaletteOpen(false); setPaletteQuery(''); };
  const paletteCommands = useMemo(() => [
    { id: 'new-tab', label: t('newSession') || 'New tab', action: handleAddTab },
    { id: 'settings', label: t('settings'), action: () => setIsSettingsOpen(true) },
    { id: 'find', label: t('findInTerminal'), action: openTerminalSearch },
    { id: 'files', label: t('quickOpenFiles'), action: openFilePicker },
  ], [t, handleAddTab, setIsSettingsOpen, openTerminalSearch, openFilePicker]);

  return (
    /* fallback 이 null 이면 청크가 오는 동안 화면에 **아무것도** 안 뜬다 — 클릭이 먹었는지
       알 수 없어 계속 누르게 된다. 모달 자리에 스크림+스피너를 먼저 띄운다.

       `resetKey` 는 "지금 무엇이 열려 있나" 다. 모달들이 이 경계 하나를 공유하므로, 경계가
       한 번 걸린 채 굳으면 그 세션에서는 아무 모달도 안 뜬다 — 열림 상태가 바뀔 때마다
       경계를 풀어 **다음 클릭은 다시 시도**하게 한다. */
    <LazyErrorBoundary
      resetKey={[
        isSettingsOpen, keyManagerOpen, hostEditorState?.isOpen,
        !!confirmModal, !!notification, isCommandPaletteOpen, isFilePickerOpen,
      ].join('|')}
    >
    <Suspense fallback={<ModalLoading />}>
      {isSettingsOpen && (
        <Settings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          settings={settings}
          onSave={updateSettings}
          username={username}
          hosts={hosts}
          sshKeys={sshKeys}
          refreshHosts={refreshHosts}
          onAddHost={() => { setHostEditorState({ isOpen: true, host: null, reopenSettings: true }); }}
          onEditHost={(h) => { setHostEditorState({ isOpen: true, host: h, reopenSettings: true }); }}
          onEditLocal={() => { setLocalEditorOpen(true); }}
          onAddKey={() => { setEditingKey(null); setKeyManagerOpen(true); }}
          onEditKey={(k) => { setEditingKey(k); setKeyManagerOpen(true); }}
          onLogout={() => { setIsSettingsOpen(false); logout?.(); }}
          t={t}
          globalThemeId={settings.theme}
          language={settings.language}
        />
      )}
      {keyManagerOpen && (
        <SshKeyManager
          isOpen={keyManagerOpen}
          onClose={() => { setKeyManagerOpen(false); setEditingKey(null); }}
          keys={sshKeys}
          onCreate={createKey}
          onUpdate={updateKey}
          onDelete={deleteKey}
          initialEditKey={editingKey}
          t={t}
          language={settings.language}
        />
      )}
      {hostEditorState.isOpen && (
        <HostEditor
          isOpen={hostEditorState.isOpen}
          host={hostEditorState.host}
          sshKeys={sshKeys}
          zIndex={hostEditorState.reopenSettings ? 200002 : undefined}
          onSave={async (data) => {
            if (hostEditorState.host) await updateHost(hostEditorState.host.id, data);
            else await createHost(data);
            await refreshHosts();
            setHostEditorState({ isOpen: false, host: null });
          }}
          onDelete={async () => {
            const target = hostEditorState.host;
            if (!target) return;
            await deleteHost(target.id);
            await refreshHosts();
            setHostEditorState({ isOpen: false, host: null });
          }}
          onKillTmuxServer={async (h) => {
            await fetch(`/api/hosts/${h.id}/kill-tmux?force=true`, {
              method: 'POST', headers: authHeaders(),
            });
            setNotification({ isOpen: true, message: t('killTmuxServerDone') || 'Remote tmux server killed.' });
          }}
          onClose={() => {
            setHostEditorState({ isOpen: false, host: null });
          }}
          t={t}
          language={settings.language}
        />
      )}
      {confirmModal.isOpen && (
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          titleIcon={confirmModal.titleIcon}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          cancelText={confirmModal.cancelText}
          tertiaryText={confirmModal.tertiaryText}
          danger={!!confirmModal.danger}
          onConfirm={handleConfirmModal}
          onCancel={() => setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null })}
          onTertiary={confirmModal.onTertiary
            ? async () => {
                await confirmModal.onTertiary?.();
                setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
              }
            : undefined}
          language={settings.language}
        />
      )}
      {notification.isOpen && (
        <NotificationModal
          isOpen={notification.isOpen}
          message={notification.message}
          onClose={() => setNotification({ isOpen: false, message: '' })}
          t={t}
        />
      )}
      {isCommandPaletteOpen && (
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          query={paletteQuery}
          onQueryChange={setPaletteQuery}
          commands={paletteCommands}
          onExecute={(id) => {
            const command = paletteCommands.find((c) => c.id === id);
            closeCommandPalette();
            command?.action();
          }}
          onClose={closeCommandPalette}
          placeholder={t('commandPalettePlaceholder') || 'Type a command...'}
          emptyLabel={t('commandPaletteEmpty') || 'No commands found'}
        />
      )}
      {isFilePickerOpen && (
        <CommandPalette
          isOpen={isFilePickerOpen}
          query={filePickerQuery}
          onQueryChange={setFilePickerQuery}
          commands={filePickerItems.map((item) => ({ id: item.id, label: item.label }))}
          onExecute={(id) => {
            const item = filePickerItems.find((i) => i.id === id);
            if (item) handleFileOpen(item.path);
            setIsFilePickerOpen(false);
          }}
          onClose={() => setIsFilePickerOpen(false)}
          placeholder={t('quickOpenFiles') || 'Quick open files'}
          emptyLabel={isFilePickerLoading ? (t('loading') || 'Loading…') : (t('filePickerEmpty') || 'No files found')}
        />
      )}
    </Suspense></LazyErrorBoundary>
  );
}
