import { Check, CircleHelp, Download, Pencil, Trash2, ExternalLink, Copy } from 'lucide-react';
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
const StatusChip = ({ installed, detail, t }) => {
  if (installed === true) {
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

const ToolRow = ({ tool, state, onInstall, onEdit, onDelete, onCopy, copied, t }) => (
  <div style={styles.row}>
    <div style={styles.rowHead}>
      <span style={styles.name}>{tool.name}</span>
      {tool.url && (
        <a href={tool.url} target="_blank" rel="noreferrer" style={styles.link}>
          <ExternalLink size={10} strokeWidth={2} style={{ verticalAlign: '-1px' }} />
        </a>
      )}
      <span style={styles.spacer} />
      <StatusChip installed={state?.installed} detail={state?.detail} t={t} />
    </div>

    {tool.description && <div style={styles.desc}>{tool.description}</div>}
    <code style={styles.cmd}>{tool.install_command}</code>

    <div style={styles.actions}>
      <Button variant="primary" size="small" type="button" icon={Download} onClick={onInstall}>
        {t?.('toolInstall') || '터미널에서 설치'}
      </Button>
      <Button variant="ghost" size="small" type="button" icon={copied ? Check : Copy} onClick={onCopy}>
        {copied ? (t?.('copied') || '복사됨') : (t?.('copyCommand') || '명령 복사')}
      </Button>
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

export default ToolRow;
