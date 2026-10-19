import {
  type DesktopPlatform,
  desktopPlatforms,
  type SettingValue,
  settingsSchema,
} from '@kino/settings';

export const SETTINGS_STORAGE_KEY = 'kino.settings.v1';

type Schema = typeof settingsSchema;

type DesktopKey = {
  [Key in keyof Schema]: [Extract<keyof Schema[Key]['platforms'], DesktopPlatform>] extends [never]
    ? never
    : Key;
}[keyof Schema];

type ValueOf<Value extends SettingValue> = Value extends { kind: 'boolean' }
  ? boolean
  : Value extends { kind: 'choice'; values: readonly (infer Choice)[] }
    ? Choice
    : number;

/** Every Kino setting a desktop platform lists, in one record the client keeps on the device. */
export type KinoSettings = { -readonly [Key in DesktopKey]: ValueOf<Schema[Key]['value']> };

const desktopKeys = (Object.keys(settingsSchema) as (keyof Schema)[]).filter((key) =>
  desktopPlatforms.some((platform) => platform in settingsSchema[key].platforms),
) as DesktopKey[];

export const interfaceScales = settingsSchema.interfaceScale.value.values;
export type InterfaceScale = KinoSettings['interfaceScale'];

export const subtitlePositionRange = settingsSchema.subtitlePosition.value;
export const subtitleSizeRange = settingsSchema.subtitleSize.value;

export const defaultSettings = Object.fromEntries(
  desktopKeys.map((key) => [key, settingsSchema[key].value.default]),
) as KinoSettings;

function accepts(value: SettingValue, candidate: unknown) {
  switch (value.kind) {
    case 'boolean':
      return typeof candidate === 'boolean';
    case 'choice':
      return (value.values as readonly unknown[]).includes(candidate);
    case 'range':
      return typeof candidate === 'number' && candidate >= value.min && candidate <= value.max;
  }
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

    return Object.fromEntries(
      desktopKeys.map((key) => {
        const { value } = settingsSchema[key];
        return [key, accepts(value, values[key]) ? values[key] : value.default];
      }),
    ) as KinoSettings;
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
