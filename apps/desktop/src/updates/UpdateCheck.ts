import {
  compareVersions,
  latestRelease,
  ReleaseChannelUnavailable,
  releaseForTag,
  type Release,
} from './releases';

export const UPDATE_STORAGE_KEY = 'kino.updates.v1';
export const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT = 10_000;
type Status = 'unavailable' | 'idle' | 'checking' | 'current' | 'error' | 'unpublished';
export interface UpdateSnapshot {
  currentVersion: string | null;
  status: Status;
  release: Release | null;
  notice: boolean;
}
interface Stored {
  lastAttempt: number;
  currentVersion: string | null;
  releaseTag: string | null;
  dismissedUntil: number;
  skippedVersion: string | null;
}

export class UpdateCheck {
  private snapshot: UpdateSnapshot = {
    currentVersion: null,
    status: 'unavailable',
    release: null,
    notice: false,
  };
  private stored: Stored = {
    lastAttempt: 0,
    currentVersion: null,
    releaseTag: null,
    dismissedUntil: 0,
    skippedVersion: null,
  };
  private listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;

  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem'>,
    private fetcher: typeof fetch,
    private now = Date.now,
  ) {
    try {
      const parsed: unknown = JSON.parse(storage.getItem(UPDATE_STORAGE_KEY) ?? 'null');
      if (!parsed || typeof parsed !== 'object') return;
      const value = parsed as Record<string, unknown>;
      for (const key of ['lastAttempt', 'dismissedUntil'] as const) {
        const number = value[key];
        if (
          typeof number === 'number' &&
          Number.isFinite(number) &&
          number >= 0 &&
          number <= now() + UPDATE_INTERVAL
        )
          this.stored[key] = number;
      }
      for (const key of ['currentVersion', 'releaseTag', 'skippedVersion'] as const) {
        const text = value[key];
        if (typeof text === 'string' && compareVersions(text, text) === 0) this.stored[key] = text;
      }
    } catch {
      /* A missing or unavailable local store does not prevent manual checks. */
    }
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  initialize(currentVersion: string) {
    if (compareVersions(currentVersion, currentVersion) !== 0) return;
    const cached =
      this.stored.currentVersion === currentVersion ? releaseForTag(this.stored.releaseTag) : null;
    const release = cached && compareVersions(cached.version, currentVersion)! > 0 ? cached : null;
    this.publish({ currentVersion, release, status: 'idle' });
  }

  check = (manual = false): Promise<void> => {
    if (this.pending) return this.pending;
    const current = this.snapshot.currentVersion;
    this.publish({});
    if (
      !current ||
      (!manual &&
        this.stored.lastAttempt > 0 &&
        this.now() - this.stored.lastAttempt < UPDATE_INTERVAL)
    )
      return Promise.resolve();
    this.stored.lastAttempt = this.now();
    this.save();
    this.publish({ status: 'checking' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT);
    this.pending = latestRelease(current, this.fetcher, controller.signal)
      .then((release) => {
        this.stored.currentVersion = current;
        // Preserve the actual tag spelling in the generated release URL.
        this.stored.releaseTag = release
          ? decodeURIComponent(release.url.split('/').at(-1)!)
          : null;
        this.save();
        this.publish({ release, status: 'current' });
      })
      .catch((error: unknown) => {
        if (error instanceof ReleaseChannelUnavailable) {
          this.stored.currentVersion = current;
          this.stored.releaseTag = null;
          this.save();
          this.publish({ release: null, status: 'unpublished' });
        } else this.publish({ status: 'error' });
      })
      .finally(() => {
        clearTimeout(timeout);
        this.pending = null;
      });
    return this.pending;
  };

  dismiss = () => {
    this.stored.dismissedUntil = this.now() + UPDATE_INTERVAL;
    this.save();
    this.publish({});
  };

  skip = () => {
    this.stored.skippedVersion = this.snapshot.release?.version ?? null;
    this.save();
    this.publish({});
  };

  private save() {
    try {
      this.storage.setItem(UPDATE_STORAGE_KEY, JSON.stringify(this.stored));
    } catch {
      /* Keep in-memory preferences when local storage is unavailable. */
    }
  }

  private publish(patch: Partial<UpdateSnapshot>) {
    const next = { ...this.snapshot, ...patch };
    next.notice = Boolean(
      next.release &&
      next.release.version !== this.stored.skippedVersion &&
      this.now() >= this.stored.dismissedUntil,
    );
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}
