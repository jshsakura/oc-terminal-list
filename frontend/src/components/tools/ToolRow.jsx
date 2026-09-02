import { Check, CircleHelp, Download, Pencil, Trash2, ExternalLink, Copy, Loader2, RefreshCw } from 'lucide-react';
import Button from '../common/Button';
import { tokens } from '../../styles/tokens';
import { toolsStyles as styles } from './toolsStyles';

const { color } = tokens;

/**
 * 도구 한 줄 — 무엇인지, 지금 깔려 있는지, 무엇이 실행될지.
 *
 * ⚠️ **명령을 숨기지 않는다.** 이 버튼이 하는 일은 남의 스크립트를 사용자의 기계에서
 * 실행하는 것이다. 무엇이 실행될지 안 보이면 그건 신뢰해 달라는 요구인데, 이 앱은 그걸
 * 요구할 처지도 이유도 없다 — 어차피 사용자가 터미널에서 직접 확인하고 엔터를 누른다.
 */
const StatusChip = ({ installed, detail, outdated, t }) => {
  if (installed === true) {
    /* ⚠️ **"설치됨" 만으로는 낡았는지 알 수 없다.** 배달 경로는 매번 현재 파일을 밀지만
       설치본은 그때 그 판본이라, 새 기능이 안 되는데 화면은 초록불이었다(실제 신고).
       `outdated` 가 null 이면 **모르는 것**이라 초록불 그대로 둔다. */
    if (outdated === true) {
      return (
        <span style={{ ...styles.chip, color: color.warning }} title={detail || ''}>
          <RefreshCw size={11} strokeWidth={2.2} />
          {t?.('toolOutdated') || '옛 버전'}
        </span>
      );
    }
    return (
      <span style={{ ...styles.chip, color: color.success }} title={detail || ''}>
        <Check size={11} strokeWidth={2.4} />
        {t?.('toolInstalled') || '설치됨'}
      </span>
    );
  }
  if (installed === false) {
    return <span style={styles.chip}>{t?.('toolNotInstalled') || '없음'}</span>;
  }
  /* ⚠️ "모름" 은 "안 깔림" 이 아니다. 못 닿은 호스트를 안 깔린 것으로 그리면
     사용자는 실패할 설치 버튼을 누른다. */
  return (
    <span style={styles.chip} title={t?.('toolUnknownHint') || '확인하지 못했습니다'}>
      <CircleHelp size={11} strokeWidth={2} />
      {t?.('toolUnknown') || '모름'}
    </span>
  );
};

/**
 * Push-installed tool (`install_kind: 'push'`): the backend places one file, so there is
 * no command to show — the *path* is what gets shown, and the actions are "put the file
 * there" / "delete that file". The chip decides which of the two makes sense; when the
 * check could not run (unknown) both are offered, because either is safe to repeat.
 */
const PushActions = ({ state, busy, onPush, onUnpush, t }) => (
  <>
    {/* 낡았으면 **덮어쓰는 것이 할 일**이라 같은 버튼을 이름만 바꿔 내민다. */}
    {(state?.installed !== true || state?.outdated === true) && (
      <Button variant="primary" size="small" type="button" icon={busy ? Loader2 : Download}
        disabled={busy} onClick={onPush}>
        {busy
          ? (t?.('toolPushing') || '설치 중…')
          : (state?.outdated === true
            ? (t?.('toolUpdate') || '업데이트')
            : (t?.('toolPush') || '설치'))}
      </Button>
    )}
    {state?.installed !== false && (
      <Button variant="ghost" size="small" type="button" icon={busy ? Loader2 : Trash2}
        disabled={busy} onClick={onUnpush}>
        {busy ? (t?.('toolUnpushing') || '제거 중…') : (t?.('toolUnpush') || '제거')}
      </Button>
    )}
  </>
);

const TypedActions = ({ copied, onInstall, onCopy, t }) => (
  <>
    <Button variant="primary" size="small" type="button" icon={Download} onClick={onInstall}>
      {t?.('toolInstall') || '터미널에서 설치'}
    </Button>
    <Button variant="ghost" size="small" type="button" icon={copied ? Check : Copy} onClick={onCopy}>
      {copied ? (t?.('copied') || '복사됨') : (t?.('copyCommand') || '명령 복사')}
    </Button>
  </>
);

const ToolRow = ({
  tool, state, onInstall, onEdit, onDelete, onCopy, copied, t,
  onPush, onUnpush, busy = false,
}) => {
  const isPush = tool.install_kind === 'push';
  return (
  <div style={styles.row}>
    <div style={styles.rowHead}>
      <span style={styles.name}>{tool.name}</span>
      {tool.url && (
        <a href={tool.url} target="_blank" rel="noreferrer" style={styles.link}>
          <ExternalLink size={10} strokeWidth={2} style={{ verticalAlign: '-1px' }} />
        </a>
      )}
      <span style={styles.spacer} />
      <StatusChip installed={state?.installed} detail={state?.detail}
        outdated={state?.outdated} t={t} />
    </div>

    {tool.description && <div style={styles.desc}>{tool.description}</div>}
    {isPush ? (
      <code style={styles.cmd} title={t?.('toolPushHint') || '파일 하나를 이 자리에 놓습니다. 제거하면 그 파일만 지웁니다.'}>
        {tool.install_path}
      </code>
    ) : (
      <code style={styles.cmd}>{tool.install_command}</code>
    )}

    <div style={styles.actions}>
      {isPush
        ? <PushActions state={state} busy={busy} onPush={onPush} onUnpush={onUnpush} t={t} />
        : <TypedActions copied={copied} onInstall={onInstall} onCopy={onCopy} t={t} />}
      <span style={styles.spacer} />
      {!tool.builtin && (
        <>
          <Button variant="ghost" size="small" type="button" icon={Pencil} onClick={onEdit}>
            {t?.('edit') || '편집'}
          </Button>
          <Button variant="ghost" size="small" type="button" icon={Trash2} onClick={onDelete}>
            {t?.('delete') || '삭제'}
          </Button>
        </>
      )}
    </div>
  </div>
  );
};

export default ToolRow;
