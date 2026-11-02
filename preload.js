const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onState: (cb) => ipcRenderer.on('state', (e, payload) => cb(payload)),
  onCmd: (cb) => ipcRenderer.on('cmd', (e, cmd) => cb(cmd)),
  select: (id) => ipcRenderer.send('select-match', id),
  refresh: () => ipcRenderer.send('refresh'),
  setView: (v) => ipcRenderer.send('set-view', v),
  setPreset: (size) => ipcRenderer.send('set-preset', size),
  setInterval: (sec) => ipcRenderer.send('set-interval', sec),
  setOpacity: (v) => ipcRenderer.send('set-opacity', v),
  toggleBoot: () => ipcRenderer.send('toggle-boot'),
  toggleTop: () => ipcRenderer.send('toggle-top'),
  ctxMenu: () => ipcRenderer.send('ctx-menu'),
  setTheme: (t) => ipcRenderer.send('set-theme', t),
  setRounded: (v) => ipcRenderer.send('set-rounded', v),
  dragBegin: () => ipcRenderer.send('drag-begin'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
  openLink: (url) => ipcRenderer.send('open-link', url)
});
