import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const root = mkdtempSync(join(tmpdir(), 'kino-addon-transports-'));
let child;
let timeout;
let plain;
let secure;
try {
  const key = join(root, 'key.pem'),
    cert = join(root, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=localhost',
      '-days',
      '1',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore' },
  );
  const requests = [];
  let report;
  plain = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.url === '/result') {
      let body = '';
      request.on('data', (data) => {
        body += data;
      });
      request.on('end', () => {
        response.end();
        report(JSON.parse(body));
      });
      return;
    }
    requests.push(request.url);
    response.end('{}');
  });
  plain.listen(0, '127.0.0.1');
  await once(plain, 'listening');
  const plainOrigin = `http://127.0.0.1:${plain.address().port}`;
  const secureRequests = [];
  secure = createHttpsServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (request, response) => {
      secureRequests.push(request.url);
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: plainOrigin + '/downgrade' }).end();
      } else response.end('{}');
    },
  );
  secure.listen(0, '127.0.0.1');
  await once(secure, 'listening');
  const secureOrigin = `https://127.0.0.1:${secure.address().port}`;
  const network = ts.transpileModule(
    readFileSync('apps/desktop/src/core/addonNetwork.ts', 'utf8'),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    },
  ).outputText;
  writeFileSync(join(root, 'network.js'), network);
  const document = join(root, 'check.html');
  writeFileSync(
    document,
    `<!doctype html><meta charset="utf-8"><title>Kino add-on transport check</title>
<script type="module">
import { createAddonNetwork } from './network.js';
const plain = ${JSON.stringify(plainOrigin)}, secure = ${JSON.stringify(secureOrigin)};
const production = createAddonNetwork(fetch, false), development = createAddonNetwork(fetch, true);
try {
  const results = [];
  for (const url of [plain + '/blocked', secure + '/redirect']) {
    try { await production.fetch(url, {redirect:'follow'}); results.push('allowed'); }
    catch (error) { results.push(error.issue); }
  }
  await production.fetch(secure + '/allowed');
  await development.fetch(plain + '/development');
  await fetch(plain + '/result', {method:'POST',body:JSON.stringify({results})});
} catch (error) {
  await fetch(plain + '/result', {method:'POST',body:JSON.stringify({error:String(error)})});
}
</script>`,
  );
  const verdict = new Promise((resolveReport, reject) => {
    report = resolveReport;
    timeout = setTimeout(
      () => reject(new Error('Native add-on transport check timed out.')),
      15000,
    );
  });
  child = spawn(resolve('build/macos/Kino.app/Contents/MacOS/Kino'), [], {
    env: {
      ...process.env,
      KINO_UI_URL: document,
      // Permit the synthetic TLS certificate in this disposable probe process.
      // The production shell receives no certificate override.
      QTWEBENGINE_CHROMIUM_FLAGS: `${process.env.QTWEBENGINE_CHROMIUM_FLAGS ?? ''} --ignore-certificate-errors`,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => {
    diagnostics += data;
  });
  const result = await verdict;
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.results, ['insecure', 'redirect']);
  assert.deepEqual(
    requests,
    ['/development'],
    'Blocked URLs and redirect destinations must receive no request.',
  );
  assert.deepEqual(secureRequests, ['/redirect', '/allowed']);
  assert.equal(diagnostics.includes('ReferenceError'), false);
  console.log(
    'Qt WebEngine blocked HTTP and HTTPS-to-HTTP redirects before transmission, and allowed loopback HTTP only in development.',
  );
} finally {
  clearTimeout(timeout);
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(force);
  }
  plain?.closeAllConnections();
  plain?.close();
  secure?.closeAllConnections();
  secure?.close();
  rmSync(root, { recursive: true, force: true });
}
