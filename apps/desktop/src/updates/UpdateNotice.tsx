import { useRef, useState } from 'react';

import styles from '../App.module.css';
import { t } from '../locales';
import { openExternalUrl } from '../native/externalNavigation';
import type { Release } from './releases';
import type { Updates } from './useUpdates';

function ReleaseDownload({ release }: { release: Release }) {
  const opening = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <button
        className={styles.secondaryButton}
        disabled={pending}
        onClick={() => {
          if (opening.current) return;
          opening.current = true;
          setPending(true);
          setFailed(false);
          void openExternalUrl(release.url)
            .catch(() => setFailed(true))
            .finally(() => {
              opening.current = false;
              setPending(false);
            });
        }}
        type="button"
      >
        {pending ? t.updates.opening : t.updates.download}
      </button>
      {failed ? (
        <p className={styles.formError} role="alert">
          {t.updates.openFailed}
        </p>
      ) : null}
    </div>
  );
}

export function UpdateNotice({ updates }: { updates: Updates }) {
  const { client, state } = updates;
  if (!state.notice || !state.release) return null;
  return (
    <aside className={styles.updateNotice} aria-label={t.updates.available}>
      <div role="status">
        <strong>{t.updates.availableVersion(state.release.version)}</strong>
        <p>{t.updates.currentVersion(state.currentVersion ?? t.updates.unknownVersion)}</p>
      </div>
      <div className={styles.updateActions}>
        <ReleaseDownload key={state.release.version} release={state.release} />
        <button className={styles.secondaryButton} onClick={client.dismiss} type="button">
          {t.updates.later}
        </button>
        <button className={styles.secondaryButton} onClick={client.skip} type="button">
          {t.updates.skip}
        </button>
      </div>
    </aside>
  );
}

export function UpdateSettings({ updates }: { updates: Updates | undefined }) {
  const state = updates?.state;
  const status = state?.status ?? 'unavailable';
  return (
    <section
      className={`${styles.settingsGroup} ${styles.updateSettings}`}
      aria-labelledby="update-settings-title"
    >
      <h2 id="update-settings-title">{t.updates.title}</h2>
      <div className={styles.settingRow}>
        <div>
          <div className={styles.settingLabel}>
            {t.updates.currentVersion(state?.currentVersion ?? t.updates.unknownVersion)}
          </div>
          <div className={styles.settingDescription}>{t.updates.description}</div>
        </div>
        <button
          className={styles.secondaryButton}
          disabled={status === 'unavailable' || status === 'checking'}
          onClick={() => {
            void updates?.client.check(true);
          }}
          type="button"
        >
          {status === 'checking' ? t.updates.checking : t.updates.check}
        </button>
      </div>
      {status === 'error' ? (
        <p className={styles.formError} role="alert">
          {t.updates.failed}
        </p>
      ) : null}
      {status === 'unpublished' ? (
        <p className={styles.settingsNote} role="status">
          {t.updates.unpublished}
        </p>
      ) : null}
      {status === 'unavailable' ? (
        <p className={styles.settingsNote}>{t.updates.unavailable}</p>
      ) : null}
      {state?.release ? (
        <div className={styles.settingRow}>
          <div className={styles.settingLabel} role="status">
            {t.updates.availableVersion(state.release.version)}
          </div>
          <ReleaseDownload key={state.release.version} release={state.release} />
        </div>
      ) : status === 'current' ? (
        <p className={styles.settingsNote} role="status">
          {t.updates.currentRelease}
        </p>
      ) : null}
    </section>
  );
}
