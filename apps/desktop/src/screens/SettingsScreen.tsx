import { useEffect, useState } from 'react';

import styles from '../App.module.css';
import { updateProfileSettingsAction } from '../core/actions';
import { useCore } from '../core/context';
import type { ProfileState } from '../core/types';
import { useCoreModel } from '../core/useCoreModel';
import { t as enUS } from '../locales';
import { connectNativeDiagnostics, nativeShellPresent } from '../native/player';
import { subtitleLanguages } from '../player/subtitles';
import type { KinoSettings } from '../settings';

interface SettingSwitchProps {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}

function SettingSwitch({ checked, description, label, onChange }: SettingSwitchProps) {
  return (
    <div className={styles.settingRow}>
      <div>
        <div className={styles.settingLabel}>{label}</div>
        <div className={styles.settingDescription}>{description}</div>
      </div>
      <button
        aria-checked={checked}
        aria-label={label}
        className={`${styles.switch} ${checked ? styles.switchChecked : ''}`}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span />
      </button>
    </div>
  );
}

function SettingSelect({
  description,
  id,
  label,
  onChange,
  options,
  value,
}: {
  description: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className={styles.settingRow} htmlFor={id}>
      <span>
        <span className={styles.settingLabel}>{label}</span>
        <span className={styles.settingDescription}>{description}</span>
      </span>
      <select
        className={styles.select}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

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
}: {
  onChange: (settings: KinoSettings) => void;
  settings: KinoSettings;
}) {
  const { transport } = useCore();
  const profile = useCoreModel<ProfileState>('ctx', null, 'settings-profile');
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const nativeShell = nativeShellPresent();
  const profileSettings = profile.state?.profile.settings;

  const update = <Key extends keyof KinoSettings>(key: Key, value: KinoSettings[Key]) => {
    onChange({ ...settings, [key]: value });
  };

  const updateProfile = (patch: Record<string, string>) => {
    if (!profileSettings || !transport) return;
    void transport
      .dispatch(updateProfileSettingsAction({ ...profileSettings, ...patch }))
      .catch((error: unknown) => {
        console.error(
          '[kino:settings] profile update failed',
          error instanceof Error ? error.message : error,
        );
      });
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
    if (!nativeShell || clearing) return;
    setClearing(true);
    void connectNativeDiagnostics()
      .then(async (diagnostics) => {
        if (diagnostics) await diagnostics.clearCache();
      })
      .catch((error: unknown) => {
        console.error(
          '[kino:settings] cache clear failed',
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        setClearing(false);
        readCacheSize();
      });
  };

  const revealLogs = () => {
    void connectNativeDiagnostics()
      .then((diagnostics) => diagnostics?.revealLogs())
      .catch((error: unknown) => {
        console.error(
          '[kino:settings] reveal logs failed',
          error instanceof Error ? error.message : error,
        );
      });
  };

  return (
    <div className={`${styles.page} ${styles.settingsPage}`}>
      <h1>{enUS.settings.title}</h1>

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
          id="subtitle-language"
          label={enUS.settings.subtitleLanguage}
          onChange={(value) => updateProfile({ subtitlesLanguage: value })}
          options={subtitleLanguages}
          value={profileSettings?.subtitlesLanguage ?? 'eng'}
        />
        <SettingSelect
          description={enUS.settings.audioLanguageDescription}
          id="audio-language"
          label={enUS.settings.audioLanguage}
          onChange={(value) => updateProfile({ audioLanguage: value })}
          options={subtitleLanguages}
          value={profileSettings?.audioLanguage ?? 'eng'}
        />
      </section>

      <section className={styles.settingsGroup} aria-labelledby="storage-settings-title">
        <h2 id="storage-settings-title">{enUS.settings.storage}</h2>
        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>{enUS.settings.cache}</div>
            <div className={styles.settingDescription}>{enUS.settings.cacheDescription}</div>
          </div>
          {nativeShell ? (
            <button className={styles.secondaryButton} onClick={clearCache} type="button">
              {clearing
                ? enUS.settings.clearing
                : `${enUS.settings.clearCache}${cacheBytes === null ? '' : ` (${formatBytes(cacheBytes)})`}`}
            </button>
          ) : (
            <span className={styles.activeValue}>{enUS.settings.desktopOnly}</span>
          )}
        </div>
      </section>

      <section className={styles.settingsGroup} aria-labelledby="diagnostic-settings-title">
        <h2 id="diagnostic-settings-title">{enUS.settings.diagnostics}</h2>
        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>{enUS.settings.localLogging}</div>
            <div className={styles.settingDescription}>{enUS.settings.localLoggingDescription}</div>
          </div>
          {nativeShell ? (
            <button className={styles.secondaryButton} onClick={revealLogs} type="button">
              {enUS.settings.revealLogs}
            </button>
          ) : (
            <span className={styles.activeValue}>{enUS.settings.active}</span>
          )}
        </div>
      </section>
    </div>
  );
}
