import styles from '../App.module.css';
import { t } from '../locales';

export function ResourceFailures({
  names,
  error,
  pending,
  onRetry,
}: {
  names: string[];
  error?: string | null;
  pending: boolean;
  onRetry: () => void;
}) {
  const message = names.length ? t.resources.failed([...new Set(names)].join(', ')) : error;
  return (
    <div aria-live="polite">
      {message ? (
        <>
          <p role="alert" className={styles.loadError}>
            {message}
          </p>
          <button
            className={styles.secondaryButton}
            disabled={pending}
            onClick={onRetry}
            type="button"
          >
            {t.resources.retry}
          </button>
        </>
      ) : null}
    </div>
  );
}
