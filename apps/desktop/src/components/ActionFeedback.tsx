import styles from '../App.module.css';
import { t } from '../locales';
import type { ActionFeedbackState } from './useActionFeedback';

export function ActionFeedback({ action }: { action: ActionFeedbackState }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {action.message ? (
        <p
          className={action.failed ? styles.loadError : styles.settingsNote}
          role={action.failed ? 'alert' : 'status'}
        >
          {action.message}
        </p>
      ) : null}
      {action.failed ? (
        <button className={styles.secondaryButton} onClick={action.retry} type="button">
          {t.actions.retry}
        </button>
      ) : null}
    </div>
  );
}
