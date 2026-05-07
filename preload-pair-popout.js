const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  echocatCreatePairingQr: (opts) => ipcRenderer.invoke('echocat-create-pairing-qr', opts || {}),
  onPairQrProgress: (cb) => ipcRenderer.on('pair-qr-progress', (_e, msg) => cb(msg)),
  // Theme follows the main window's light/dark setting. Initial theme
  // is pushed by main on did-finish-load; live toggles relay through
  // pair-popout-theme so opening the popout once and flipping the
  // theme later works without reopening.
  onTheme: (cb) => ipcRenderer.on('pair-popout-theme', (_e, theme) => cb(theme)),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  close: () => ipcRenderer.send('pair-popout-close'),
});
