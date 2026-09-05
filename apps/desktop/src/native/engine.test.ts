import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readEngineSettings, updateEngineSettings } from './engine';
const fixture = vi.hoisted(() => ({
  listeners: new Set<(url: string, error: string) => void>(),
  url: 'http://127.0.0.1:12345/kino/first',
  fetch: vi.fn(),
  start: vi.fn(),
}));
vi.mock('./player', () => ({
  connectNativePlayer: async () => ({
    streamingEngineChanged: {
      connect: (listener: (url: string, error: string) => void) => fixture.listeners.add(listener),
      disconnect: (listener: (url: string, error: string) => void) =>
        fixture.listeners.delete(listener),
    },
    startStreamingEngine: () => fixture.start(),
  }),
}));
const values = { seedingEnabled: true, btDownloadSpeedHardLimit: 0 };
beforeEach(() => {
  vi.clearAllMocks();
  fixture.listeners.clear();
  fixture.start.mockImplementation(() =>
    fixture.listeners.forEach((listener) => listener(fixture.url, '')),
  );
  fixture.fetch.mockResolvedValue(new Response(JSON.stringify({ values })));
  vi.stubGlobal('fetch', fixture.fetch);
});
afterEach(() => vi.unstubAllGlobals());
it('resolves a new capability for writes after cache clearing and reads back accepted values', async () => {
  expect(await readEngineSettings()).toEqual(values);
  fixture.url = 'http://127.0.0.1:23456/kino/restarted';
  fixture.fetch
    .mockResolvedValueOnce(new Response('{"success":true}'))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ values: { ...values, seedingEnabled: false } })),
    );
  expect(await updateEngineSettings({ seedingEnabled: false })).toEqual({
    ...values,
    seedingEnabled: false,
  });
  expect(fixture.fetch).toHaveBeenNthCalledWith(
    2,
    fixture.url + '/settings',
    expect.objectContaining({ method: 'POST', body: '{"seedingEnabled":false}' }),
  );
  expect(fixture.listeners.size).toBe(0);
});
it('unsubscribes cancelled startup and never fetches an old endpoint', async () => {
  fixture.start.mockImplementation(() => undefined);
  const controller = new AbortController();
  const read = readEngineSettings(controller.signal);
  const rejected = expect(read).rejects.toThrow();
  await vi.waitFor(() => expect(fixture.listeners.size).toBe(1));
  controller.abort();
  await rejected;
  expect(fixture.listeners.size).toBe(0);
  expect(fixture.fetch).not.toHaveBeenCalled();
});
it('rejects malformed settings instead of presenting defaults as a successful read', async () => {
  fixture.fetch.mockResolvedValue(
    new Response('{"values":{"seedingEnabled":"true","btDownloadSpeedHardLimit":-1}}'),
  );
  await expect(readEngineSettings()).rejects.toThrow('Invalid engine settings.');
});
