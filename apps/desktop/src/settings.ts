export const SETTINGS_STORAGE_KEY = 'kino.settings.v1';

export type AudioOutput = 'auto' | 'stereo';

export interface KinoSettings {
  automaticIntroSkipping: boolean;
  audioOutput: AudioOutput;
  skipIntroButton: boolean;
  subtitlePosition: number;
  subtitleSize: number;
  subtitles: boolean;
  upNext: boolean;
  volume: number;
}

export const subtitlePositionRange = { max: 94, min: 50 } as const;
export const subtitleSizeRange = { max: 200, min: 50 } as const;

export const defaultSettings: KinoSettings = {
  automaticIntroSkipping: false,
  audioOutput: 'auto',
  skipIntroButton: true,
  subtitlePosition: 94,
  subtitleSize: 100,
  subtitles: false,
  upNext: true,
  volume: 100,
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
      upNext: typeof values.upNext === 'boolean' ? values.upNext : defaultSettings.upNext,
      volume: boundedNumber(values.volume, { min: 0, max: 100 }, defaultSettings.volume),
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
