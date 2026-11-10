'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
let win;

const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'koinoxrista.json');
const backupFile = () => path.join(dataDir(), 'koinoxrista.previous.json');

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1060,
    minHeight: 700,
    title: 'Κοινόχρηστα',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f4f1ea',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 20 } : undefined,
    autoHideMenuBar: !isMac,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Εξωτερικοί σύνδεσμοι ανοίγουν στον browser, όχι μέσα στην εφαρμογή.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Αρχείο',
      submenu: [
        { label: 'Αντίγραφο ασφαλείας…', accelerator: 'CmdOrCtrl+Shift+S', click: () => win && win.webContents.send('menu', 'backup') },
        { label: 'Επαναφορά από αντίγραφο…', click: () => win && win.webContents.send('menu', 'restore') },
        { label: 'Άνοιγμα φακέλου δεδομένων', click: () => shell.openPath(dataDir()) },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Κλείσιμο' } : { role: 'quit', label: 'Έξοδος' }
      ]
    },
    { role: 'editMenu', label: 'Επεξεργασία' },
    { role: 'viewMenu', label: 'Προβολή' },
    { role: 'windowMenu', label: 'Παράθυρο' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- αποθήκευση ----------
ipcMain.handle('store:load', async () => {
  for (const f of [dataFile(), backupFile()]) {
    try {
      if (fs.existsSync(f)) return JSON.parse(await fs.promises.readFile(f, 'utf8'));
    } catch (err) {
      console.error('Αποτυχία ανάγνωσης', f, err);
    }
  }
  return null;
});

ipcMain.handle('store:save', async (_e, data) => {
  const json = JSON.stringify(data, null, 1);
  await fs.promises.mkdir(dataDir(), { recursive: true });
  const tmp = dataFile() + '.tmp';
  await fs.promises.writeFile(tmp, json, 'utf8');
  if (fs.existsSync(dataFile())) await fs.promises.copyFile(dataFile(), backupFile());
  await fs.promises.rename(tmp, dataFile());
  return true;
});

ipcMain.handle('backup:export', async (_e, data, suggested) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Αντίγραφο ασφαλείας',
    defaultPath: path.join(app.getPath('documents'), suggested || 'koinoxrista-backup.json'),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return null;
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 1), 'utf8');
  return filePath;
});

ipcMain.handle('backup:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Επαναφορά από αντίγραφο',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePaths[0]) return null;
  return JSON.parse(await fs.promises.readFile(filePaths[0], 'utf8'));
});

// ---------- PDF ----------
ipcMain.handle('pdf:save', async (_e, { html, landscape, fileName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Αποθήκευση PDF',
    defaultPath: path.join(app.getPath('documents'), fileName || 'koinoxrista.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return null;

  const tmpHtml = path.join(app.getPath('temp'), `koinoxrista-${Date.now()}.html`);
  await fs.promises.writeFile(tmpHtml, html, 'utf8');
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await pdfWin.loadFile(tmpHtml);
    const buf = await pdfWin.webContents.printToPDF({
      pageSize: 'A4',
      landscape: !!landscape,
      printBackground: true,
      preferCSSPageSize: true
    });
    await fs.promises.writeFile(filePath, buf);
  } finally {
    pdfWin.destroy();
    fs.promises.unlink(tmpHtml).catch(() => {});
  }
  shell.openPath(filePath);
  return filePath;
});

ipcMain.handle('confirm', async (_e, { message, detail, ok }) => {
  const r = await dialog.showMessageBox(win, {
    type: 'warning', buttons: [ok || 'Συνέχεια', 'Άκυρο'], defaultId: 1, cancelId: 1, message, detail
  });
  return r.response === 0;
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });
