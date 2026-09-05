import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { locales, resolveLocaleTag } from '../apps/desktop/src/locales/index.ts';

const destination = process.argv[2];
if (!destination) throw new Error('Pass the generated NativeLocale.js destination.');
const native = Object.fromEntries(
  Object.entries(locales).map(([tag, messages]) => [tag, messages.native]),
);
// Keep the fallback UI inside the executable, independent of the web files.
// The resolver is the same function the web UI uses, serialized after Node
// strips its TypeScript types.
const source = `.pragma library
var locales = ${JSON.stringify(native, null, 2)};
var fallbackTag = "en-US";
${resolveLocaleTag.toString()}
function messages(preferred) { return locales[resolveLocaleTag(preferred)]; }
`;
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, source);
