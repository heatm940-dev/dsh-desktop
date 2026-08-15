/**
 * mock-dsh.mjs — populate resources/dsh with the bare minimum that makes
 * electron-builder pack a working shape and lets main.cjs start. Use this
 * for CI linting / smoke builds when you don't want to wait for the full
 * 100+ package dsh install.
 *
 * Real users should run `npm run setup` instead.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DSH = join(ROOT, 'resources', 'dsh');

const MOCK_BIN = `#!/usr/bin/env node
// MOCK dsh — used only when resources/dsh/ is not populated by \`npm run setup\`.
// Boots a tiny HTTP server on the requested port that returns a placeholder
// page so the Electron shell can still be exercised.
import { createServer } from 'node:http';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 3080;
const server = createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mock: true }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><body style="font-family:system-ui;background:#0f1117;color:#fff;padding:32px">'
    + '<h1>dsh-desktop mock</h1>'
    + '<p>resources/dsh is not installed. Run <code>npm run setup</code> to install the real harness.</p>'
    + '</body></html>');
});
server.listen(port, '127.0.0.1', () => console.log(\`mock dsh on 127.0.0.1:\${port}\`));
`;

const MOCK_PKG = {
  name: 'dsh-mock',
  version: '0.0.0',
  private: true,
  type: 'module',
  description: 'Mock harness used when real dsh is not installed (npm run setup to install).',
};

function exists(p) { return existsSync(p); }

function main() {
  if (exists(join(DSH, 'node_modules', '@deepseek-ai', 'dsh'))) {
    console.log('resources/dsh is already populated — nothing to do.');
    return;
  }

  console.log('Populating mock dsh into resources/dsh/ ...');

  // Clean anything that was left over from a half-done install.
  rmSync(DSH, { recursive: true, force: true });
  mkdirSync(DSH, { recursive: true });

  writeFileSync(join(DSH, 'package.json'), JSON.stringify(MOCK_PKG, null, 2));
  mkdirSync(join(DSH, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true });
  writeFileSync(join(DSH, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.0.0-mock', type: 'module' }, null, 2));
  writeFileSync(join(DSH, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), MOCK_BIN);

  console.log('done. (For the real harness: npm run setup)');
}

main();
