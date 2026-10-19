// The shell_capabilities CTest, run by each native job against the shell it built. It holds the
// report the shell's probe prints to the settings schema; the scale probe holds the same report,
// read over the real WebChannel, to the same rule.
import { execFileSync } from 'node:child_process';

import { shellReportProblems } from './test-support/shell-capabilities.mjs';

const probe = process.argv[2];
if (!probe) throw new Error('Usage: check-shell-capabilities.mjs <kino_shellcapabilities_probe>');

const report = JSON.parse(execFileSync(probe, { encoding: 'utf8' }));
const problems = shellReportProblems(report);
if (problems.length > 0) {
  for (const problem of problems) console.error(`shell capabilities: ${problem}.`);
  process.exit(1);
}
console.log(
  `shell capabilities: the ${report.platform} shell reports ${report.capabilities.join(', ')}, as the schema lists.`,
);
