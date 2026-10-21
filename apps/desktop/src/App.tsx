import {
  Books,
  Compass,
  House,
  MagnifyingGlass,
  SlidersHorizontal,
  Toolbox,
  type Icon,
} from '@phosphor-icons/react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import logo from './assets/kino.svg';
import sharedStyles from './styles/shared.module.css';
import styles from './styles/shell.module.css';
import { CoreRecovery } from './components/CoreRecovery';
import { AccountDialog } from './components/AccountDialog';
import { useCore } from './core/context';
import { savedTitlePreview } from './core/preview';
import type { ResumeRequest } from './core/resume';
import { sourceKey } from './core/sources';
import type { CoreMetaPreview, ProfileState } from './core/types';
import { useCoreModel } from './core/useCoreModel';
import { t as enUS } from './locales';
import { useInterfaceScale } from './native/useInterfaceScale';
import {
  BrowseStateContext,
  initialBrowseState,
  type BrowseScreen,
  type NavigationEntry,
  type UpdateBrowseState,
} from './navigation';
import { usePlaybackHost } from './playback';
import { AddonsScreen } from './screens/AddonsScreen';
import { DiscoverScreen } from './screens/DiscoverScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { MetaDetailsScreen } from './screens/MetaDetailsScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useKinoSettings } from './useKinoSettings';

import { useUpdates } from './updates/useUpdates';
import { UpdateNotice } from './updates/UpdateNotice';

type Screen = BrowseScreen | 'detail';

interface NavigationItem {
  icon: Icon;
  label: string;
  screen: BrowseScreen;
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
  onSelect: (screen: BrowseScreen) => void;
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
  const source = user.name ?? user.email ?? '';
  return source.trim().slice(0, 1).toUpperCase() || '?';
}

