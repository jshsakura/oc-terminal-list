import { lazy, Suspense } from 'react';
import LazyErrorBoundary from './LazyErrorBoundary';
import { authHeaders } from '../utils/auth';

const Settings = lazy(() => import('./Settings'));
const SshKeyManager = lazy(() => import('./SshKeyManager'));
const HostEditor = lazy(() => import('./HostEditor'));
const ConfirmModal = lazy(() => import('./ConfirmModal'));
const NotificationModal = lazy(() => import('./NotificationModal'));
const CommandPalette = lazy(() => import('./CommandPalette'));

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
  return (
    <LazyErrorBoundary><Suspense fallback={null}>
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
          items={[
            { id: 'new-tab', label: t('newSession') || 'New tab', action: () => { setIsCommandPaletteOpen(false); handleAddTab(); } },
            { id: 'settings', label: t('settings'), action: () => { setIsCommandPaletteOpen(false); setIsSettingsOpen(true); } },
            { id: 'find', label: t('findInTerminal'), action: () => { setIsCommandPaletteOpen(false); openTerminalSearch(); } },
            { id: 'files', label: t('quickOpenFiles'), action: () => { setIsCommandPaletteOpen(false); openFilePicker(); } },
          ]}
          onSelect={(id) => {
            const item = [
              { id: 'new-tab', action: () => handleAddTab() },
              { id: 'settings', action: () => setIsSettingsOpen(true) },
              { id: 'find', action: () => openTerminalSearch() },
              { id: 'files', action: () => openFilePicker() },
            ].find((i) => i.id === id);
            setIsCommandPaletteOpen(false);
            item?.action();
          }}
          onClose={() => setIsCommandPaletteOpen(false)}
          t={t}
          language={settings.language}
        />
      )}
      {isFilePickerOpen && (
        <CommandPalette
          isOpen={isFilePickerOpen}
          items={filePickerItems.map((item) => ({ id: item.id, label: item.label }))}
          query={filePickerQuery}
          onQueryChange={setFilePickerQuery}
          isLoading={isFilePickerLoading}
          onSelect={(id) => {
            const item = filePickerItems.find((i) => i.id === id);
            if (item) handleFileOpen(item.path);
            setIsFilePickerOpen(false);
          }}
          onClose={() => setIsFilePickerOpen(false)}
          t={t}
          language={settings.language}
        />
      )}
    </Suspense></LazyErrorBoundary>
  );
}
