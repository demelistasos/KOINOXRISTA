'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  load: () => ipcRenderer.invoke('store:load'),
  save: (data) => ipcRenderer.invoke('store:save', data),
  exportBackup: (data, name) => ipcRenderer.invoke('backup:export', data, name),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  savePdf: (opts) => ipcRenderer.invoke('pdf:save', opts),
  pdfDefaultDir: () => ipcRenderer.invoke('pdf:defaultDir'),
  choosePdfDir: (current) => ipcRenderer.invoke('pdf:chooseDir', current),
  openPdfDir: (dir) => ipcRenderer.invoke('pdf:openDir', dir),
  reveal: (p) => ipcRenderer.invoke('file:reveal', p),
  confirm: (opts) => ipcRenderer.invoke('confirm', opts),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
  appVersion: () => ipcRenderer.invoke('update:version'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  justUpdated: () => ipcRenderer.invoke('update:justUpdated'),
  openUpdateLog: () => ipcRenderer.invoke('update:openLog'),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, s) => cb(s))
});
