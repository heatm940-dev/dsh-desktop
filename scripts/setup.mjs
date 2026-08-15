/**
 * setup.mjs — one-shot bootstrap for the dsh-desktop repo.
 *
 *   npm run setup
 *   npm run setup -- --all                 # fetch all platform runtimes
 *   npm run setup -- --no-verify           # skip the post-install smoke test
 *   npm run setup -- --registry=<url>      # override npm registry
 *
 * Steps:
 *   1. Download embedded Node.js 22 runtime(s) into resources/node-runtime/.
 *   2. Install @deepseek-ai/dsh into resources/dsh/ (uses npmmirror by default).
 *   3. Run scripts/verify-local.mjs to confirm dsh boots end-to-end.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DSH_DIR = join(ROOT, 'resources', 'dsh');
const IS_WIN = process.platform === 'win32';
const NPM = IS_WIN ? 'npm.cmd' : 'npm';

function parseArgs() {
  const out = { all: false, noVerify: false, registry: 'https://registry.npmmirror.com' };
  for (const a of process.argv.slice(2)) {
    if (a === '--all') out.all = true;
    else if (a === '--no-verify') out.noVerify = true;
    else if (a.startsWith('--registry=')) out.registry = a.slice('--registry='.length);
  }
  return out;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: IS_WIN, ...opts });
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`));
    });
    child.once('error', reject);
  });
}

async function main() {
  const args = parseArgs();
  const nodeBin = process.execPath;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' dsh-desktop setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log(`\n[1/3] Fetching embedded Node 22 runtime ${args.all ? '(all platforms)' : `(${process.platform}/${process.arch})`}`);
  await run(nodeBin, [join(__dirname, 'fetch-node.mjs'), ...(args.all ? ['--all'] : [])], { shell: false });

  if (!existsSync(join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh'))) {
    console.log(`\n[2/3] Installing @deepseek-ai/dsh (registry: ${args.registry})`);
    mkdirSync(DSH_DIR, { recursive: true });
    if (!existsSync(join(DSH_DIR, 'package.json'))) {
      await run(NPM, ['init', '-y'], { cwd: DSH_DIR });
    }
    await run(
      NPM,
      [
        'install', '@deepseek-ai/dsh@0.1.0-rc.6',
        '--omit=dev', '--no-audit', '--no-fund',
        `--registry=${args.registry}`,
      ],
      { cwd: DSH_DIR },
    );
  } else {
    console.log('\n[2/3] dsh already installed, skipping.');
  }

  if (!args.noVerify) {
    console.log('\n[3/3] Verifying dsh boots end-to-end');
    await run(nodeBin, [join(__dirname, 'verify-local.mjs')], { shell: false });
  } else {
    console.log('\n[3/3] (skipped — --no-verify)');
  }

  console.log('\n✓ setup complete. Next: npm run dev');
}

main().catch((err) => {
  console.error('\n✗ setup failed:', err.message);
  process.exit(1);
});
