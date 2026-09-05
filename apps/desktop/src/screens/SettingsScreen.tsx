import { useEffect, useState } from 'react';

import styles from '../App.module.css';
import { SettingSelect, SettingSwitch } from '../components/SettingControls';
import { EngineSettings } from '../components/EngineSettings';
import { ActionFeedback } from '../components/ActionFeedback';
import { useActionFeedback } from '../components/useActionFeedback';
import { updateProfileSettingsAction } from '../core/actions';
import { useCore } from '../core/context';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';
import { connectNativeDiagnostics, nativeShellPresent } from '../native/player';
import { subtitleLanguages } from '../player/subtitles';
import {
  defaultSettings,
  interfaceScales,
  type InterfaceScale,
  type KinoSettings,
} from '../settings';
import type { InterfaceScaleState } from '../native/useInterfaceScale';

import { UpdateSettings } from '../updates/UpdateNotice';
import type { Updates } from '../updates/useUpdates';

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 MB';
  const megabytes = bytes / 1024 ** 2;
  if (megabytes < 1024)
    return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
  return `${(megabytes / 1024).toFixed(1)} GB`;
}

export function SettingsScreen({
  onChange,
  settings,
  updates,
  interfaceScale,
}: {
  onChange: (settings: KinoSettings) => void;
  settings: KinoSettings;
  updates?: Updates;
  interfaceScale?: InterfaceScaleState;
}) {
  const { transport } = useCore();
  const profile = useCoreModel('ctx', null, 'settings-profile');
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const cacheAction = useActionFeedback();
  const logsAction = useActionFeedback();
  const languageAction = useActionFeedback(transport);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const nativeShell = nativeShellPresent();
  const profileSettings = profile.state?.profile.settings;

  const update = <Key extends keyof KinoSettings>(key: Key, value: KinoSettings[Key]) => {
    onChange({ ...settings, [key]: value });
  };

  const updateProfile = (patch: Record<string, string>) => {
    if (!profileSettings || !transport) return;
    languageAction.run(
      async () => {
        // UpdateSettings replaces the record; read current values before retrying.
        const latest = await transport.getState('ctx');
        await transport.dispatch(updateProfileSettingsAction(latest.profile.settings, patch));
        await transport.flush();
      },
      {
        pending: enUS.settings.savingLanguage,
        success: enUS.settings.languageSaved,
        failed: enUS.settings.languageFailed,
      },
    );
  };

  const readCacheSize = () => {
    if (!nativeShell) return;
    void connectNativeDiagnostics()
      .then(async (diagnostics) => {
        if (diagnostics) setCacheBytes(await diagnostics.cacheBytes());
      })
      .catch(() => setCacheBytes(null));
  };

  useEffect(readCacheSize, [nativeShell]);

  const clearCache = () => {
    if (!nativeShell) return;
    cacheAction.run(
      async () => {
        try {
          const diagnostics = await connectNativeDiagnostics();
          if (!diagnostics || !(await diagnostics.clearCache()))
            throw new Error('Cache clear failed.');
        } finally {
          readCacheSize();
        }
      },
      {
        pending: enUS.settings.clearing,
        success: enUS.settings.cacheCleared,
        failed: enUS.settings.cacheClearFailed,
      },
    );
  };

  const copyDiagnosticSummary = () => {
    if (copyStatus === 'copying') return;
    setCopyStatus('copying');
    void connectNativeDiagnostics()
      .then(async (diagnostics) => {
        setCopyStatus(
          diagnostics && (await diagnostics.copyDiagnosticSummary()) ? 'copied' : 'failed',
        );
      })
      .catch(() => setCopyStatus('failed'));
  };

  const revealLogs = () => {
    logsAction.run(
      async () => {
        const diagnostics = await connectNativeDiagnostics();
        if (!diagnostics || !(await diagnostics.revealLogs()))
          throw new Error('Log folder could not be opened.');
      },
      {
        pending: enUS.settings.revealingLogs,
        success: enUS.settings.logsRevealed,
        failed: enUS.settings.revealLogsFailed,
      },
    );
  };

  return (
    <div className={`${styles.page} ${styles.settingsPage}`}>
      <h1>{enUS.settings.title}</h1>
      <section className={styles.settingsGroup} aria-labelledby="appearance-settings-title">
        <h2 id="appearance-settings-title">{enUS.settings.appearance}</h2>
        <div className={`${styles.settingRow} ${styles.scaleRow}`}>
          <label htmlFor="interface-scale">
            <span className={styles.settingLabel}>{enUS.settings.interfaceScale}</span>
            <span className={styles.settingDescription}>
              {enUS.settings.interfaceScaleDescription}
            </span>
          </label>
          <div className={styles.scaleActions}>
            <select
              className={styles.select}
              disabled={!interfaceScale?.available}
              id="interface-scale"
              value={settings.interfaceScale}
              onChange={(event) =>
                update('interfaceScale', Number(event.target.value) as InterfaceScale)
              }
            >
              {interfaceScales.map((percent) => (
                <option key={percent} value={percent}>
                  {percent}%
                </option>
              ))}
            </select>
            <button
              className={styles.secondaryButton}
              disabled={
                !interfaceScale?.available ||
                settings.interfaceScale === defaultSettings.interfaceScale
              }
              onClick={() => update('interfaceScale', defaultSettings.interfaceScale)}
              type="button"
            >
              {enUS.settings.resetScale}
            </button>
          </div>
        </div>
        {interfaceScale?.failed ? (
          <div className={styles.scaleError}>
            <p role="alert">{enUS.settings.scaleFailed}</p>
            <button className={styles.secondaryButton} onClick={interfaceScale.retry} type="button">
              {enUS.settings.retryScale}
            </button>
          </div>
        ) : null}
        {!interfaceScale?.available ? (
          <p className={styles.settingsNote}>{enUS.settings.desktopOnly}</p>
        ) : null}
      </section>
      <UpdateSettings updates={updates} />

      <section className={styles.settingsGroup} aria-labelledby="playback-settings-title">
        <h2 id="playback-settings-title">{enUS.settings.playback}</h2>
        <SettingSwitch
          checked={settings.skipIntroButton}
          description={enUS.settings.skipIntroButtonDescription}
          label={enUS.settings.skipIntroButton}
          onChange={(checked) => update('skipIntroButton', checked)}
        />
        <SettingSwitch
          checked={settings.automaticIntroSkipping}
          description={enUS.settings.automaticIntroSkippingDescription}
          label={enUS.settings.automaticIntroSkipping}
          onChange={(checked) => update('automaticIntroSkipping', checked)}
        />
        <SettingSwitch
          checked={settings.upNext}
          description={enUS.settings.upNextDescription}
          label={enUS.settings.upNext}
          onChange={(checked) => update('upNext', checked)}
        />
        <SettingSelect
          description={enUS.settings.audioOutputDescription}
          id="audio-output"
          label={enUS.settings.audioOutput}
          onChange={(value) => update('audioOutput', value as KinoSettings['audioOutput'])}
          options={[
            { label: enUS.settings.audioAuto, value: 'auto' },
            { label: enUS.settings.audioStereo, value: 'stereo' },
          ]}
          value={settings.audioOutput}
        />
      </section>

      <section className={styles.settingsGroup} aria-labelledby="language-settings-title">
        <h2 id="language-settings-title">{enUS.settings.languages}</h2>
        <p className={styles.settingsNote}>{enUS.settings.languagesNote}</p>
        <SettingSwitch
          checked={settings.subtitles}
          description={enUS.settings.subtitlesDescription}
          label={enUS.settings.subtitles}
          onChange={(checked) => update('subtitles', checked)}
        />
        <SettingSelect
          description={enUS.settings.subtitleLanguageDescription}
          disabled={!profileSettings || !transport || languageAction.pending}
          id="subtitle-language"
          label={enUS.settings.subtitleLanguage}
          onChange={(value) => updateProfile({ subtitlesLanguage: value })}
          options={subtitleLanguages}
          value={profileSettings?.subtitlesLanguage ?? 'eng'}
        />
        <SettingSelect
          description={enUS.settings.audioLanguageDescription}
          disabled={!profileSettings || !transport || languageAction.pending}
          id="audio-language"
          label={enUS.settings.audioLanguage}
          onChange={(value) => updateProfile({ audioLanguage: value })}
          options={subtitleLanguages}
          value={profileSettings?.audioLanguage ?? 'eng'}
        />
        <ActionFeedback action={languageAction} />
      </section>

      <EngineSettings />

      <section className={styles.settingsGroup} aria-labelledby="storage-settings-title">
        <h2 id="storage-settings-title">{enUS.settings.storage}</h2>
        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>{enUS.settings.cache}</div>
            <div className={styles.settingDescription}>{enUS.settings.cacheDescription}</div>
          </div>
          {nativeShell ? (
            <button
              className={styles.secondaryButton}
              disabled={cacheAction.pending}
              aria-busy={cacheAction.pending}
              onClick={clearCache}
              type="button"
            >
              {cacheAction.pending
                ? enUS.settings.clearing
                : `${enUS.settings.clearCache}${cacheBytes === null ? '' : ` (${formatBytes(cacheBytes)})`}`}
            </button>
          ) : (
            <span className={styles.activeValue}>{enUS.settings.desktopOnly}</span>
          )}
        </div>
        <ActionFeedback action={cacheAction} />
      </section>

      <section className={styles.settingsGroup} aria-labelledby="diagnostic-settings-title">
        <h2 id="diagnostic-settings-title">{enUS.settings.diagnostics}</h2>
        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>{enUS.settings.diagnosticSummary}</div>
            <div className={styles.settingDescription}>
              {enUS.settings.diagnosticSummaryDescription}
            </div>
          </div>
          {nativeShell ? (
            <button
              aria-label={enUS.settings.copyDiagnosticSummary}
              aria-busy={copyStatus === 'copying'}
              className={styles.secondaryButton}
              disabled={copyStatus === 'copying'}
              onClick={copyDiagnosticSummary}
              type="button"
            >
              {copyStatus === 'copying' ? enUS.settings.copying : enUS.settings.copy}
            </button>
          ) : (
            <span className={styles.activeValue}>{enUS.settings.desktopOnly}</span>
          )}
        </div>
        {copyStatus === 'copied' ? (
          <p className={styles.settingsNote} role="status">
            {enUS.settings.diagnosticSummaryCopied}
          </p>
        ) : null}
        {copyStatus === 'failed' ? (
          <p className={styles.loadError} role="alert">
            {enUS.settings.diagnosticSummaryFailed}
          </p>
        ) : null}
        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>{enUS.settings.localLogging}</div>
            <div className={styles.settingDescription}>{enUS.settings.localLoggingDescription}</div>
          </div>
          {nativeShell ? (
            <button
              className={styles.secondaryButton}
              disabled={logsAction.pending}
              aria-busy={logsAction.pending}
              onClick={revealLogs}
              type="button"
            >
              {logsAction.pending ? enUS.settings.revealingLogs : enUS.settings.revealLogs}
            </button>
          ) : (
            <span className={styles.activeValue}>{enUS.settings.active}</span>
          )}
        </div>
        <ActionFeedback action={logsAction} />
      </section>
    </div>
  );
}
