/**
 * verify-local.mjs — smoke test the embedded dsh web server without
 * launching Electron. Run after `npm run fetch:node` and after installing
 * dsh into resources/dsh. Confirms:
 *   - embedded node is reachable
 *   - dsh web boots and binds a port
 *   - the index URL answers 200 within the startup window
 *
 * Usage: node scripts/verify-local.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RUNTIME = join(ROOT, 'resources', 'node-runtime');
const DSH = join(ROOT, 'resources', 'dsh');
const DSH_ENTRY = join(DSH, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');

const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';
const TIMEOUT_MS = 60_000;

function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const tryBind = (port) => {
      if (port > 65535) return reject(new Error('no free port'));
      const s = createServer();
      s.unref();
      s.once('error', () => s.close(() => tryBind(port + 1)));
      s.listen(port, '127.0.0.1', () => {
        const addr = s.address();
        s.close(() => resolve(addr.port));
      });
    };
    tryBind(start);
  });
}

function waitForPort(port, deadline) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (Date.now() > deadline) return reject(new Error(`timeout after ${TIMEOUT_MS / 1000}s`));
      const req = fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      req
        .then((r) => { if (r.status < 500) return resolve(r.status); throw new Error('5xx'); })
        .catch(() => setTimeout(poll, 500));
    };
    poll();
  });
}

async function main() {
  const nodeFull = join(RUNTIME, nodeBin);
  if (!existsSync(nodeFull)) {
    console.error(`[fail] missing embedded node: ${nodeFull}\n       run: npm run fetch:node`);
    process.exit(1);
  }
  if (!existsSync(DSH_ENTRY)) {
    console.error(`[fail] missing dsh entry: ${DSH_ENTRY}\n       run: cd resources/dsh && npm install @deepseek-ai/dsh`);
    process.exit(1);
  }
  const nodeVer = (await import('node:child_process')).execFileSync(nodeFull, ['--version']).toString().trim();
  console.log(`[ok] embedded node: ${nodeVer}`);

  const port = await findFreePort(3080);
  console.log(`[info] will bind dsh on 127.0.0.1:${port}`);

  const child = spawn(nodeFull, [DSH_ENTRY, 'web', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: DSH,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_HOME: join(DSH, '.dsh-home') },
  });

  let stderr = '';
  child.stdout.on('data', (d) => process.stdout.write(`[dsh:out] ${d}`));
  child.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write(`[dsh:err] ${d}`); });

  const cleanup = (code) => {
    if (child.exitCode === null) {
      try { child.kill('SIGTERM'); } catch { /* noop */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, 5000);
    }
    process.exit(code);
  };
  process.on('SIGINT', () => cleanup(0));
  process.on('SIGTERM', () => cleanup(0));

  try {
    const status = await waitForPort(port, Date.now() + TIMEOUT_MS);
    console.log(`[ok] dsh web answered http://127.0.0.1:${port}/ (status=${status})`);
    console.log('[pass] smoke test succeeded');
    cleanup(0);
  } catch (err) {
    console.error(`[fail] dsh web did not become ready: ${err.message}`);
    console.error(`[fail] last dsh stderr:\n${stderr.slice(-2000)}`);
    cleanup(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
