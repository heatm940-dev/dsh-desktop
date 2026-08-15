/**
 * fetch-node.mjs — download the embedded Node.js runtime for the current
 * platform into resources/node-runtime/.
 *
 * The Electron shell never executes the harness in Electron's own Node ABI;
 * dsh (and its N-API addons) run under this stock Node runtime as a child
 * process. Version must satisfy dsh engines (^22.19.0 || >=24.0.0).
 *
 * Usage:
 *   node scripts/fetch-node.mjs            # current platform
 *   node scripts/fetch-node.mjs --all      # all platforms (CI helper)
 */
import { createWriteStream } from 'node:fs';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { get as httpsGet } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = 'v22.22.2';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RUNTIME_DIR = join(ROOT, 'resources', 'node-runtime');
const TMP_DIR = join(ROOT, 'tmp-node');

const PLATFORMS = {
  win32: { os: 'win', ext: 'zip', bin: 'node.exe' },
  darwin: { os: 'darwin', ext: 'tar.gz', bin: 'node' },
};

function archName(arch) {
  if (arch === 'x64') return 'x64';
  if (arch === 'arm64') return 'arm64';
  throw new Error(`unsupported arch: ${arch}`);
}

function urlFor(platform, arch) {
  const p = PLATFORMS[platform];
  return `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${p.os}-${archName(arch)}.${p.ext}`;
}

function hasRuntime(platform, arch) {
  const bin = join(RUNTIME_DIR, PLATFORMS[platform].bin);
  return existsSync(bin);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`  downloading ${url}`);
    const follow = (u) => {
      httpsGet(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          follow(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          res.resume();
          return;
        }
        const out = createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

async function extract(archive, destDir) {
  console.log(`  extracting ${archive}`);
  mkdirSync(destDir, { recursive: true });
  if (archive.endsWith('.zip')) {
    // Windows: use bundled bsdtar (Win10+) or PowerShell as fallback.
    try {
      execFileSync('tar', ['-xf', archive, '-C', destDir], { stdio: 'inherit' });
    } catch {
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `Expand-Archive -Path '${archive}' -DestinationPath '${destDir}' -Force`],
        { stdio: 'inherit' },
      );
    }
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', destDir], { stdio: 'inherit' });
  }
}

/** Locate the node binary after extraction without assuming the tarball's
 *  top-level directory name or layout (unix archives put it in bin/, the
 *  windows zip at the root). */
function findNodeBinary(extractDir, binName) {
  for (const entry of readdirSync(extractDir)) {
    const dir = join(extractDir, entry);
    for (const candidate of [join(dir, binName), join(dir, 'bin', binName)]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function fetchOne(platform, arch) {
  if (hasRuntime(platform, arch)) {
    console.log(`[skip] node-runtime already present for ${platform}/${arch}`);
    return;
  }
  const archive = join(TMP_DIR, `node-${NODE_VERSION}-${platform}-${arch}.${PLATFORMS[platform].ext}`);
  const extractDir = join(TMP_DIR, `node-${NODE_VERSION}-${platform}-${arch}`);

  mkdirSync(TMP_DIR, { recursive: true });
  console.log(`[fetch] node ${NODE_VERSION} for ${platform}/${arch}`);

  return download(urlFor(platform, arch), archive)
    .then(() => extract(archive, extractDir))
    .then(() => {
      const bin = PLATFORMS[platform].bin;
      const src = findNodeBinary(extractDir, bin);
      if (!src) {
        throw new Error(
          `could not locate '${bin}' under ${extractDir} after extraction; ` +
          `entries: ${readdirSync(extractDir).join(', ')}`,
        );
      }
      mkdirSync(RUNTIME_DIR, { recursive: true });
      copyFileSync(src, join(RUNTIME_DIR, bin));
      if (platform !== 'win32') {
        try { chmodSync(join(RUNTIME_DIR, bin), 0o755); } catch { /* noop */ }
      }
    })
    .then(() => {
      // Verify.
      const nodeBin = join(RUNTIME_DIR, PLATFORMS[platform].bin);
      const out = execFileSync(nodeBin, ['--version']).toString().trim();
      console.log(`[ok] embedded node ${out} -> ${nodeBin}`);
      if (!out.startsWith(NODE_VERSION.replace('v', 'v'))) {
        console.warn(`  [warn] version mismatch: expected ${NODE_VERSION}, got ${out}`);
      }
    })
    .finally(() => {
      rmSync(extractDir, { recursive: true, force: true });
      rmSync(archive, { force: true });
    });
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const platformOverride = optionValue(args, '--platform');
  const archOverride = optionValue(args, '--arch');

  if (all) {
    for (const [platform, arch] of [
      ['win32', 'x64'],
      ['darwin', 'x64'],
      ['darwin', 'arm64'],
    ]) {
      await fetchOne(platform, arch);
    }
  } else {
    await fetchOne(platformOverride || process.platform, archOverride || process.arch);
  }
  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log('done.');
}

function optionValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const hit = argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
