import type { ContinueWatchingItem, CoreMetaPreview, LibraryItem } from './types';

/**
 * Library and Continue Watching rows carry only the fields Core stores for a
 * saved title. Opening one shows the detail screen, which reloads the full
 * metadata; nothing here is invented to fill the gap.
 */
export function savedTitlePreview(item: ContinueWatchingItem | LibraryItem): CoreMetaPreview {
  return {
    background: null,
    defaultVideoId: null,
    description: null,
    featuredVideoId: null,
    hasScheduledVideos: false,
    id: item.id,
    inLibrary: true,
    logo: null,
    name: item.name,
    poster: item.poster,
    posterShape: item.posterShape,
    releaseInfo: null,
    released: null,
    runtime: null,
    type: item.type,
    watched: false,
  };
}
