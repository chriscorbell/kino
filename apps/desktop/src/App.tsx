import {
  Books,
  Compass,
  House,
  MagnifyingGlass,
  SlidersHorizontal,
  Toolbox,
  type Icon,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import logo from './assets/kino.svg';
import styles from './App.module.css';
import { AccountDialog } from './components/AccountDialog';
import type { PlaybackSelection } from './core/actions';
import { sourceKey } from './core/sources';
import type { CoreMetaPreview, ProfileState } from './core/types';
import { useCoreModel } from './core/useCoreModel';
import { enUS } from './locales/en-US';
import { DiscoverScreen } from './screens/DiscoverScreen';
import { HomeScreen } from './screens/HomeScreen';
import { MetaDetailsScreen } from './screens/MetaDetailsScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { SearchScreen } from './screens/SearchScreen';
import { defaultSettings, loadSettings, saveSettings, type KinoSettings } from './settings';

type Screen = 'home' | 'search' | 'discover' | 'library' | 'addons' | 'settings' | 'detail';

interface NavigationItem {
  icon: Icon;
  label: string;
  screen: Screen;
}

const primaryNavigation: NavigationItem[] = [
  { icon: House, label: enUS.navigation.home, screen: 'home' },
  { icon: MagnifyingGlass, label: enUS.navigation.search, screen: 'search' },
  { icon: Compass, label: enUS.navigation.discover, screen: 'discover' },
  { icon: Books, label: enUS.navigation.library, screen: 'library' },
];

const utilityNavigation: NavigationItem[] = [
  { icon: Toolbox, label: enUS.navigation.addons, screen: 'addons' },
  { icon: SlidersHorizontal, label: enUS.navigation.settings, screen: 'settings' },
];

function EmptyState({ children }: { children: string }) {
  return (
    <div className={styles.emptyState}>
      <span>{enUS.status.unavailable}</span>
      <p>{children}</p>
    </div>
  );
}

function LibraryScreen() {
  const [filter, setFilter] = useState<'all' | 'movies' | 'series'>('all');
  const filters = [
    { key: 'all', label: enUS.library.all },
    { key: 'movies', label: enUS.library.movies },
    { key: 'series', label: enUS.library.series },
  ] as const;

  return (
    <div className={styles.page}>
      <h1>{enUS.library.title}</h1>
      <div className={styles.pills} aria-label={enUS.library.filterLabel} role="group">
        {filters.map((item) => (
          <button
            aria-pressed={filter === item.key}
            className={filter === item.key ? styles.pillActive : styles.pill}
            key={item.key}
            onClick={() => setFilter(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <EmptyState>{enUS.library.empty}</EmptyState>
    </div>
  );
}

function AddonsScreen() {
  return (
    <div className={`${styles.page} ${styles.narrowPage}`}>
      <h1>{enUS.addons.title}</h1>
      <p className={styles.lede}>{enUS.addons.description}</p>
      <EmptyState>{enUS.addons.empty}</EmptyState>
    </div>
  );
}

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

interface SettingsScreenProps {
  onChange: (settings: KinoSettings) => void;
  settings: KinoSettings;
}

function SettingsScreen({ onChange, settings }: SettingsScreenProps) {
  const update = <Key extends keyof KinoSettings>(key: Key, value: KinoSettings[Key]) => {
    onChange({ ...settings, [key]: value });
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
          checked={settings.subtitles}
          description={enUS.settings.subtitlesDescription}
          label={enUS.settings.subtitles}
          onChange={(checked) => update('subtitles', checked)}
        />
        <SettingSwitch
          checked={settings.matchFrameRate}
          description={enUS.settings.matchFrameRateDescription}
          label={enUS.settings.matchFrameRate}
          onChange={(checked) => update('matchFrameRate', checked)}
        />
        <label className={styles.settingRow} htmlFor="audio-output">
          <span>
            <span className={styles.settingLabel}>{enUS.settings.audioOutput}</span>
            <span className={styles.settingDescription}>
              {enUS.settings.audioOutputDescription}
            </span>
          </span>
          <select
            className={styles.select}
            id="audio-output"
            onChange={(event) =>
              update('audioOutput', event.target.value as KinoSettings['audioOutput'])
            }
            value={settings.audioOutput}
          >
            <option value="auto">{enUS.settings.audioAuto}</option>
            <option value="stereo">{enUS.settings.audioStereo}</option>
          </select>
        </label>
      </section>
      <section className={styles.settingsGroup} aria-labelledby="diagnostic-settings-title">
        <h2 id="diagnostic-settings-title">{enUS.settings.diagnostics}</h2>
        <div className={styles.settingRow}>
          <div>
            <div className={styles.settingLabel}>{enUS.settings.localLogging}</div>
            <div className={styles.settingDescription}>{enUS.settings.localLoggingDescription}</div>
          </div>
          <span className={styles.activeValue}>{enUS.settings.active}</span>
        </div>
      </section>
    </div>
  );
}

function NavigationButton({
  active,
  item,
  onSelect,
}: {
  active: boolean;
  item: NavigationItem;
  onSelect: (screen: Screen) => void;
}) {
  const IconComponent = item.icon;

  return (
    <button
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      className={`${styles.navButton} ${active ? styles.navButtonActive : ''}`}
      onClick={() => onSelect(item.screen)}
      title={item.label}
      type="button"
    >
      <IconComponent aria-hidden size={20} weight="regular" />
    </button>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [previousScreen, setPreviousScreen] = useState<Exclude<Screen, 'detail'>>('home');
  const [detail, setDetail] = useState<CoreMetaPreview | null>(null);
  const [playback, setPlayback] = useState<PlaybackSelection | null>(null);
  const [failedSources, setFailedSources] = useState<ReadonlyMap<string, string>>(new Map());
  const [accountOpen, setAccountOpen] = useState(false);
  const profile = useCoreModel<ProfileState>('ctx', null, 'app-profile');
  const [settings, setSettings] = useState<KinoSettings>(() =>
    typeof window === 'undefined' ? defaultSettings : loadSettings(window.localStorage),
  );

  useEffect(() => {
    saveSettings(window.localStorage, settings);
  }, [settings]);

  const openDetail = (item: CoreMetaPreview) => {
    if (screen !== 'detail') setPreviousScreen(screen);
    setDetail(item);
    setFailedSources(new Map());
    setScreen('detail');
  };

  const closePlayer = useCallback(() => setPlayback(null), []);
  // Stable across settings re-renders: an unstable identity would restart the
  // player's load effect while a stream is playing.
  const reportSourceFailure = useCallback(
    (message: string) => {
      if (playback) {
        const key = sourceKey(playback.stream, playback.streamTransportUrl);
        setFailedSources((previous) => new Map(previous).set(key, message));
      }
      setPlayback(null);
    },
    [playback],
  );

  if (playback) {
    return (
      <PlayerScreen
        onBack={closePlayer}
        onSettingsChange={setSettings}
        onSourceFailure={reportSourceFailure}
        preferredSubtitleLanguage={profile.state?.profile.settings?.subtitlesLanguage ?? null}
        selection={playback}
        settings={settings}
      />
    );
  }

  const content = (() => {
    switch (screen) {
      case 'home':
        return <HomeScreen onOpen={openDetail} />;
      case 'search':
        return <SearchScreen onOpen={openDetail} />;
      case 'discover':
        return <DiscoverScreen onOpen={openDetail} />;
      case 'library':
        return <LibraryScreen />;
      case 'addons':
        return <AddonsScreen />;
      case 'settings':
        return <SettingsScreen onChange={setSettings} settings={settings} />;
      case 'detail':
        return detail ? (
          <MetaDetailsScreen
            failedSources={failedSources}
            item={detail}
            onBack={() => setScreen(previousScreen)}
            onPlay={setPlayback}
          />
        ) : (
          <HomeScreen onOpen={openDetail} />
        );
    }
  })();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label={enUS.navigation.primary}>
        <button
          aria-label={enUS.navigation.kinoHome}
          className={styles.logoButton}
          onClick={() => setScreen('home')}
          type="button"
        >
          <img src={logo} alt="" />
        </button>
        <nav className={styles.navGroup}>
          {primaryNavigation.map((item) => (
            <NavigationButton
              active={screen === item.screen}
              item={item}
              key={item.screen}
              onSelect={setScreen}
            />
          ))}
        </nav>
        <div className={styles.divider} />
        <nav className={styles.navGroup}>
          {utilityNavigation.map((item) => (
            <NavigationButton
              active={screen === item.screen}
              item={item}
              key={item.screen}
              onSelect={setScreen}
            />
          ))}
        </nav>
        <button
          aria-label={profile.state?.profile.auth ? 'Stremio account' : 'Sign in to Stremio'}
          className={styles.profileButton}
          onClick={() => setAccountOpen(true)}
          title={profile.state?.profile.auth ? 'Stremio account' : 'Sign in to Stremio'}
          type="button"
        >
          {profile.state?.profile.auth?.user.name?.slice(0, 1).toUpperCase() || 'G'}
        </button>
      </aside>
      <main className={styles.content} id="main-content" key={screen}>
        {content}
      </main>
      {accountOpen ? <AccountDialog onClose={() => setAccountOpen(false)} /> : null}
    </div>
  );
}
