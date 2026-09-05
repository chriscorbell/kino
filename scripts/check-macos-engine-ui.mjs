#!/usr/bin/env node

// Exercise production QML, WebChannel, and WebEngine CORS with an isolated
// engine cache. The document reports only status values, never its capability.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = resolve(process.env.KINO_APP_BINARY ?? 'build/macos/Kino.app/Contents/MacOS/Kino');
assert.ok(existsSync(binary), 'Build the native app first.');
const root = mkdtempSync(join(tmpdir(), 'kino-engine-ui-'));
let document = '';
let report;
const server = createServer((request, response) => {
  if (request.url === '/ui') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(document);
  } else if (request.url === '/result') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      response.end();
      try {
        report?.(JSON.parse(body));
      } catch {
        report?.({ ok: false, error: 'invalid report' });
      }
    });
  } else {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const serverOrigin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const mode of ['file', 'http']) {
    document = `<!doctype html><meta charset="utf-8"><title>Kino engine check</title>
<style>body{background:#09090a;color:#f4f4f5;font:16px sans-serif;padding:40px}</style>
<p>Checking the engine connection.</p><script src="qrc:///qtwebchannel/qwebchannel.js"></script><script>
function finish(value) {
  fetch(${JSON.stringify(serverOrigin + '/result')}, { method: 'POST', mode: 'no-cors', body: JSON.stringify(value) });
}
new QWebChannel(qt.webChannelTransport, function(channel) {
  const native = channel.objects.kinoNative;
  let handled = false;
  native.streamingEngineChanged.connect(async function(url, error) {
    if (handled) return;
    if (error) { handled = true; finish({ok:false,error:'engine startup'}); return; }
    if (!url) return;
    handled = true;
    try {
      const read = await fetch(url + '/settings');
      const write = await fetch(url + '/settings', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const result = await write.json();
      finish({ok:read.status === 200 && write.status === 200 && result.success === true, read:read.status, write:write.status});
    } catch { finish({ok:false,error:'browser request'}); }
  });
  native.startStreamingEngine();
});
</script>`;
    const path = join(root, `${mode}.html`);
    writeFileSync(path, document);
    let timeout;
    const verdict = new Promise((resolveReport, reject) => {
      report = resolveReport;
      timeout = setTimeout(() => reject(new Error(`${mode} WebEngine probe timed out.`)), 25000);
    });
    const child = spawn(binary, [], {
      env: {
        ...process.env,
        KINO_UI_URL: mode === 'file' ? path : `${serverOrigin}/ui`,
        KINO_ENGINE_CACHE_DIR: join(root, `${mode}-cache`),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // Consume diagnostics so the child cannot block. Do not print arbitrary
    // browser failures, which could contain the URL capability.
    child.stderr.resume();
    const exited = once(child, 'exit');
    try {
      const result = await verdict;
      assert.ok(result.ok, `${mode} WebEngine API result: ${JSON.stringify(result)}`);
      console.log(`${mode} UI: WebChannel capability, CORS read, and preflighted write passed.`);
    } finally {
      clearTimeout(timeout);
      child.kill('SIGTERM');
      const killTimeout = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(killTimeout);
    }
  }
} finally {
  server.closeAllConnections();
  server.close();
  rmSync(root, { recursive: true, force: true });
}
