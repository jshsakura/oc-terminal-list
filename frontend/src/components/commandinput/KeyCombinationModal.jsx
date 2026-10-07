import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Keyboard } from 'lucide-react';
import GlassModal from '../common/GlassModal';
import KeyCombinationInput from './KeyCombinationInput';

export default function KeyCombinationModal({ t, onClose, onAddShortcut, initialKey = '', initialModifiers }) {
  const [footer, setFooter] = useState(null);
  return createPortal(<div data-key-combination-modal onKeyDown={event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }}>
    <GlassModal isOpen onClose={onClose} title={t('registerKeyCombination')} titleIcon={Keyboard}
      closeTitle={t('close')} maxWidth="560px" zIndex={200004}
      bodyStyle={{ minHeight: 0, padding: 0 }}
      footer={<div ref={setFooter} style={{ width: '100%' }} />}>
      <KeyCombinationInput t={t} initialKey={initialKey} initialModifiers={initialModifiers}
        autoFocus={false} showKeyButtons footerTarget={footer} onAddShortcut={onAddShortcut} />
    </GlassModal>
  </div>, document.body);
}
