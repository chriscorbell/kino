import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = resolve(process.env.KINO_APP_BINARY ?? 'build/macos/Kino.app/Contents/MacOS/Kino');
assert.ok(existsSync(binary), 'Build the native app first.');
const root = mkdtempSync(join(tmpdir(), 'kino-engine-retry-'));
const helper = join(root, 'helper.sh');
writeFileSync(
  helper,
  `#!/bin/sh
if [ ! -f "$KINO_ENGINE_FIXTURE_ATTEMPT" ]; then
  touch "$KINO_ENGINE_FIXTURE_ATTEMPT"
  exit 7
fi
printf 'KINO_ENGINE_READY http://127.0.0.1:12345/kino/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n'
exec /bin/cat >/dev/null
`,
  { mode: 0o700 },
);
let report;
const server = createServer((request, response) => {
  if (request.url === '/result') {
    let body = '';
    request.on('data', (data) => {
      body += data;
    });
    request.on('end', () => {
      response.end();
      try {
        report(JSON.parse(body));
      } catch {
        report({ ok: false });
      }
    });
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><title>Engine retry check</title>
<script src="qrc:///qtwebchannel/qwebchannel.js"></script><script>
new QWebChannel(qt.webChannelTransport, function(channel) {
  const native = channel.objects.kinoNative;
  let retried = false;
  let done = false;
  function finish(ok) {
    if (done) return;
    done = true;
    fetch('/result', { method:'POST', body:JSON.stringify({ok}) });
  }
  native.streamingEngineChanged.connect(function(url, error) {
    if (error) {
      if (retried) return finish(false);
      retried = true;
      setTimeout(function() { native.startStreamingEngine(); }, 0);
    } else if (url) finish(retried);
  });
  native.startStreamingEngine();
});
</script>`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let child;
let timeout;
try {
  const verdict = new Promise((resolveReport, reject) => {
    report = resolveReport;
    timeout = setTimeout(() => reject(new Error('Native engine retry timed out.')), 15000);
  });
  child = spawn(binary, [], {
    env: {
      ...process.env,
      KINO_UI_URL: `http://127.0.0.1:${server.address().port}/ui`,
      KINO_ENGINE_BINARY: helper,
      KINO_ENGINE_FIXTURE_ATTEMPT: join(root, 'attempted'),
      KINO_ENGINE_CACHE_DIR: join(root, 'cache'),
      KINO_ENGINE_CONFIG_DIR: join(root, 'config'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.resume();
  const result = await verdict;
  assert.equal(
    result.ok,
    true,
    'The production WebChannel retry must launch a fresh helper after failure.',
  );
  console.log(
    'Production QML and WebChannel retry recovered from the first helper exiting before readiness.',
  );
} finally {
  clearTimeout(timeout);
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const killTimeout = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(killTimeout);
  }
  server.closeAllConnections();
  server.close();
  rmSync(root, { recursive: true, force: true });
}
