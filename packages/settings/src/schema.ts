// Every Kino setting, declared once with the platforms that honor it. The desktop client derives
// its settings record, defaults and validation from this table, and
// scripts/generate-tv-settings.mjs writes the TV's KinoSettings.kt from it. A platform missing from
// a setting's `platforms` does not honor it: the desktop client stores no value for a setting no
// desktop platform lists, and the TV gets no entry to read. ADR 0031 records why.
//
// Node loads this file directly for the generator, so it keeps to TypeScript that Node can strip.

export const desktopPlatforms = ['macos', 'windows', 'linux'] as const;
export type DesktopPlatform = (typeof desktopPlatforms)[number];

export interface BooleanValue {
  readonly kind: 'boolean';
  readonly default: boolean;
}

export type ChoiceValue =
  | { readonly kind: 'choice'; readonly values: readonly string[]; readonly default: string }
  | { readonly kind: 'choice'; readonly values: readonly number[]; readonly default: number };

export interface RangeValue {
  readonly kind: 'range';
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

export type SettingValue = BooleanValue | ChoiceValue | RangeValue;

/** What a native shell can apply, as its bridge reports it to the client. */
export const shellCapabilities = ['interfaceScale', 'refreshRateMatching'] as const;
export type ShellCapability = (typeof shellCapabilities)[number];

/** Who applies a setting on a desktop platform: the React client, or a capability of the shell. */
export type DesktopConsumer =
  { readonly by: 'client' } | { readonly by: 'shell'; readonly capability: ShellCapability };

/** The TV stores booleans as booleans and choices as text, and has nowhere to store a range. */
type TvValue = BooleanValue | ChoiceValue;

interface TvEntry {
  /** The preference name the TV has always stored the setting under. */
  readonly key: string;
  /** The TV's own domain and default, for a setting that means something different there. */
  readonly value?: TvValue;
}

type Platforms<Tv extends TvEntry> = {
  readonly [Platform in DesktopPlatform]?: DesktopConsumer;
} & { readonly tv?: Tv };

/**
 * A setting's `value` is its domain and default on every platform that lists it, unless its TV
 * entry gives its own. A ranged setting the TV honors has to.
 */
export type SettingSpec =
  | { readonly value: TvValue; readonly platforms: Platforms<TvEntry> }
  | { readonly value: RangeValue; readonly platforms: Platforms<Required<TvEntry>> };

const toggle = (fallback: boolean) => ({ kind: 'boolean', default: fallback }) as const;

function choice<const Choice extends string | number>(
  values: readonly Choice[],
  fallback: NoInfer<Choice>,
) {
  return { kind: 'choice', values, default: fallback } as const;
}

const range = (min: number, max: number, fallback: number) =>
  ({ kind: 'range', min, max, default: fallback }) as const;

const client = { by: 'client' } as const;
const shell = (capability: ShellCapability) => ({ by: 'shell', capability }) as const;
const everyDesktop = { macos: client, windows: client, linux: client } as const;

export const settingsSchema = {
  automaticIntroSkipping: {
    value: toggle(false),
    platforms: { ...everyDesktop, tv: { key: 'automatic_intro' } },
  },
  audioOutput: {
    value: choice(['auto', 'stereo'], 'auto'),
    platforms: { ...everyDesktop, tv: { key: 'audio_output' } },
  },
  interfaceScale: {
    value: choice([100, 125, 150, 175, 200], 100),
    platforms: {
      macos: shell('interfaceScale'),
      windows: shell('interfaceScale'),
      linux: shell('interfaceScale'),
    },
  },
  // Wayland does not let an app change the output's mode, so the Linux shell cannot match.
  matchRefreshRate: {
    value: toggle(false),
    platforms: {
      macos: shell('refreshRateMatching'),
      windows: shell('refreshRateMatching'),
      tv: { key: 'match_frame_rate' },
    },
  },
  skipIntroButton: {
    value: toggle(true),
    platforms: { ...everyDesktop, tv: { key: 'skip_intro' } },
  },
  // Subtitle size and position use each client's own scale, and the difference is intended:
  // mpv's sub-scale and sub-pos percentages on desktop, steps of Media3's text size and bottom
  // padding on the TV.
  subtitlePosition: {
    value: range(50, 94, 94),
    platforms: {
      ...everyDesktop,
      tv: { key: 'subtitle_position', value: choice([0, 8, 16], 0) },
    },
  },
  subtitleSize: {
    value: range(50, 200, 100),
    platforms: {
      ...everyDesktop,
      tv: { key: 'subtitle_size', value: choice([75, 100, 125, 150], 100) },
    },
  },
  subtitles: {
    value: toggle(false),
    platforms: { ...everyDesktop, tv: { key: 'subtitles' } },
  },
  upNext: {
    value: toggle(true),
    platforms: { ...everyDesktop, tv: { key: 'up_next' } },
  },
  volume: {
    value: range(0, 100, 100),
    platforms: everyDesktop,
  },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof settingsSchema;

/** Where the desktop client runs: a native shell on one of the desktop platforms, or a browser. */
export type ClientPlatform = DesktopPlatform | 'web';

/**
 * Whether Settings offers a setting: the platform honors it, and the shell reports the capability
 * that applies it. The web build is the client without a shell, so it offers what the client
 * applies on every desktop platform and nothing that needs a shell.
 */
export function settingShown(
  key: SettingKey,
  platform: ClientPlatform,
  capabilities: ReadonlySet<ShellCapability>,
): boolean {
  const platforms: Platforms<TvEntry> = settingsSchema[key].platforms;
  if (platform === 'web') return desktopPlatforms.every((each) => platforms[each]?.by === 'client');
  const consumer = platforms[platform];
  if (!consumer) return false;
  return consumer.by === 'client' || capabilities.has(consumer.capability);
}
