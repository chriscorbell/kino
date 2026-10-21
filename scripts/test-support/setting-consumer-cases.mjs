// Planted cases for scripts/check-setting-consumers.mjs. Each plants one change into a small tree
// that passes, and names the setting the check must then report, or null when it must still pass.
// Usage gates in this repository have twice counted a comment as a reader, so the forms that are
// not reads or writers are pinned here beside the ones that are.
const desktop = 'apps/desktop/src';
const tv = 'apps/android-tv/app/src/main/java/app/kino/tv';
const every = { macos: {}, windows: {}, linux: {} };

export const baseline = {
  schema: {
    matchFrameRate: { platforms: every },
    subtitles: { platforms: { ...every, tv: { key: 'subtitles' } } },
    upNext: { platforms: { ...every, tv: { key: 'up_next' } } },
  },
  files: [
    [
      `${desktop}/screens/SettingsScreen.tsx`,
      'export const shown = [settings.matchFrameRate, settings.subtitles, settings.upNext];\n',
    ],
    [
      `${desktop}/screens/PlayerScreen.tsx`,
      'export const play = (settings: KinoSettings) =>\n  settings.upNext && settings.subtitles && settings.matchFrameRate;\n',
    ],
    [
      `${tv}/TvSettings.kt`,
      'fun row(settings: KinoSettingsStore) {\n    val on = settings[KinoSettings.upNext]\n    settings.edit().put(KinoSettings.upNext, !on).commit()\n    settings.edit().putSubtitles(!settings[KinoSettings.subtitles]).commit()\n}\n',
    ],
    [
      `${tv}/TvPlayer.kt`,
      'fun play(settings: KinoSettingsStore) {\n    val upNext = settings[KinoSettings.upNext]\n    val subtitles = settings[KinoSettings.subtitles]\n}\n',
    ],
    [
      `${tv}/TvSubtitles.kt`,
      'internal fun KinoSettingsStore.Editor.putSubtitles(enabled: Boolean) =\n    put(KinoSettings.subtitles, enabled)\n',
    ],
    [
      `${tv}/KinoSettings.kt`,
      'internal object KinoSettings {\n    val subtitles = BooleanSetting("subtitles", false)\n    val upNext = BooleanSetting("up_next", true)\n}\n',
    ],
  ],
};

// A plant changes a map from path to text in place.
const replace = (path, from, to) => (files) => {
  const text = files.get(path);
  if (!text?.includes(from)) throw new Error(`${path} has no ${from}`);
  files.set(path, text.replace(from, to));
};
const add = (path, text) => (files) => files.set(path, `${files.get(path) ?? ''}${text}`);
const combined =
  (...plants) =>
  (files) =>
    plants.forEach((plant) => plant(files));

const player = `${desktop}/screens/PlayerScreen.tsx`;
const noDesktopReader = replace(player, ' && settings.matchFrameRate', '');
const tvPlayer = `${tv}/TvPlayer.kt`;
const noTvReader = replace(tvPlayer, 'settings[KinoSettings.upNext]', 'true');
const secondWriter = (line) =>
  add(`${tv}/TvSubtitlePanel.kt`, `fun off(e: Editor) {\n    ${line}\n}\n`);
const rawRead = (line) => add(`${tv}/TvRaw.kt`, `fun raw(p: SharedPreferences) =\n    ${line}\n`);

