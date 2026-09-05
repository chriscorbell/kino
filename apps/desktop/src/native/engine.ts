import { connectNativePlayer } from './player';

export interface EngineSettings {
  seedingEnabled: boolean;
  btDownloadSpeedHardLimit: number;
}

const maximumDownloadLimit = 2 ** 31 - 1;

function settingsValue(value: unknown): EngineSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid engine settings.');
  const candidate = value as Partial<EngineSettings>;
  if (
    typeof candidate.seedingEnabled !== 'boolean' ||
    typeof candidate.btDownloadSpeedHardLimit !== 'number' ||
    !Number.isInteger(candidate.btDownloadSpeedHardLimit) ||
    candidate.btDownloadSpeedHardLimit < 0 ||
    candidate.btDownloadSpeedHardLimit > maximumDownloadLimit
  )
    throw new Error('Invalid engine settings.');
  return {
    seedingEnabled: candidate.seedingEnabled,
    btDownloadSpeedHardLimit: candidate.btDownloadSpeedHardLimit,
  };
}

async function engineUrl(signal: AbortSignal): Promise<string> {
  const native = await connectNativePlayer();
  if (!native) throw new Error('Streaming engine is unavailable.');
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = (error: unknown, url?: string) => {
      native.streamingEngineChanged.disconnect(changed);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve(url!);
    };
    const changed = (url: string, error: string) => {
      if (error) finish(new Error('Streaming engine is unavailable.'));
      else if (url) finish(null, url);
    };
    const aborted = () => finish(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    native.streamingEngineChanged.connect(changed);
    try {
      native.startStreamingEngine();
    } catch (error) {
      finish(error);
    }
  });
}

// Resolve a fresh supervised URL per operation. Cache clearing invalidates the
// capability; keeping an endpoint here would send later writes to a dead helper.
export async function readEngineSettings(signal?: AbortSignal): Promise<EngineSettings> {
  const deadline = AbortSignal.timeout(40_000);
  const operation = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const url = await engineUrl(operation);
  const response = await fetch(`${url}/settings`, { signal: operation });
  if (!response.ok) throw new Error('Engine settings could not be read.');
  const body = (await response.json()) as { values?: unknown };
  return settingsValue(body.values);
}

export async function updateEngineSettings(
  patch: Partial<EngineSettings>,
): Promise<EngineSettings> {
  const signal = AbortSignal.timeout(40_000);
  const url = await engineUrl(signal);
  const response = await fetch(`${url}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    signal,
  });
  if (!response.ok || ((await response.json()) as { success?: unknown }).success !== true) {
    throw new Error('Engine settings could not be saved.');
  }
  // Read back what the active session accepted. Failed writes leave the UI's
  // previous values visible and can be retried without replacing other fields.
  return readEngineSettings(signal);
}
