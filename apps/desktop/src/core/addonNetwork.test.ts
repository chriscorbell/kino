import { describe, expect, it, vi } from 'vitest';

import { addonTransportIssue, createAddonNetwork } from './addonNetwork';

describe('add-on transport policy', () => {
  it('loads catalogs behind HTTPS redirects through the native redirect transport', async () => {
    const url = 'https://addon.invalid/catalog/movie/top.json';
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue({
      type: 'opaqueredirect',
      status: 0,
    } as Response);
    const followRedirect = vi.fn().mockResolvedValue({
      status: 200,
      body: JSON.stringify({ metas: [{ id: 'tt1', name: 'A movie' }] }),
    });
    const network = createAddonNetwork(fetchRequest, false, () => {}, followRedirect);
    const response = await network.coreFetch(new Request(url));
    expect(response.status).toBe(200);
    expect((await response.json()).metas).toHaveLength(1);
    expect(followRedirect).toHaveBeenCalledWith(url);
    expect(
      network.describeAddon({ transportUrl: 'https://addon.invalid/manifest.json' }).transportIssue,
    ).toBeNull();
  });

  it.each([
    { method: 'POST', body: 'synthetic-account-data' },
    { headers: { Authorization: 'synthetic-secret' } },
  ])(
    'does not replay bodies or authorization headers through the redirect transport',
    async (init) => {
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValue({ type: 'opaqueredirect' } as Response);
      const followRedirect = vi.fn();
      const network = createAddonNetwork(fetchRequest, false, undefined, followRedirect);
      expect((await network.coreFetch('https://addon.invalid/resource', init)).status).toBe(403);
      expect(followRedirect).not.toHaveBeenCalled();
    },
  );

  it('keeps a native redirect refusal blocked and clears it after recovery', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ type: 'opaqueredirect' } as Response);
    const followRedirect = vi
      .fn()
      .mockResolvedValueOnce({ status: 403, body: '' })
      .mockResolvedValueOnce({ status: 200, body: '{}' });
    const network = createAddonNetwork(fetchRequest, false, undefined, followRedirect);
    const addon = { transportUrl: 'https://addon.invalid/manifest.json' };
    expect((await network.coreFetch(addon.transportUrl)).status).toBe(403);
    expect(network.describeAddon(addon).transportIssue).toBe('redirect');
    expect((await network.coreFetch(addon.transportUrl)).status).toBe(200);
    expect(network.describeAddon(addon).transportIssue).toBeNull();
  });

  it('gives Core a network failure without triggering its credential-bearing rejection logs', async () => {
    const fetchRequest = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const network = createAddonNetwork(fetchRequest, false);
    const result = await network.coreFetch('https://addon.invalid/synthetic-token/manifest.json');
    expect(result.status).toBe(502);
    const blocked = await network.coreFetch('http://addon.invalid/synthetic-token/manifest.json');
    expect(blocked.status).toBe(403);
    expect(fetchRequest).toHaveBeenCalledOnce();
  });

  it.each([
    'http://remote.invalid/manifest.json',
    'http://localhost.remote.invalid/manifest.json',
    'http://127.0.0.1.remote.invalid/manifest.json',
    'http://192.168.1.1/manifest.json',
    'file:///manifest.json',
    'ftp://remote.invalid/manifest.json',
    'https://account:secret@remote.invalid/manifest.json',
    'not a URL',
  ])('blocks %s before transmission, including in development', async (url) => {
    const fetchRequest = vi.fn<typeof fetch>();
    await expect(createAddonNetwork(fetchRequest, true).fetch(url)).rejects.toThrow();
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it.each(['localhost', '127.0.0.1', '127.20.30.40', '[::1]'])(
    'permits HTTP to %s only in development',
    async (host) => {
      const url = `http://${host}:7000/manifest.json`;
      const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
      await expect(createAddonNetwork(fetchRequest, false).fetch(url)).rejects.toThrow();
      expect(fetchRequest).not.toHaveBeenCalled();
      await createAddonNetwork(fetchRequest, true).fetch(url);
      expect(fetchRequest).toHaveBeenCalledOnce();
      expect(addonTransportIssue(url, true)).toBeNull();
    },
  );

  it('overrides redirect following in Request and init before the network call', async () => {
    const url = 'https://addon.invalid/configuration-token/manifest.json';
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'http://insecure.invalid/manifest.json' },
      }),
    );
    const network = createAddonNetwork(fetchRequest, false);
    await expect(
      network.fetch(new Request(url, { redirect: 'follow' }), { redirect: 'follow' }),
    ).rejects.toThrow('redirects are blocked');
    expect(fetchRequest).toHaveBeenCalledOnce();
    expect(fetchRequest.mock.calls[0]?.[1]?.redirect).toBe('manual');
    expect(network.describeAddon({ transportUrl: url }).transportIssue).toBe('redirect');
    expect(
      network.describeAddon({ transportUrl: 'https://addon.invalid/another-token/manifest.json' })
        .transportIssue,
    ).toBeNull();
  });

  it('reports opaque redirects and clears the block when the request succeeds', async () => {
    const url = 'https://addon.invalid/token/catalog/movie/top.json';
    const onChange = vi.fn();
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({ type: 'opaqueredirect', status: 0 } as Response)
      .mockResolvedValueOnce(Response.json({ metas: [] }));
    const network = createAddonNetwork(fetchRequest, false, onChange);
    const addon = { transportUrl: 'https://addon.invalid/token/manifest.json' };
    await expect(network.fetch(url)).rejects.toThrow('redirects are blocked');
    expect(network.describeAddon(addon).transportIssue).toBe('redirect');
    await network.fetch(url);
    expect(network.describeAddon(addon).transportIssue).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
