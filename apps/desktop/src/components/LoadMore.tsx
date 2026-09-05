import styles from '../App.module.css';
import { t } from '../locales';

export function LoadMore({
  error,
  loading,
  onLoad,
}: {
  error: boolean;
  loading: boolean;
  onLoad: () => void;
}) {
  return (
    <div className={styles.pagination}>
      {error ? (
        <p className={styles.loadError} role="alert">
          {t.pagination.error}
        </p>
      ) : null}
      <button className={styles.secondaryButton} disabled={loading} onClick={onLoad} type="button">
        {loading ? t.pagination.loading : error ? t.pagination.retry : t.pagination.loadMore}
      </button>
    </div>
  );
}
