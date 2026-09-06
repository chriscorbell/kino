export type AddonTransportIssue = 'invalid' | 'insecure' | 'redirect';

export type FollowAddonRedirect = (url: string) => Promise<{ status: number; body: string } | null>;

// Core includes Stremio's companion-service add-on in default and synced
// profiles. Exclude it in Kino without uninstalling it from the user's account.
export function isSupportedAddon(addon: { manifest: { id: string } }) {
  return addon.manifest.id !== 'org.stremio.local';
}

function isLocalFilesRequest(value: string) {
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === 'localhost' ||
      url.hostname === '[::1]' ||
      /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
    return loopback && url.pathname.startsWith('/local-addon/');
  } catch {
    return false;
  }
}

export function addonTransportIssue(
  value: string,
  development: boolean,
): AddonTransportIssue | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalid';
  }
  if (url.username || url.password) return 'invalid';
  if (url.protocol === 'https:') return null;
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (development && url.protocol === 'http:' && loopback) return null;
  return 'insecure';
}

export class AddonTransportError extends Error {
  readonly issue: AddonTransportIssue;

  constructor(issue: AddonTransportIssue) {
    // These messages can pass through Core diagnostics. Never include a URL,
    // since configured add-ons commonly carry account tokens in the path.
    super(
      issue === 'redirect'
        ? 'Add-on redirects are blocked. Use the final HTTPS manifest URL.'
        : 'Add-on requests require HTTPS.',
    );
    this.issue = issue;
  }
}

export function createAddonNetwork(
  fetchRequest: typeof fetch,
  development: boolean,
  onChange = () => {},
  followRedirect?: FollowAddonRedirect,
) {
  const blocked = new Map<string, AddonTransportIssue>();
  const reject = (url: string, issue: AddonTransportIssue): never => {
    if (blocked.get(url) !== issue) {
      blocked.set(url, issue);
      if (blocked.size > 128) blocked.delete(blocked.keys().next().value!);
      onChange();
    }
    throw new AddonTransportError(issue);
  };

  const request: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const issue = addonTransportIssue(url, development);
    if (issue) return reject(url, issue);
    // Browsers conceal redirect destinations. Keep browser fetching manual so
    // only a transport that can validate each destination may follow them.
    let response = await fetchRequest(input, { ...init, redirect: 'manual' });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      // Only the native transport can inspect each redirect before following
      // it. Replaying POST bodies or caller-supplied headers is not supported.
      const original = new Request(input, init);
      const headers = [...original.headers.keys()];
      const canReplay = original.method === 'GET' && headers.every((name) => name === 'accept');
      const followed = canReplay ? await followRedirect?.(url) : null;
      original.signal.throwIfAborted();
      if (!followed || followed.status === 403) return reject(url, 'redirect');
      response = new Response(followed.body || null, { status: followed.status });
    }
    if (blocked.delete(url)) onChange();
    return response;
  };

  return {
    fetch: request,
    // Core logs the full request URL and body when fetch rejects. Local HTTP
    // errors preserve failure handling without logging configured add-on
    // tokens or account request bodies (403 for policy, 502 for network).
    coreFetch: (async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (isLocalFilesRequest(url)) return new Response(null, { status: 403 });
      try {
        return await request(input, init);
      } catch (error) {
        return new Response(null, { status: error instanceof AddonTransportError ? 403 : 502 });
      }
    }) as typeof fetch,
    describeAddon<Addon extends { transportUrl: string }>(addon: Addon) {
      let issue = addonTransportIssue(addon.transportUrl, development);
      if (!issue) {
        const base = new URL('.', addon.transportUrl).href;
        issue = [...blocked].find(([url]) => url.startsWith(base))?.[1] ?? null;
      }
      return { ...addon, transportIssue: issue };
    },
  };
}
