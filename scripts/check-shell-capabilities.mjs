// The shell_capabilities CTest, run by each native job against the shell it built. Settings shows
// a setting a shell capability applies only where the bridge reports that capability, so the
// report has to agree with packages/settings/src/schema.ts. The shell must name its own platform
// and report exactly the capabilities the settings the schema lists for that platform need.
import { execFileSync } from 'node:child_process';

import { settingsSchema } from '../packages/settings/src/schema.ts';
import { hostPlatform } from './test-support/host-platform.mjs';

const probe = process.argv[2];
if (!probe) throw new Error('Usage: check-shell-capabilities.mjs <kino_shellcapabilities_probe>');

const report = JSON.parse(execFileSync(probe, { encoding: 'utf8' }));
const { platform } = report;
const reported = new Set(report.capabilities);
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

if (problems.length > 0) {
  for (const problem of problems) console.error(`shell capabilities: ${problem}.`);
  process.exit(1);
}
console.log(
  `shell capabilities: the ${platform} shell reports ${[...reported].join(', ')}, as the schema lists.`,
);
