import styles from '../styles/shared.module.css';
import shellStyles from '../styles/shell.module.css';
import { useCore, useCoreRecovery } from '../core/context';
import { t } from '../locales';

export function CoreRecovery({ onGuest }: { onGuest?: () => void }) {
  const { error, selectSession, session, status } = useCore();
  const { retry, retryCatalog, catalogLoading, catalogError } = useCoreRecovery();
  if (status === 'loading' || catalogLoading) {
    return (
      <p role="status" className={styles.inlineEmpty}>
        {status === 'loading' ? t.core.starting : t.core.catalogLoading}
      </p>
    );
  }
  if (!error && !catalogError) return null;
  return (
    <section className={shellStyles.coreRecovery} aria-label={t.core.retry}>
      <p className={styles.loadError} role="alert">
        {error ?? catalogError}
      </p>
      <div className={shellStyles.coreRecoveryActions}>
        <button
          className={styles.secondaryAction}
          onClick={error ? retry : retryCatalog}
          type="button"
        >
          {error ? t.core.retry : t.core.retryCatalog}
        </button>
        {error && session === 'account' ? (
          <button
            className={styles.secondaryAction}
            onClick={() => {
              selectSession('guest');
              onGuest?.();
            }}
            type="button"
          >
            {t.core.guest}
          </button>
        ) : null}
      </div>
    </section>
  );
}