export function App() {
  const { transport, session } = useCore();
  const updates = useUpdates();
  const [screen, setScreen] = useState<Screen>('home');
  const [entry, setEntry] = useState<NavigationEntry>(() => ({
    screen: 'home',
    state: initialBrowseState(),
    scrollTop: 0,
    focus: null,
  }));
  const browseMain = useRef<HTMLElement>(null);
  const detailMain = useRef<HTMLElement>(null);
  const playerMain = useRef<HTMLElement>(null);
  const previousView = useRef<string | null>(null);
  const [detail, setDetail] = useState<CoreMetaPreview | null>(null);
  const [detailVideoId, setDetailVideoId] = useState<string | null>(null);
  const [detailSeason, setDetailSeason] = useState<number | null | undefined>(undefined);
  const [detailReturn, setDetailReturn] = useState<{ scrollTop: number; videoId: string } | null>(
    null,
  );
  const [detailTransport, setDetailTransport] = useState(transport);
  const [resumeRequest, setResumeRequest] = useState<ResumeRequest | null>(null);
  const [failedSources, setFailedSources] = useState<ReadonlyMap<string, string>>(new Map());
  const [progressLost, setProgressLost] = useState(false);
  // Every way playback ends arrives here once, after its progress is durable or,
  // when Core had stopped, known to be lost.
  const { session: playback, play } = usePlaybackHost((outcome, selection) => {
    setProgressLost(outcome.unsaved === true);
    switch (outcome.kind) {
      case 'back':
      case 'closed':
        return;
      case 'failed':
        setFailedSources((previous) =>
          new Map(previous).set(
            sourceKey(selection.stream, selection.streamTransportUrl, selection),
            outcome.message,
          ),
        );
        return;
      case 'upNext':
        setDetailVideoId(outcome.video.id);
        setDetailSeason(outcome.video.season);
        setDetailReturn((previous) => ({
          scrollTop: previous?.scrollTop ?? 0,
          videoId: outcome.video.id,
        }));
        setFailedSources(new Map());
        return;
    }
  });
  const [accountOpen, setAccountOpen] = useState(false);
  const profile = useCoreModel('ctx', null, 'app-profile');
  const [settings] = useKinoSettings();
  if (detailTransport !== transport) {
    setDetailTransport(transport);
    setDetailVideoId(null);
    setDetailSeason(undefined);
    setDetailReturn(null);
    setResumeRequest(null);
    setFailedSources(new Map());
  }

  const interfaceScale = useInterfaceScale(settings.interfaceScale);

  const updateBrowseState = useCallback<UpdateBrowseState>((key, value) => {
    setEntry((previous) => ({
      ...previous,
      state: {
        ...previous.state,
        [key]: typeof value === 'function' ? value(previous.state[key]) : value,
      },
    }));
  }, []);
  const browseContext = useMemo(
    () => ({ state: entry.state, update: updateBrowseState }),
    [entry.state, updateBrowseState],
  );

  const navigate = (next: BrowseScreen) => {
    if (next !== entry.screen) {
      setEntry({ screen: next, state: initialBrowseState(), scrollTop: 0, focus: null });
    }
    setScreen(next);
  };

  const openDetail = (item: CoreMetaPreview, videoId?: string | null) => {
    if (screen !== 'detail') {
      const active = document.activeElement;
      const scrollTop = browseMain.current?.scrollTop ?? 0;
      const focus =
        active instanceof HTMLElement && browseMain.current?.contains(active) ? active : null;
      setEntry((previous) => ({ ...previous, scrollTop, focus }));
    }
    setDetail(item);
    setResumeRequest(null);
    setDetailVideoId(videoId ?? null);
    setDetailSeason(undefined);
    setDetailReturn(null);
    setFailedSources(new Map());
    setProgressLost(false);
    setScreen('detail');
  };

  const selectDetailVideo = (videoId: string | null) => {
    if (videoId !== null && detailVideoId === null)
      setDetailReturn({ scrollTop: detailMain.current?.scrollTop ?? 0, videoId });
    setDetailVideoId(videoId);
    setResumeRequest(null);
  };
  const cancelResume = useCallback(() => setResumeRequest(null), []);

  const view = playback
    ? 'player'
    : screen === 'detail'
      ? `detail:${detail?.type}:${detail?.id}:${detailVideoId ?? 'series'}:${session}${resumeRequest ? ':resume' : ''}`
      : screen;
  useLayoutEffect(() => {
    const previous = previousView.current;
    if (previous === view) return;
    previousView.current = view;
    const main =
      view === 'player'
        ? playerMain.current
        : screen === 'detail'
          ? detailMain.current
          : browseMain.current;
    if (!main) return;
    if (
      screen === 'detail' &&
      !playback &&
      detail?.type === 'series' &&
      detailVideoId === null &&
      detailReturn
    ) {
      const restore = () => {
        const episode = [...main.querySelectorAll<HTMLElement>('[data-episode-id]')].find(
          (element) => element.dataset.episodeId === detailReturn.videoId,
        );
        if (!episode || episode.closest('[hidden]')) return false;
        main.scrollTop = detailReturn.scrollTop;
        episode.focus({ preventScroll: true });
        return true;
      };
      if (restore()) return;
      const observer = new MutationObserver(() => {
        if (restore()) observer.disconnect();
      });
      observer.observe(main, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden'],
      });
      return () => observer.disconnect();
    }
    if (screen !== 'detail' && !playback && previous?.startsWith('detail:')) {
      main.scrollTop = entry.scrollTop;
      if (entry.focus?.isConnected && main.contains(entry.focus)) {
        entry.focus.focus({ preventScroll: true });
        // A library update can reorder cards while details is open.
        const card = entry.focus.getBoundingClientRect();
        const region = main.getBoundingClientRect();
        if (card.bottom < region.top || card.top > region.bottom)
          entry.focus.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }
    }
    if (screen === 'detail' && !playback) main.scrollTop = 0;
    const heading = [...main.querySelectorAll<HTMLElement>('h1')].find(
      (element) => !element.closest('[hidden]'),
    );
    const target =
      heading && !heading.classList.contains(sharedStyles.visuallyHidden ?? '') ? heading : main;
    target.tabIndex = -1;
    // WebEngine treats cold-launch focus as keyboard focus. Suppress only this
    // navigation focus, then restore the indicator when the target loses focus.
    target.classList.add(styles.navigationFocus!);
    target.addEventListener('blur', () => target.classList.remove(styles.navigationFocus!), {
      once: true,
    });
    target.focus({ preventScroll: true });
  }, [detail?.type, detailReturn, detailVideoId, entry, playback, screen, view]);

  const content = (() => {
    switch (entry.screen) {
      case 'home':
        return (
          <HomeScreen
            onDiscover={(request) => {
              setEntry({
                screen: 'discover',
                state: { ...initialBrowseState(), discover: request },
                scrollTop: 0,
                focus: null,
              });
              setScreen('discover');
            }}
            onOpen={openDetail}
            onResume={(item) => {
              openDetail(savedTitlePreview(item), item.videoId);
              setResumeRequest({ item, transport });
            }}
          />
        );
      case 'search':
        return <SearchScreen onOpen={openDetail} />;
      case 'discover':
        return <DiscoverScreen onOpen={openDetail} />;
      case 'library':
        return <LibraryScreen onOpen={openDetail} />;
      case 'addons':
        return <AddonsScreen />;
      case 'settings':
        return <SettingsScreen updates={updates} interfaceScale={interfaceScale} />;
    }
  })();

  return (
    <>
      <div className={styles.shell} hidden={Boolean(playback)}>
        <a
          className={styles.skipLink}
          href="#main-content"
          onClick={(event) => {
            event.preventDefault();
            const main = screen === 'detail' ? detailMain.current : browseMain.current;
            main?.classList.remove(styles.navigationFocus!);
            main?.focus();
          }}
        >
          {enUS.navigation.skipToContent}
        </a>
        <aside className={styles.sidebar} aria-label={enUS.navigation.primary}>
          <button
            aria-label={enUS.navigation.kinoHome}
            className={styles.logoButton}
            onClick={() => navigate('home')}
            type="button"
          >
            <img src={logo} alt="" />
          </button>
          <nav className={styles.navGroup}>
            {primaryNavigation.map((item) => (
              <NavigationButton
                active={entry.screen === item.screen}
                item={item}
                key={item.screen}
                onSelect={navigate}
              />
            ))}
          </nav>
          <div className={styles.divider} />
          <nav className={styles.navGroup}>
            {utilityNavigation.map((item) => (
              <NavigationButton
                active={entry.screen === item.screen}
                item={item}
                key={item.screen}
                onSelect={navigate}
              />
            ))}
          </nav>
          <button
            aria-label={profile.state?.profile.auth ? enUS.account.title : enUS.account.signInTitle}
            className={styles.profileButton}
            onClick={() => setAccountOpen(true)}
            title={profile.state?.profile.auth ? enUS.account.title : enUS.account.signInTitle}
            type="button"
          >
            {accountInitial(profile.state)}
          </button>
        </aside>
        {/* Keep the return entry's results and Core subscription alive through details and playback. */}
        <main
          className={styles.content}
          hidden={screen === 'detail'}
          id={screen !== 'detail' ? 'main-content' : undefined}
          key={entry.screen}
          aria-label={
            [...primaryNavigation, ...utilityNavigation].find(
              (item) => item.screen === entry.screen,
            )?.label
          }
          ref={browseMain}
          tabIndex={-1}
        >
          {!playback && screen !== 'detail' ? (
            <>
              {!accountOpen ? <CoreRecovery /> : null}
              <UpdateNotice updates={updates} />
            </>
          ) : null}
          <BrowseStateContext.Provider value={browseContext}>{content}</BrowseStateContext.Provider>
        </main>
        {screen === 'detail' && detail && !playback ? (
          <main
            className={styles.content}
            id="main-content"
            key={`detail:${detail.type}:${detail.id}`}
            aria-label={detail.name}
            ref={detailMain}
            tabIndex={-1}
          >
            {!accountOpen ? <CoreRecovery /> : null}
            {progressLost ? (
              <p className={sharedStyles.loadError} role="alert">
                {enUS.player.progressNotSaved}
              </p>
            ) : null}
            <UpdateNotice updates={updates} />
            <MetaDetailsScreen
              failedSources={failedSources}
              key={`${detail.type}:${detail.id}`}
              initialVideoId={detailVideoId}
              navigation={
                detail.type === 'series'
                  ? {
                      videoId: detailVideoId,
                      season: detailSeason,
                      selectVideo: selectDetailVideo,
                      selectSeason: setDetailSeason,
                    }
                  : undefined
              }
              item={detail}
              resumeRequest={resumeRequest}
              onCancelResume={cancelResume}
              onBack={() => setScreen(entry.screen)}
              onPlay={(selection) => {
                // Details unmounts during playback so Up Next can select a new episode on return.
                setDetailVideoId(selection.video?.id ?? null);
                setResumeRequest(null);
                play(selection);
              }}
            />
          </main>
        ) : null}
        {accountOpen ? <AccountDialog onClose={() => setAccountOpen(false)} /> : null}
      </div>
      {playback ? (
        <main
          className={styles.playbackMain}
          aria-label={playback.selection.meta.name}
          ref={playerMain}
          tabIndex={-1}
        >
          <PlayerScreen session={playback} />
        </main>
      ) : null}
    </>
  );
}