export const cases = [
  { label: 'the tree as planted', plant: () => {}, reports: null },

  // Desktop
  {
    label: 'a desktop setting read only by Settings, the #98 shape',
    plant: noDesktopReader,
    reports: 'matchFrameRate',
  },
  {
    label: 'a desktop read only in a line comment',
    plant: combined(noDesktopReader, add(player, '// TODO honor settings.matchFrameRate\n')),
    reports: 'matchFrameRate',
  },
  {
    label: 'a desktop read only in block and doc comments',
    plant: combined(
      noDesktopReader,
      add(player, '/* settings.matchFrameRate */\n/** Reads {@link settings.matchFrameRate}. */\n'),
    ),
    reports: 'matchFrameRate',
  },
  {
    label: 'a desktop read only in string and template text',
    plant: combined(
      noDesktopReader,
      add(
        player,
        "export const a = 'settings.matchFrameRate';\nexport const b = `settings.matchFrameRate`;\n",
      ),
    ),
    reports: 'matchFrameRate',
  },
  {
    label: 'a desktop read only inside typeof',
    plant: combined(
      noDesktopReader,
      add(player, 'export type T = typeof settings.matchFrameRate;\n'),
    ),
    reports: 'matchFrameRate',
  },
  {
    label: 'a desktop read only in a spec file',
    plant: combined(
      noDesktopReader,
      add(
        `${desktop}/screens/PlayerScreen.spec.ts`,
        'expect(settings.matchFrameRate).toBe(false);\n',
      ),
    ),
    reports: 'matchFrameRate',
  },
  {
    label: 'a desktop read inside a template expression still counts',
    plant: combined(
      noDesktopReader,
      add(player, 'export const c = `${settings.matchFrameRate}`;\n'),
    ),
    reports: null,
  },
  {
    label: 'a desktop read only in the text before, between and after template expressions',
    plant: combined(
      noDesktopReader,
      add(
        player,
        'export const d = `settings.matchFrameRate ${1} settings.matchFrameRate ${2} settings.matchFrameRate`;\n',
      ),
    ),
    reports: 'matchFrameRate',
  },
  {
    label: 'a desktop read only in JSX text',
    plant: combined(
      noDesktopReader,
      add(player, 'export const e = <p>settings.matchFrameRate</p>;\n'),
    ),
    reports: 'matchFrameRate',
  },
  {
    label: 'a desktop read only in a regular expression',
    plant: combined(noDesktopReader, add(player, 'export const f = /settings.matchFrameRate/;\n')),
    reports: 'matchFrameRate',
  },

  // TV readers
  {
    label: 'a TV setting read only in TvSettings.kt',
    plant: noTvReader,
    reports: 'upNext',
  },
  {
    label: 'a TV read only in a line comment',
    plant: replace(
      tvPlayer,
      'settings[KinoSettings.upNext]',
      'true // settings[KinoSettings.upNext]',
    ),
    reports: 'upNext',
  },
  {
    label: 'a TV read only in a KDoc comment',
    plant: combined(
      noTvReader,
      add(tvPlayer, '/** Honors [KinoSettings.upNext] someday. */\nval n = 1\n'),
    ),
    reports: 'upNext',
  },
  {
    label: 'a TV read only in string text',
    plant: combined(noTvReader, add(tvPlayer, 'val s = "settings[KinoSettings.upNext]"\n')),
    reports: 'upNext',
  },
  {
    label: 'a TV read only in string text after a raw string ending in a quote',
    plant: combined(
      noTvReader,
      add(tvPlayer, 'val j = """{"a":"b""""\nval s = "settings[KinoSettings.upNext]"\n'),
    ),
    reports: 'upNext',
  },
  {
    label: 'a TV read inside a string template still counts',
    plant: combined(
      noTvReader,
      add(tvPlayer, 'fun s(settings: KinoSettingsStore) = "${settings[KinoSettings.upNext]}"\n'),
    ),
    reports: null,
  },

  // TV writers
  {
    label: 'a TV setting with no writer',
    plant: replace(`${tv}/TvSubtitles.kt`, 'put(KinoSettings.subtitles, enabled)', 'Unit'),
    reports: 'subtitles',
  },
  {
    label: 'a second writer through put',
    plant: secondWriter('e.put(KinoSettings.subtitles, false)'),
    reports: 'subtitles',
  },
  {
    label: 'a second writer through put with the setting named',
    plant: secondWriter('e.put(setting = KinoSettings.subtitles, value = false)'),
    reports: 'subtitles',
  },
  {
    label: 'a second writer through put with the value named first',
    plant: secondWriter('e.put(value = false, setting = KinoSettings.subtitles)'),
    reports: 'subtitles',
  },
  {
    label: 'a second writer through write',
    plant: secondWriter('KinoSettings.subtitles.write(e, false)'),
    reports: 'subtitles',
  },
  {
    label: 'a second writer through the key',
    plant: secondWriter('e.putBoolean(KinoSettings.subtitles.key, false)'),
    reports: 'subtitles',
  },
  {
    label: 'a second writer only in a comment is no writer',
    plant: secondWriter('// e.put(KinoSettings.subtitles, false)'),
    reports: null,
  },

  // TV raw keys
  {
    label: 'a raw get',
    plant: rawRead('p.getBoolean("subtitles", false)'),
    reports: 'subtitles',
  },
  {
    label: 'a raw get across lines',
    plant: rawRead('p.getBoolean(\n        "up_next",\n        true,\n    )'),
    reports: 'upNext',
  },
  {
    label: 'a raw contains',
    plant: rawRead('p.contains("subtitles")'),
    reports: 'subtitles',
  },
  {
    label: 'a raw all lookup',
    plant: rawRead('p.all["up_next"]'),
    reports: 'upNext',
  },
  {
    label: 'a raw remove',
    plant: rawRead('p.edit().remove("subtitles")'),
    reports: 'subtitles',
  },
  {
    label: 'a raw key in a comment is no raw read',
    plant: rawRead('true // p.getBoolean("subtitles", false)'),
    reports: null,
  },
  {
    label: 'a raw get in a file named like the generated one, in another folder',
    plant: add(
      `${tv}/player/KinoSettings.kt`,
      'fun raw(p: SharedPreferences) = p.getBoolean("subtitles", false)\n',
    ),
    reports: 'subtitles',
  },
];
