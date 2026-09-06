import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function withWebEngine(ui, entry, check, { native = false } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push(request.url);
    const path = resolve(ui, '.' + new URL(request.url, 'http://localhost').pathname);
    if (path !== ui && !path.startsWith(ui + sep)) return response.writeHead(403).end();
    try {
      const file = path === ui ? resolve(ui, 'index.html') : path;
      let body = await readFile(file);
      if (extname(file) === '.html' && !native) {
        // Isolate browsing from the user's native account and external catalogs.
        // The production App, navigation effects, and styles still run unchanged.
        body = body
          .toString()
          .replace(
            '<head>',
            '<head><script>window.qt = undefined; window.Worker = undefined;</script>',
          );
      }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  let child;
  let socket;
  let commandId = 0;
  const pending = new Map();
  async function until(read, description) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const value = await read();
      if (value) return value;
      await delay(50);
    }
    throw new Error('Timed out waiting for ' + description);
  }
  function command(method, params = {}) {
    const id = ++commandId;
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(method + ' timed out'));
      }, 5000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolveResult(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, 'Browser evaluation failed');
    return result.result.value;
  }
  async function key(key, code, virtualKey, modifiers = 0) {
    for (const type of ['keyDown', 'keyUp'])
      await command('Input.dispatchKeyEvent', {
        type,
        key,
        code,
        windowsVirtualKeyCode: virtualKey,
        text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined,
        modifiers,
      });
  }
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const portServer = createServer();
    portServer.listen(0, '127.0.0.1');
    await once(portServer, 'listening');
    const debugPort = portServer.address().port;
    await new Promise((done) => portServer.close(done));
    child = spawn(
      resolve(process.env.KINO_APP_BINARY ?? 'build/macos/Kino.app/Contents/MacOS/Kino'),
      [],
      {
        env: {
          ...process.env,
          KINO_UI_URL: origin + entry,
          QTWEBENGINE_REMOTE_DEBUGGING: `127.0.0.1:${debugPort}`,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    child.stderr.resume();
    const page = await until(async () => {
      try {
        return (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((page) =>
          page.url.startsWith(origin),
        );
      } catch {
        return null;
      }
    }, 'WebEngine debugging');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await once(socket, 'open');
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
    await check({ evaluate, key, command, until, origin, requests });
  } finally {
    socket?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}
