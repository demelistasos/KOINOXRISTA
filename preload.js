'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  load: () => ipcRenderer.invoke('store:load'),
  save: (data) => ipcRenderer.invoke('store:save', data),
  exportBackup: (data, name) => ipcRenderer.invoke('backup:export', data, name),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  savePdf: (opts) => ipcRenderer.invoke('pdf:save', opts),
  confirm: (opts) => ipcRenderer.invoke('confirm', opts),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd))
});
