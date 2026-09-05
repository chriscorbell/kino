import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const binary = resolve('build/macos/Kino.app/Contents/MacOS/Kino');
const fixtures = process.env.KINO_FIXTURES_DIR ?? resolve('build/fixtures');
const media = join(fixtures, 'h264-sdr-aac.mp4');
assert.ok(existsSync(binary), 'Build the macOS shell first.');
assert.ok(existsSync(media), 'Generate the legal playback fixtures first.');
const root = mkdtempSync(join(tmpdir(), 'kino-shutdown-'));
try {
  for (const mode of ['window', 'quit']) {
    let child;
    let timeout;
    let requests = 0;
    let snapshot;
    let stillOpenDuringSave = false;
    const server = createServer((request, response) => {
      if (request.url !== '/save') {
        response.writeHead(404).end();
        return;
      }
      requests += 1;
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        snapshot = JSON.parse(body);
        setTimeout(() => {
          stillOpenDuringSave = child.exitCode === null && child.signalCode === null;
          response.setHeader('Access-Control-Allow-Origin', '*');
          response.end('saved');
        }, 500);
      });
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const origin = `http://127.0.0.1:${server.address().port}`;
      const document = join(root, `${mode}.html`);
      writeFileSync(
        document,
        `<!doctype html><meta charset="utf-8"><title>Kino shutdown check</title>
<script src="qrc:///qtwebchannel/qwebchannel.js"></script><script>
new QWebChannel(qt.webChannelTransport, function(channel) {
  const native = channel.objects.kinoNative, lifecycle = channel.objects.kinoLifecycle;
  let ready = false;
  native.playerEvent.connect(function(name, payload) {
    if (!ready && name === 'time' && payload.milliseconds >= 500) {
      ready = true;
      lifecycle.setReady(true);
    }
  });
  lifecycle.closeRequested.connect(async function(id) {
    const snapshot = await native.pauseAndSnapshot();
    await fetch(${JSON.stringify(origin + '/save')}, {method:'POST',body:JSON.stringify(snapshot)});
    native.stop();
    lifecycle.acknowledgeClose(id, true);
  });
  native.load(${JSON.stringify(pathToFileURL(media).href)}, false, {});
});
</script>`,
      );
      child = spawn(binary, [], {
        env: { ...process.env, KINO_UI_URL: document, KINO_CLOSE_PROBE: mode },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let diagnostics = '';
      child.stderr.on('data', (data) => {
        diagnostics += data;
      });
      const result = await Promise.race([
        once(child, 'exit'),
        new Promise((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${mode} shutdown timed out: ${diagnostics}`)),
            15000,
          );
        }),
      ]);
      assert.deepEqual(result, [0, null], `${mode} must exit normally: ${diagnostics}`);
      assert.equal(requests, 1, `${mode} must save exactly once.`);
      assert.equal(stillOpenDuringSave, true, `${mode} must keep WebEngine alive until saved.`);
      assert.ok(
        snapshot.time >= 500 && snapshot.duration > snapshot.time,
        'Capture the actual libmpv position before stopping.',
      );
      console.log(
        `Native ${mode} awaited the save acknowledgement with playback paused at ${snapshot.time} ms.`,
      );
    } finally {
      clearTimeout(timeout);
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
      server.closeAllConnections();
      server.close();
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
