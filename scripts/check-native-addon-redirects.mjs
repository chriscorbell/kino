import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'kino-secure-redirects-'));
let plain, secure, child;
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
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-days',
      '1',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore' },
  );
  const plainRequests = [];
  plain = createServer((request, response) => {
    plainRequests.push(request.url);
    response.end('{}');
  }).listen(0, '127.0.0.1');
  await once(plain, 'listening');
  const insecure = `http://127.0.0.1:${plain.address().port}`;
  const secureRequests = [];
  secure = createHttpsServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (request, response) => {
      secureRequests.push(request.url);
      if (request.url === '/catalog')
        response.writeHead(307, { Location: '/final' }).end('Redirect body');
      else if (request.url === '/downgrade')
        response.writeHead(302, { Location: insecure + '/blocked' }).end();
      else if (request.url === '/chain') response.writeHead(307, { Location: '/downgrade' }).end();
      else if (request.url === '/credentials')
        response
          .writeHead(302, {
            Location: `https://account:secret@127.0.0.1:${secure.address().port}/blocked`,
          })
          .end();
      else if (request.url === '/loop') response.writeHead(302, { Location: '/loop' }).end();
      else response.end(JSON.stringify({ metas: [{ id: 'tt1', name: 'Redirected catalog' }] }));
    },
  ).listen(0, '127.0.0.1');
  await once(secure, 'listening');
  const origin = `https://127.0.0.1:${secure.address().port}`;
  child = spawn(
    process.argv[2],
    [
      cert,
      origin + '/catalog',
      origin + '/downgrade',
      origin + '/chain',
      origin + '/credentials',
      origin + '/loop',
      insecure + '/direct',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '',
    errors = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    errors += data;
  });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, errors);
  const results = JSON.parse(output);
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 403, 403, 403, 502, 403],
  );
  assert.equal(JSON.parse(results[0].body).metas[0].name, 'Redirected catalog');
  assert.deepEqual(plainRequests, [], 'HTTP redirect destinations must receive no requests.');
  assert(
    !secureRequests.includes('/blocked'),
    'Credential-bearing redirects must receive no requests.',
  );
  assert(secureRequests.filter((path) => path === '/loop').length <= 11);
  console.log(
    'Native catalog requests follow HTTPS redirects, reject HTTP and credentials before transmission, and bound redirect loops.',
  );
} finally {
  if (child && child.exitCode === null) child.kill('SIGKILL');
  plain?.closeAllConnections();
  plain?.close();
  secure?.closeAllConnections();
  secure?.close();
  rmSync(root, { recursive: true, force: true });
}
