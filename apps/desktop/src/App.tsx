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
import { t as enUS } from './locales';
import { AddonsScreen } from './screens/AddonsScreen';
import { DiscoverScreen } from './screens/DiscoverScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { MetaDetailsScreen } from './screens/MetaDetailsScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
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

// A Stremio account often has no display name, so fall back to the email
// before the guest letter — otherwise a signed-in user looks signed out.
function accountInitial(profile: ProfileState | null) {
  const user = profile?.profile.auth?.user;
  if (!user) return 'G';
  const source = user.name?.trim() || user.email?.trim() || '';
  return source.slice(0, 1).toUpperCase() || '?';
}

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [previousScreen, setPreviousScreen] = useState<Exclude<Screen, 'detail'>>('home');
  const [detail, setDetail] = useState<CoreMetaPreview | null>(null);
  const [detailVideoId, setDetailVideoId] = useState<string | null>(null);
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

  const openDetail = (item: CoreMetaPreview, videoId?: string | null) => {
    if (screen !== 'detail') setPreviousScreen(screen);
    setDetail(item);
    setDetailVideoId(videoId ?? null);
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
        onUpNext={(video) => {
          setDetailVideoId(video.id);
          setFailedSources(new Map());
          setPlayback(null);
        }}
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
        return <LibraryScreen onOpen={openDetail} />;
      case 'addons':
        return <AddonsScreen />;
      case 'settings':
        return <SettingsScreen onChange={setSettings} settings={settings} />;
      case 'detail':
        return detail ? (
          <MetaDetailsScreen
            failedSources={failedSources}
            initialVideoId={detailVideoId}
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
      <a className={styles.skipLink} href="#main-content">
        {enUS.navigation.skipToContent}
      </a>
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
          {accountInitial(profile.state)}
        </button>
      </aside>
      <main className={styles.content} id="main-content" key={screen}>
        {content}
      </main>
      {accountOpen ? <AccountDialog onClose={() => setAccountOpen(false)} /> : null}
    </div>
  );
}
