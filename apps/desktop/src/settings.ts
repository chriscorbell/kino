export const SETTINGS_STORAGE_KEY = 'kino.settings.v1';

export type AudioOutput = 'auto' | 'stereo';

export interface KinoSettings {
  automaticIntroSkipping: boolean;
  audioOutput: AudioOutput;
  matchFrameRate: boolean;
  skipIntroButton: boolean;
  subtitlePosition: number;
  subtitleSize: number;
  subtitles: boolean;
}

export const subtitlePositionRange = { max: 110, min: 50 } as const;
export const subtitleSizeRange = { max: 200, min: 50 } as const;

export const defaultSettings: KinoSettings = {
  automaticIntroSkipping: false,
  audioOutput: 'auto',
  matchFrameRate: false,
  skipIntroButton: true,
  subtitlePosition: 100,
  subtitleSize: 100,
  subtitles: false,
};

function isAudioOutput(value: unknown): value is AudioOutput {
  return value === 'auto' || value === 'stereo';
}

function boundedNumber(value: unknown, range: { max: number; min: number }, fallback: number) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max
    ? value
    : fallback;
}

export function loadSettings(storage: Pick<Storage, 'getItem'>): KinoSettings {
  let stored: string | null;

  try {
    stored = storage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return defaultSettings;
  }

  if (!stored) {
    return defaultSettings;
  }

  try {
    const candidate: unknown = JSON.parse(stored);

    if (!candidate || typeof candidate !== 'object') {
      return defaultSettings;
    }

    const values = candidate as Record<string, unknown>;

    return {
      automaticIntroSkipping:
        typeof values.automaticIntroSkipping === 'boolean'
          ? values.automaticIntroSkipping
          : defaultSettings.automaticIntroSkipping,
      audioOutput: isAudioOutput(values.audioOutput)
        ? values.audioOutput
        : defaultSettings.audioOutput,
      matchFrameRate:
        typeof values.matchFrameRate === 'boolean'
          ? values.matchFrameRate
          : defaultSettings.matchFrameRate,
      skipIntroButton:
        typeof values.skipIntroButton === 'boolean'
          ? values.skipIntroButton
          : defaultSettings.skipIntroButton,
      subtitlePosition: boundedNumber(
        values.subtitlePosition,
        subtitlePositionRange,
        defaultSettings.subtitlePosition,
      ),
      subtitleSize: boundedNumber(
        values.subtitleSize,
        subtitleSizeRange,
        defaultSettings.subtitleSize,
      ),
      subtitles:
        typeof values.subtitles === 'boolean' ? values.subtitles : defaultSettings.subtitles,
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(storage: Pick<Storage, 'setItem'>, settings: KinoSettings): void {
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    return;
  }
}
