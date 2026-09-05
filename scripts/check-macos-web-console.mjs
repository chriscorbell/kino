import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const binary = process.env.KINO_APP_BINARY ?? resolve('build/macos/Kino.app/Contents/MacOS/Kino');
const marker = `kino-console-${randomUUID()}`;
const server = createServer((request, response) => {
  if (request.url.startsWith('/console.js')) {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`
console.info('${marker}-info');
console.warn('${marker}-warning');
console.error('${marker}-error');
console.warn('${marker}-private-url https://media.invalid/synthetic-token');
console.error('${marker}-private-credential Authorization: Bearer synthetic-secret');
console.info('${marker}-private-email viewer@kino.invalid');
new QWebChannel(qt.webChannelTransport, channel => {
  const lifecycle = channel.objects.kinoLifecycle;
  lifecycle.closeRequested.connect(id => lifecycle.acknowledgeClose(id, true));
  lifecycle.setReady(true);
});`);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><meta charset="utf-8"><title>Console check</title>
<script src="qrc:///qtwebchannel/qwebchannel.js"></script>
<script src="/console.js?token=${marker}-source-private"></script>`);
  }
});
let child;
let timer;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  child = spawn(binary, [], {
    env: {
      ...process.env,
      KINO_UI_URL: `http://127.0.0.1:${server.address().port}`,
      KINO_CLOSE_PROBE: 'window',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => {
    diagnostics += data;
  });
  const result = await Promise.race([
    once(child, 'exit'),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Console probe timed out.')), 15000);
    }),
  ]);
  assert.deepEqual(result, [0, null], 'The native shell must close normally.');
  const file = await readFile(
    resolve(homedir(), 'Library/Application Support/Kino/logs/kino.log'),
    'utf8',
  );
  for (const output of [diagnostics, file]) {
    for (const [suffix, level] of [
      ['info', 'INFO'],
      ['warning', 'WARN'],
      ['error', 'ERROR'],
    ]) {
      const matching = output.split('\n').filter((line) => line.includes(`${marker}-${suffix}`));
      assert.equal(matching.length, 1, `${suffix} must be forwarded exactly once.`);
      assert.ok(matching[0].includes(`[${level}]`), `${suffix} must retain its level.`);
    }
    assert.ok(
      !output.includes(`${marker}-private`),
      'Messages flagged by the sanitizer must be omitted.',
    );
    assert.ok(
      !output.includes(`${marker}-source-private`),
      'Script URL credentials must be omitted.',
    );
  }
  console.log(
    'WebEngine info, warning, and error reach file and stderr once; sensitive messages and source URLs are omitted.',
  );
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
