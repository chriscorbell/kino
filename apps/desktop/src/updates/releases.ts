export const RELEASES_URL = 'https://github.com/chriscorbell/kino/releases';
const API_URL = 'https://api.github.com/repos/chriscorbell/kino/releases';

interface Version {
  numbers: bigint[];
  prerelease: string[];
}

function version(value: string): Version | null {
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value,
    );
  if (!match) return null;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => /^0\d+$/.test(part))) return null;
  return { numbers: match.slice(1, 4).map((part) => BigInt(part!)), prerelease };
}

export function compareVersions(left: string, right: string): number | null {
  const a = version(left);
  const b = version(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index])
      return a.numbers[index]! > b.numbers[index]! ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length)
    return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export class ReleaseChannelUnavailable extends Error {}

export interface Release {
  version: string;
  url: string;
}

// Construct the destination from the validated tag. Response HTML, asset URLs,
// and release notes never become application markup or navigation targets.
export function releaseForTag(tag: unknown): Release | null {
  if (typeof tag !== 'string' || !version(tag)) return null;
  return { version: tag.replace(/^v/, ''), url: `${RELEASES_URL}/tag/${encodeURIComponent(tag)}` };
}

export async function latestRelease(
  current: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<Release | null> {
  const parsed = version(current);
  if (!parsed) throw new Error('Invalid application version.');
  const preview = parsed.prerelease.length > 0;
  const response = await fetcher(`${API_URL}${preview ? '?per_page=100' : '/latest'}`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  if (response.status === 404) throw new ReleaseChannelUnavailable('No public release channel.');
  if (!response.ok) throw new Error('Release check failed.');
  const body: unknown = await response.json();
  if (preview && !Array.isArray(body)) throw new Error('Invalid releases response.');
  const releases = preview ? (body as unknown[]) : [body];
  let latest: Release | null = null;
  for (const item of releases) {
    if (!item || typeof item !== 'object') throw new Error('Invalid release.');
    const data = item as Record<string, unknown>;
    if (typeof data.draft !== 'boolean' || typeof data.prerelease !== 'boolean')
      throw new Error('Invalid release flags.');
    if (data.draft || (!preview && data.prerelease)) continue;
    const release = releaseForTag(data.tag_name);
    if (!release) throw new Error('Invalid release tag.');
    if (!preview && version(release.version)!.prerelease.length) continue;
    if (
      compareVersions(release.version, current)! > 0 &&
      (!latest || compareVersions(release.version, latest.version)! > 0)
    )
      latest = release;
  }
  return latest;
}
