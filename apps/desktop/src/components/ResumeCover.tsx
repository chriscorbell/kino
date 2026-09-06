import { useLayoutEffect, useRef } from 'react';

import styles from '../App.module.css';
import { t } from '../locales';

export function ResumeCover({ onCancel }: { onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    // Enter the top layer before paint, making browsing inert immediately.
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      aria-label={t.details.loadingPlayback}
      aria-busy="true"
      className={styles.resumeCover}
      ref={dialog}
      onKeyDown={(event) => {
        if (event.key === 'Tab') event.preventDefault();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <span aria-hidden="true" className={styles.resumeSpinner} />
    </dialog>
  );
}
