import { useEffect, useState } from 'react';
import styles from '../App.module.css';
import { t } from '../locales';
import {
  readEngineSettings,
  updateEngineSettings,
  type EngineSettings as Values,
} from '../native/engine';
import { nativeShellPresent } from '../native/player';
import { ActionFeedback } from './ActionFeedback';
import { SettingSelect, SettingSwitch } from './SettingControls';
import { useActionFeedback } from './useActionFeedback';

const mebibyte = 1024 ** 2;
const presets = [0, 1, 2, 5, 10, 25, 50].map((value) => value * mebibyte);

export function EngineSettings() {
  const [values, setValues] = useState<Values | null>(null);
  const [readState, setReadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const action = useActionFeedback();
  const native = nativeShellPresent();
  useEffect(() => {
    if (!native) return;
    const controller = new AbortController();
    void readEngineSettings(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setValues(next);
        setReadState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setReadState('failed');
      });
    return () => controller.abort();
  }, [native, attempt]);
  const update = (patch: Partial<Values>) =>
    action.run(
      async () => {
        const next = await updateEngineSettings(patch);
        setValues(next);
      },
      { pending: t.engine.saving, success: t.engine.saved, failed: t.engine.saveFailed },
    );
  const limit = values?.btDownloadSpeedHardLimit ?? 0;
  const options = [...new Set([...presets, limit])]
    .sort((a, b) => a - b)
    .map((value) => ({
      value: String(value),
      label: value === 0 ? t.engine.unlimited : t.engine.rate(value / mebibyte),
    }));
  const disabled = !values || action.pending || readState !== 'ready';
  return (
    <section className={styles.settingsGroup} aria-labelledby="engine-settings-title">
      <h2 id="engine-settings-title">{t.engine.title}</h2>
      {!native ? (
        <p className={styles.settingsNote}>{t.settings.desktopOnly}</p>
      ) : (
        <>
          <p className={styles.settingsNote}>{t.engine.description}</p>
          {readState === 'loading' ? (
            <p role="status" className={styles.settingsNote}>
              {t.engine.loading}
            </p>
          ) : null}
          {readState === 'failed' ? (
            <div>
              <p role="alert" className={styles.loadError}>
                {t.engine.loadFailed}
              </p>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => {
                  setReadState('loading');
                  setAttempt((value) => value + 1);
                }}
              >
                {t.actions.retry}
              </button>
            </div>
          ) : null}
          <SettingSwitch
            checked={values?.seedingEnabled ?? true}
            disabled={disabled}
            description={t.engine.seedingDescription}
            label={t.engine.seeding}
            onChange={(seedingEnabled) => update({ seedingEnabled })}
          />
          <SettingSelect
            description={t.engine.limitDescription}
            disabled={disabled}
            id="engine-download-limit"
            label={t.engine.downloadLimit}
            onChange={(value) => update({ btDownloadSpeedHardLimit: Number(value) })}
            options={options}
            value={String(limit)}
          />
          <ActionFeedback action={action} />
        </>
      )}
    </section>
  );
}
