import { X } from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import styles from '../App.module.css';
import { t } from '../locales';

export function SourcePickerDialog({
  children,
  title,
  onClose,
  returnFocus,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement;
    element.showModal();
    close.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      const target =
        trigger instanceof HTMLElement && trigger !== document.body && trigger.isConnected
          ? trigger
          : returnFocus.current;
      target?.focus({ preventScroll: true });
    };
  }, [returnFocus]);
  return (
    <dialog
      aria-labelledby="episode-source-title"
      className={styles.sourcePickerDialog}
      ref={dialog}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], summary, [tabindex="0"]',
          ),
        ).filter((control) => control.tabIndex >= 0 && control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last && first) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles.sourcePickerHeader}>
        <h2 id="episode-source-title">{title}</h2>
        <button
          aria-label={t.details.closeSources}
          className={styles.dialogClose}
          ref={close}
          type="button"
          onClick={onClose}
        >
          <X aria-hidden size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
