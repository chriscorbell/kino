// Every page in the shell's main frame receives the WebChannel, including the
// secure store. Drive real navigations from the interface and check that only
// Kino's own interface can load there: files inside the packaged UI directory,
// or the development server's own origin.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const binary = resolve(process.env.KINO_APP_BINARY ?? 'build/macos/Kino.app/Contents/MacOS/Kino');
assert.ok(existsSync(binary), 'Build the macOS shell first.');
const root = mkdtempSync(join(tmpdir(), 'kino-navigation-'));

function page(report, name, next) {
  return `<!doctype html><meta charset="utf-8"><title>${name}</title><script>
fetch(${JSON.stringify(report)} + '?page=${name}', {method: 'POST', mode: 'no-cors'});
${next.map((url, index) => `setTimeout(function() { location.href = ${JSON.stringify(url)}; }, ${(index + 1) * 700});`).join('\n')}
</script>`;
}

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

async function run(name, setup) {
  const loaded = [];
  const reporter = await listen((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/loaded') loaded.push(url.searchParams.get('page'));
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.end();
  });
  const report = `http://127.0.0.1:${reporter.address().port}/loaded`;
  const { ui, expected, cleanup } = await setup(report);
  const child = spawn(binary, [], {
    env: { ...process.env, KINO_UI_URL: ui },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => (diagnostics += data));
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && loaded.length < expected.length) await delay(50);
    // Leave time for any blocked navigation to have loaded had it been allowed.
    await delay(1500);
    assert.deepEqual(loaded, expected, `${name}: only interface pages may load\n${diagnostics}`);
    assert.match(diagnostics, /\[kino:shell\] navigation blocked outside the interface/);
    console.log(`${name}: loaded ${expected.join(', ')} and blocked everything else.`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    reporter.closeAllConnections();
    reporter.close();
    await cleanup?.();
  }
}

try {
  await run('packaged interface', async (report) => {
    const ui = join(root, 'ui');
    mkdirSync(ui);
    const outside = pathToFileURL(join(root, 'outside.html')).href;
    const inside = pathToFileURL(join(ui, 'inside.html')).href;
    writeFileSync(join(root, 'outside.html'), page(report, 'outside', []));
    writeFileSync(join(ui, 'index.html'), page(report, 'index', [outside, inside]));
    writeFileSync(join(ui, 'inside.html'), page(report, 'inside', [report + '?page=remote']));
    return { ui: join(ui, 'index.html'), expected: ['index', 'inside'] };
  });

  await run('development interface', async (report) => {
    const pages = new Map();
    const foreign = await listen((request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(page(report, 'foreign', []));
    });
    const foreignUrl = `http://127.0.0.1:${foreign.address().port}/`;
    const development = await listen((request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(pages.get(new URL(request.url, 'http://localhost').pathname) ?? '');
    });
    const origin = `http://127.0.0.1:${development.address().port}`;
    pages.set('/', page(report, 'index', [foreignUrl, `${origin}/settings`]));
    pages.set('/settings', page(report, 'settings', []));
    return {
      ui: `${origin}/`,
      expected: ['index', 'settings'],
      cleanup: async () => {
        for (const server of [foreign, development]) {
          server.closeAllConnections();
          server.close();
        }
      },
    };
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}
