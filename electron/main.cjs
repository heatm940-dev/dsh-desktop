/**
 * DeepSeek Harness Desktop — Electron main process.
 *
 * Architecture: a standard Node.js runtime (embedded in resources/) runs the
 * `dsh web` server as a child process on 127.0.0.1; the Electron window simply
 * loads that local URL. The harness is therefore executed by the exact Node
 * runtime it was built for (its N-API addons are not built for Electron's
 * Node ABI), and the shell stays a thin, upgradeable wrapper.
 */
'use strict';

const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const { URL } = require('node:url');

const PACKAGE_VERSION = app.getVersion();
const WEB_START_PORT = 3080; // first port to try; scans upward on conflict
const STARTUP_TIMEOUT_MS = 120_000;
const SHUTDOWN_GRACE_MS = 8_000;

let mainWindow = null;
let dshProcess = null;
let activePort = null;
let isQuitting = false;

/* ------------------------------------------------------------------ */
/*  Resource & path helpers                                             */
/* ------------------------------------------------------------------ */

/** Root that contains `dsh/` and `node-runtime/`. */
function resourcesRoot() {
  if (app.isPackaged) {
    // electron-builder extraResources copies resources/* into <app>/resources/
    return path.join(process.resourcesPath);
  }
  return path.join(__dirname, '..', 'resources');
}

function dshDir() {
  return path.join(resourcesRoot(), 'dsh');
}

function nodeRuntimeDir() {
  return path.join(resourcesRoot(), 'node-runtime');
}

function nodeBinary() {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  return path.join(nodeRuntimeDir(), exe);
}

function dshEntry() {
  return path.join(
    dshDir(),
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib',
    'bin.js',
  );
}

/** Harness home: keeps profiles/sessions/config with the app data dir. */
function dshHome() {
  return path.join(app.getPath('userData'), 'dsh-home');
}

function resolvePort() {
  // Allow overriding the base port via env (mainly for tests).
  const base = Number.parseInt(process.env.DSH_DESKTOP_PORT || String(WEB_START_PORT), 10);
  return Number.isFinite(base) && base > 0 && base < 65536 ? base : WEB_START_PORT;
}

/** Find a free TCP port by binding, starting at `start`. */
function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const tryBind = (port) => {
      if (port > 65535) return reject(new Error('no free port found (3080-65535 exhausted)'));
      const server = net.createServer();
      server.unref();
      server.once('error', () => {
        server.close(() => tryBind(port + 1));
      });
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address();
        server.close(() => resolve(addr.port));
      });
    };
    tryBind(start);
  });
}

/* ------------------------------------------------------------------ */
/*  dsh server lifecycle                                                */
/* ------------------------------------------------------------------ */

function startDsh() {
  return new Promise(async (resolve, reject) => {
    const nodeBin = nodeBinary();
    const entry = dshEntry();

    if (!fs.existsSync(nodeBin)) {
      return reject(new Error(`Embedded Node runtime not found: ${nodeBin}\nRun: npm run fetch:node`));
    }
    if (!fs.existsSync(entry)) {
      return reject(new Error(
        `dsh is not installed: ${entry}\n\n` +
        `Run: npm run setup\n` +
        `It downloads the embedded Node runtime and installs @deepseek-ai/dsh into resources/dsh/.\n\n` +
        `(If you only want to verify the shell without dsh, run: node scripts/mock-dsh.mjs)`,
      ));
    }

    const port = await findFreePort(resolvePort());
    activePort = port;

    const env = {
      ...process.env,
      DSH_HOME: dshHome(),
      // Keep the harness strictly on loopback even if a user profile says otherwise.
      DSH_DESKTOP: '1',
    };

    const child = spawn(
      nodeBin,
      [entry, 'web', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: dshDir(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    dshProcess = child;
    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout.on('data', (d) => {
      stdoutBuf = (stdoutBuf + d.toString()).slice(-8192);
      process.stdout.write(`[dsh] ${d}`);
    });
    child.stderr.on('data', (d) => {
      stderrBuf = (stderrBuf + d.toString()).slice(-8192);
      process.stderr.write(`[dsh] ${d}`);
    });

    child.once('exit', (code, signal) => {
      dshProcess = null;
      if (!isQuitting && code !== 0 && code !== null) {
        dialog.showErrorBox(
          'DeepSeek Harness 意外退出',
          `dsh 服务进程异常终止 (code=${code}, signal=${signal})。\n\n${stderrBuf.slice(-2000)}`,
        );
      }
      if (!isQuitting) app.quit();
    });

    // Wait until the web server answers.
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    const poll = () => {
      if (isQuitting) return;
      const req = http.get(
        { host: '127.0.0.1', port, path: '/', timeout: 1500 },
        (res) => {
          res.resume();
          resolve({ port, child });
        },
      );
      req.on('error', () => {
        if (Date.now() > deadline) {
          return reject(
            new Error(
              `dsh web 在 ${STARTUP_TIMEOUT_MS / 1000}s 内未就绪。\n\n${stderrBuf.slice(-2000)}`,
            ),
          );
        }
        setTimeout(poll, 400);
      });
      req.on('timeout', () => req.destroy());
    };
    poll();
  });
}

function stopDsh() {
  return new Promise((resolve) => {
    const child = dshProcess;
    dshProcess = null;
    if (!child || child.exitCode !== null) return resolve();

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      resolve();
    }, SHUTDOWN_GRACE_MS);

    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill('SIGTERM'); } catch { /* noop */ }
  });
}

/* ------------------------------------------------------------------ */
/*  Window                                                              */
/* ------------------------------------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: `DeepSeek Harness Desktop v${PACKAGE_VERSION}`,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: [`--dsh-desktop-version=${PACKAGE_VERSION}`],
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${activePort}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // External links (docs, API console) open in the OS browser.
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: '文件',
      submenu: [
        { role: 'reload', label: '重新加载界面' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新…',
          click: () => require('./updater.cjs').checkForUpdates(true),
        },
        { type: 'separator' },
        {
          label: 'DeepSeek Harness 官方仓库',
          click: () => shell.openExternal('https://github.com/deepseek-ai/deepseek-harness'),
        },
        {
          label: '打开数据目录（配置/会话）',
          click: () => shell.openPath(dshHome()),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/*  App lifecycle                                                       */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildAppMenu();
    fs.mkdirSync(dshHome(), { recursive: true });

    try {
      await startDsh();
    } catch (err) {
      dialog.showErrorBox('DeepSeek Harness Desktop 启动失败', String(err?.message || err));
      app.exit(1);
      return;
    }

    createWindow();

    // Auto-update: check quietly on start; notify only when there is something new.
    const { setupUpdater } = require('./updater.cjs');
    setupUpdater(() => mainWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
    // macOS: closing the window keeps the app + dsh server alive (dock icon),
    // matching platform conventions; quit via Cmd+Q or the File menu.
  });

  app.on('before-quit', async (event) => {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;
    await stopDsh();
    app.exit(0);
  });
}
