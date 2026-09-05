import { useEffect, useRef, useState } from 'react';

import styles from '../App.module.css';
import { t } from '../locales';
import { openExternalUrl } from '../native/externalNavigation';
import { nativeShellPresent } from '../native/player';

export function ExternalSourceDialog({ url, onClose }: { url: URL; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const active = useRef(false);
  const opening = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    active.current = true;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      active.current = false;
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return (
    <dialog
      aria-labelledby="external-source-title"
      aria-describedby="external-source-description external-source-url"
      className={`${styles.accountDialog} ${styles.externalDialog}`}
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!opening.current) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
        const dialog = event.currentTarget;
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]'),
        ).filter((control) => control.tabIndex >= 0 && control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === dialog)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === dialog)
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <h2 id="external-source-title">{t.details.externalConfirm}</h2>
      <p id="external-source-description">{t.details.externalDescription}</p>
      <strong className={styles.externalHost}>{url.host}</strong>
      <p className={styles.externalUrl} id="external-source-url" tabIndex={0}>
        {url.href}
      </p>
      {failed ? (
        <p className={styles.formError} role="alert">
          {t.details.externalFailed}
        </p>
      ) : null}
      <div className={styles.externalActions}>
        <button
          className={styles.secondaryAction}
          disabled={pending}
          onClick={onClose}
          ref={cancelRef}
          type="button"
        >
          {t.actions.cancel}
        </button>
        <a
          aria-disabled={pending || undefined}
          className={styles.primaryAction}
          href={url.href}
          rel="noopener noreferrer"
          tabIndex={pending ? -1 : undefined}
          target="_blank"
          onClick={(event) => {
            if (opening.current) {
              event.preventDefault();
              return;
            }
            if (!nativeShellPresent()) {
              // Keep the link mounted until the browser performs its default action.
              window.setTimeout(() => {
                if (active.current) onClose();
              }, 0);
              return;
            }
            event.preventDefault();
            opening.current = true;
            setPending(true);
            setFailed(false);
            void openExternalUrl(url.href)
              .then(() => {
                if (active.current) onClose();
              })
              .catch(() => {
                if (active.current) setFailed(true);
              })
              .finally(() => {
                opening.current = false;
                if (active.current) setPending(false);
              });
          }}
        >
          {pending ? t.details.externalOpening : t.details.openExternal}
        </a>
      </div>
    </dialog>
  );
}
