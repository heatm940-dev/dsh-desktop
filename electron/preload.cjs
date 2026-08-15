/**
 * Preload script — exposes a minimal, safe surface to the page.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Version injected by the main process via additionalArguments.
const appVersionArg = process.argv.find((a) => a.startsWith('--dsh-desktop-version='));
const appVersion = appVersionArg ? appVersionArg.split('=')[1] : 'dev';

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  versions: {
    app: appVersion,
    node: process.versions.node,
  },
  onUpdate: (channel, cb) => {
    const valid = [
      'update:status',
      'update:available',
      'update:progress',
      'update:error',
    ];
    if (!valid.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
