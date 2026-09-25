// Drives the native shell through a lost web interface process: the shell must
// reload the interface after a crash, and must not hold Quit for a save that a
// dead interface can never acknowledge.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const binary = resolve(process.env.KINO_APP_BINARY ?? 'build/macos/Kino.app/Contents/MacOS/Kino');
assert.ok(existsSync(binary), 'Build the macOS shell first.');
const root = mkdtempSync(join(tmpdir(), 'kino-interface-'));

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

async function until(read, description, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function run(name, env, check) {
  let loads = 0;
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.url === '/loaded') loads += 1;
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const document = join(root, `${name}.html`);
  // The page reports every load, then tells the shell it owns the save
  // sequence. It never answers a close request, like a page that has died.
  writeFileSync(
    document,
    `<!doctype html><meta charset="utf-8"><title>Kino interface check</title>
<script src="qrc:///qtwebchannel/qwebchannel.js"></script><script>
fetch(${JSON.stringify(origin + '/loaded')}, {method: 'POST'});
new QWebChannel(qt.webChannelTransport, function(channel) {
  channel.objects.kinoLifecycle.setReady(true);
});
</script>`,
  );
  const child = spawn(binary, [], {
    env: { ...process.env, KINO_UI_URL: document, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => {
    diagnostics += data;
  });
  try {
    await check({ child, loads: () => loads, diagnostics: () => diagnostics });
  } catch (error) {
    error.message += `\n${diagnostics}`;
    throw error;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}

try {
  const debugPort = await freePort();
  await run(
    'reload',
    { QTWEBENGINE_REMOTE_DEBUGGING: `127.0.0.1:${debugPort}` },
    async ({ loads, diagnostics }) => {
      await until(() => loads() === 1, 'the first interface load');
      const page = await until(async () => {
        try {
          const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
          return targets.find((target) => target.type === 'page');
        } catch {
          return null;
        }
      }, 'WebEngine debugging');
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      await once(socket, 'open');
      socket.send(JSON.stringify({ id: 1, method: 'Page.crash' }));
      await until(() => loads() === 2, 'the interface to reload after its process crashed');
      assert.match(
        diagnostics(),
        /\[kino:shell\] interface process ended status=\w+ reload=scheduled/,
      );
      socket.close();
      console.log('The shell reloaded the interface after its process crashed.');
    },
  );

  await run('quit', { KINO_CLOSE_PROBE: 'interface-lost' }, async ({ child, diagnostics }) => {
    const started = Date.now();
    const [code] = await Promise.race([
      once(child, 'exit'),
      delay(10000).then(() => {
        throw new Error('Quit was held after the interface process died.');
      }),
    ]);
    assert.equal(code, 0, 'Quit after a lost interface must exit normally.');
    assert.match(diagnostics(), /interface process ended status=\w+/);
    console.log(
      `Quit after the interface process was killed exited in ${Date.now() - started} ms.`,
    );
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
