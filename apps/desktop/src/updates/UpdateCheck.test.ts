import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { compareVersions, latestRelease, RELEASES_URL } from './releases';
import { UpdateCheck, UPDATE_INTERVAL, UPDATE_STORAGE_KEY } from './UpdateCheck';

function release(tag = 'v0.2.0', extra = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    html_url: 'https://untrusted.invalid/download',
    ...extra,
  };
}
function fixture(current = '0.1.0') {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(release()));
  const client = new UpdateCheck(localStorage, fetcher);
  client.initialize(current);
  return { client, fetcher };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('release discovery', () => {
  it('uses semantic version precedence and rejects malformed versions', () => {
    for (const [left, right] of [
      ['0.10.0', '0.9.0'],
      ['1.0.0', '1.0.0-rc.1'],
      ['1.0.0-beta.10', '1.0.0-beta.9'],
      ['1.0.0-beta', '1.0.0-1'],
      ['1.0.0-rc.1', '1.0.0-rc'],
    ])
      expect(compareVersions(left!, right!)).toBe(1);
    expect(compareVersions('v1.0.0+build.1', '1.0.0+build.2')).toBe(0);
    for (const bad of ['1.0', '01.2.3', '1.0.0-01', '1.0.0-', '<script>', '1.0.0/../other'])
      expect(compareVersions(bad, '1.0.0')).toBeNull();
  });

  it('uses the stable channel, shows only newer versions, and constructs a fixed GitHub destination', async () => {
    const { client, fetcher } = fixture();
    await client.check();
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      'https://api.github.com/repos/chriscorbell/kino/releases/latest',
      expect.objectContaining({ credentials: 'omit', redirect: 'error' }),
    );
    expect(client.getSnapshot()).toMatchObject({
      status: 'current',
      currentVersion: '0.1.0',
      notice: true,
      release: { version: '0.2.0', url: `${RELEASES_URL}/tag/v0.2.0` },
    });
    fetcher.mockResolvedValue(Response.json(release('v0.1.0')));
    await client.check(true);
    expect(client.getSnapshot().release).toBeNull();
    fetcher.mockResolvedValue(Response.json(release('v0.3.0-beta.1', { prerelease: true })));
    await client.check(true);
    expect(client.getSnapshot().release).toBeNull();
  });

  it('selects the newest published preview or stable release for a preview build', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json([
          release('v1.0.0-beta.9', { prerelease: true }),
          release('v1.0.0-beta.10', { prerelease: true }),
          release('v2.0.0', { draft: true }),
        ]),
      );
    expect(
      await latestRelease('1.0.0-beta.1', fetcher, new AbortController().signal),
    ).toMatchObject({ version: '1.0.0-beta.10' });
    expect(fetcher.mock.lastCall?.[0]).toBe(
      'https://api.github.com/repos/chriscorbell/kino/releases?per_page=100',
    );
    fetcher.mockResolvedValue(
      Response.json([release('v1.0.0'), release('v1.0.0-rc.1', { prerelease: true })]),
    );
    expect(
      await latestRelease('1.0.0-beta.1', fetcher, new AbortController().signal),
    ).toMatchObject({ version: '1.0.0' });
  });

  it('throttles automatic attempts across restarts while allowing a manual check', async () => {
    const { client, fetcher } = fixture();
    await client.check();
    await client.check();
    const restarted = new UpdateCheck(localStorage, fetcher);
    restarted.initialize('0.1.0');
    await restarted.check();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(restarted.getSnapshot().notice).toBe(true);
    await restarted.check(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + UPDATE_INTERVAL);
    await restarted.check();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('coalesces duplicate requests and bounds an offline request with a deadline', async () => {
    const { client, fetcher } = fixture();
    fetcher.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    );
    const pending = client.check();
    expect(client.check(true)).toBe(pending);
    expect(client.getSnapshot().status).toBe('checking');
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(client.getSnapshot().status).toBe('error');
    await client.check();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats empty, offline, malformed and rate-limited results without losing a known update', async () => {
    const { client, fetcher } = fixture();
    fetcher.mockResolvedValue(new Response(null, { status: 404 }));
    await client.check();
    expect(client.getSnapshot()).toMatchObject({ status: 'unpublished', release: null });
    fetcher.mockResolvedValue(Response.json(release()));
    await client.check(true);
    for (const response of [
      Response.json({}),
      Response.json(release('../evil')),
      new Response(null, { status: 403 }),
      new Response('not-json'),
    ]) {
      fetcher.mockResolvedValue(response);
      await client.check(true);
      expect(client.getSnapshot()).toMatchObject({
        status: 'error',
        release: { version: '0.2.0' },
      });
    }
    fetcher.mockRejectedValue(new TypeError('Offline'));
    await client.check(true);
    expect(client.getSnapshot()).toMatchObject({ status: 'error', release: { version: '0.2.0' } });
  });

  it('persists tomorrow and skip choices, retains manual downloads, and announces a later release', async () => {
    const { client, fetcher } = fixture();
    await client.check();
    client.dismiss();
    let restarted = new UpdateCheck(localStorage, fetcher);
    restarted.initialize('0.1.0');
    expect(restarted.getSnapshot()).toMatchObject({ notice: false, release: { version: '0.2.0' } });
    vi.setSystemTime(Date.now() + UPDATE_INTERVAL);
    fetcher.mockResolvedValue(Response.json(release()));
    await restarted.check();
    expect(restarted.getSnapshot().notice).toBe(true);
    restarted.skip();
    restarted = new UpdateCheck(localStorage, fetcher);
    restarted.initialize('0.1.0');
    expect(restarted.getSnapshot()).toMatchObject({ notice: false, release: { version: '0.2.0' } });
    fetcher.mockResolvedValue(Response.json(release('v0.3.0')));
    await restarted.check(true);
    expect(restarted.getSnapshot().notice).toBe(true);
  });

  it('rejects unsafe stored state and does not report an installed update again', async () => {
    localStorage.setItem(
      UPDATE_STORAGE_KEY,
      JSON.stringify({
        lastAttempt: 'bad',
        releaseTag: 'https://evil.invalid',
        skippedVersion: 123,
      }),
    );
    const { client, fetcher } = fixture();
    await client.check();
    const upgraded = new UpdateCheck(localStorage, fetcher);
    upgraded.initialize('0.2.0');
    expect(upgraded.getSnapshot()).toMatchObject({ notice: false, release: null });
    const brokenStore = {
      getItem: () => {
        throw new Error('Unavailable');
      },
      setItem: () => {
        throw new Error('Unavailable');
      },
    };
    const isolated = new UpdateCheck(
      brokenStore,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(release())),
    );
    isolated.initialize('0.1.0');
    await isolated.check();
    expect(isolated.getSnapshot().notice).toBe(true);
  });
});
