// Plays HTTPS media the way a Mac without Homebrew would: OpenSSL's own
// certificate locations are emptied, so the source verifies only if Kino hands
// libmpv its exported trust anchors. A fixture authority joins those anchors
// through KINO_TLS_EXTRA_ROOTS; without it the same server must be rejected.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = resolve(process.env.KINO_APP_BINARY ?? 'build/macos/Kino.app/Contents/MacOS/Kino');
assert.ok(existsSync(binary), 'Build the macOS shell first.');

const root = mkdtempSync(join(tmpdir(), 'kino-tls-'));
const file = (name) => join(root, name);
const media = process.env.KINO_PLAYBACK_FIXTURE ?? file('fixture.mp4');
if (!existsSync(media)) {
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=24:duration=6',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    media,
  ]);
}
function openssl(...args) {
  execFileSync('openssl', args, { stdio: 'ignore' });
}

try {
  openssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=Kino Fixture Root',
    '-days',
    '1',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-keyout',
    file('ca-key.pem'),
    '-out',
    file('ca.pem'),
  );
  openssl(
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=localhost',
    '-keyout',
    file('server-key.pem'),
    '-out',
    file('server.csr'),
  );
  writeFileSync(file('server.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
  openssl(
    'x509',
    '-req',
    '-in',
    file('server.csr'),
    '-CA',
    file('ca.pem'),
    '-CAkey',
    file('ca-key.pem'),
    '-CAcreateserial',
    '-days',
    '1',
    '-extfile',
    file('server.ext'),
    '-out',
    file('server.pem'),
  );

  const size = statSync(media).size;
  const bytes = readFileSync(media);
  const server = createServer(
    { key: readFileSync(file('server-key.pem')), cert: readFileSync(file('server.pem')) },
    (request, response) => {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
      if (!range) {
        response.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' });
        response.end(bytes);
        return;
      }
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      response.writeHead(206, {
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
      });
      response.end(bytes.subarray(start, end + 1));
    },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `https://127.0.0.1:${server.address().port}/media.mp4`;

  async function probe(extraRoots) {
    const child = spawn(binary, [], {
      env: {
        ...process.env,
        KINO_PLAYBACK_PROBE: url,
        SSL_CERT_FILE: file('missing.pem'),
        SSL_CERT_DIR: file('missing'),
        ...(extraRoots ? { KINO_TLS_EXTRA_ROOTS: extraRoots } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    await once(child, 'exit');
    clearTimeout(timer);
    const line = /KINO_PROBE_RESULT (.*)/.exec(output)?.[1];
    assert.ok(line, `The playback probe reported no result:\n${output}`);
    return JSON.parse(line);
  }

  try {
    // FFmpeg's Schannel verifies against the Windows certificate store and takes no CA file, so
    // there Kino's anchors have no part to play; what remains to check is that it verifies.
    if (process.platform === 'win32') {
      console.log('Windows verifies HTTPS media against its own certificate store.');
    } else {
      const trusted = await probe(file('ca.pem'));
      assert.equal(
        trusted.outcome,
        'played',
        'HTTPS media must verify against Kino-provided roots when OpenSSL has none of its own.',
      );
      console.log('HTTPS media verified against the exported trust anchors.');
    }
    const untrusted = await probe(null);
    assert.equal(untrusted.outcome, 'failed', 'An unknown authority must still be rejected.');
    console.log('The same server was rejected without its authority in the bundle.');
  } finally {
    server.closeAllConnections();
    server.close();
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
