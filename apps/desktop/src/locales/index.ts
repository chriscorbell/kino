import { enUS } from './en-US';

export type Locale = typeof enUS;

// Locales are registered here as they are translated. Kino resolves the
// closest match for the device language and falls back to en-US, so a partial
// locale set never leaves the interface without strings.
const locales: Record<string, Locale> = { 'en-US': enUS };
const fallbackTag = 'en-US';

export function resolveLocaleTag(preferred: readonly string[]): string {
  for (const candidate of preferred) {
    if (locales[candidate]) return candidate;
    const language = candidate.split('-')[0];
    const match = Object.keys(locales).find((tag) => tag.split('-')[0] === language);
    if (match) return match;
  }
  return fallbackTag;
}

export const localeTag = resolveLocaleTag(
  typeof navigator === 'undefined' ? [] : navigator.languages,
);

export const t: Locale = locales[localeTag] ?? enUS;
