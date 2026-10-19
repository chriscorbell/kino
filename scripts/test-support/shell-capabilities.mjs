// Settings shows a setting a shell capability applies only where the bridge reports that
// capability, so a shell's report has to agree with packages/settings/src/schema.ts: it names the
// platform this machine is, and exactly the capabilities the settings the schema lists for that
// platform need.
import { settingsSchema } from '../../packages/settings/src/schema.ts';

const hostPlatform = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform];

/** Each way a shell's `{ platform, capabilities }` report disagrees with the schema. */
export function shellReportProblems({ platform, capabilities }) {
  const reported = new Set(capabilities);
  const problems = [];
  if (platform !== hostPlatform)
    problems.push(`the shell built for ${hostPlatform} names its platform ${platform}`);

  const needed = new Map();
  for (const [key, spec] of Object.entries(settingsSchema)) {
    const consumer = spec.platforms[platform];
    if (consumer?.by !== 'shell') continue;
    needed.set(consumer.capability, [...(needed.get(consumer.capability) ?? []), key]);
  }
  for (const [capability, keys] of needed) {
    if (!reported.has(capability))
      problems.push(
        `the schema lists ${keys.join(', ')} for ${platform}, but the shell does not report ${capability}, which applies it`,
      );
  }
  for (const capability of reported) {
    if (!needed.has(capability))
      problems.push(
        `the shell reports ${capability}, but the schema lists no setting for ${platform} that it applies`,
      );
  }
  return problems;
}
