'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const upd = require('./updater');
// Χωρίς τη «μαγεία» των .asar (βλ. updater.js)
const ofs = (() => { try { return require('original-fs'); } catch { return fs; } })();

const isMac = process.platform === 'darwin';
let win;
// Όταν η νέα έκδοση τρέχει για να ολοκληρώσει μια ενημέρωση (βλ. updater.finishUpdate)
const FIN_I = process.argv.indexOf('--koinoxrista-finish-update');
let FINISH = null;
if (FIN_I > 0) { try { FINISH = JSON.parse(Buffer.from(process.argv[FIN_I + 1] || '', 'base64').toString('utf8')); } catch { FINISH = null; } }

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

// ---------- αυτόματα αντίγραφα ----------
const defaultBackupDir = () => path.join(app.getPath('documents'), 'Κοινόχρηστα Αντίγραφα');
const KEEP_AUTO = 60;
ipcMain.handle('backup:defaultDir', () => defaultBackupDir());
ipcMain.handle('backup:auto', async (_e, data, reason, dir) => {
  const d = dir || defaultBackupDir();
  await fs.promises.mkdir(d, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const why = String(reason || 'αντίγραφο').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  const file = path.join(d, `koinoxrista-${stamp}-${why}.json`);
  await fs.promises.writeFile(file, JSON.stringify(data, null, 1), 'utf8');
  // Κρατάμε μόνο τα πιο πρόσφατα αυτόματα αντίγραφα
  try {
    const files = (await fs.promises.readdir(d)).filter((f) => /^koinoxrista-\d{4}-\d{2}-\d{2}_.*\.json$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_AUTO))) await fs.promises.unlink(path.join(d, f)).catch(() => {});
  } catch { /* τίποτα */ }
  return file;
});
ipcMain.handle('backup:chooseDir', async (_e, current) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Φάκελος για τα αντίγραφα ασφαλείας', defaultPath: current || defaultBackupDir(), properties: ['openDirectory', 'createDirectory'] });
  return canceled || !filePaths[0] ? null : filePaths[0];
});
ipcMain.handle('backup:openDir', async (_e, dir) => { const d = dir || defaultBackupDir(); await fs.promises.mkdir(d, { recursive: true }); return shell.openPath(d); });

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
const defaultPdfDir = () => path.join(app.getPath('documents'), 'Κοινόχρηστα PDF');
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Χωρίς όνομα';

ipcMain.handle('pdf:defaultDir', () => defaultPdfDir());
ipcMain.handle('pdf:chooseDir', async (_e, current) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Φάκελος για τα PDF',
    defaultPath: current || defaultPdfDir(),
    properties: ['openDirectory', 'createDirectory']
  });
  return canceled || !filePaths[0] ? null : filePaths[0];
});
ipcMain.handle('pdf:openDir', async (_e, dir) => {
  const d = dir || defaultPdfDir();
  await fs.promises.mkdir(d, { recursive: true });
  return shell.openPath(d);
});

// Αποθήκευση PDF. Χωρίς saveAs: πάει αυτόματα στο <φάκελος>/<πολυκατοικία>/<subdir>/<fileName>.
ipcMain.handle('pdf:save', async (_e, { html, landscape, fileName, dir, building, subdir, saveAs }) => {
  let filePath;
  if (saveAs) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Αποθήκευση PDF',
      defaultPath: path.join(dir || defaultPdfDir(), safe(fileName)),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (r.canceled || !r.filePath) return null;
    filePath = r.filePath;
  } else {
    const folder = path.join(dir || defaultPdfDir(), safe(building), safe(subdir));
    await fs.promises.mkdir(folder, { recursive: true });
    filePath = path.join(folder, safe(fileName));
  }

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
ipcMain.handle('file:reveal', (_e, p) => { if (p) shell.showItemInFolder(p); });

ipcMain.handle('confirm', async (_e, { message, detail, ok }) => {
  const r = await dialog.showMessageBox(win, {
    type: 'warning', buttons: [ok || 'Συνέχεια', 'Άκυρο'], defaultId: 1, cancelId: 1, message, detail
  });
  return r.response === 0;
});

// ---------- ενημερώσεις ----------
// Η εφαρμογή κοιτάει στο GitHub αν υπάρχει νεότερη έκδοση και ΡΩΤΑΕΙ τον χρήστη.
// Μόνο αν πατήσει «Ενημέρωση τώρα» κατεβαίνει και μπαίνει η νέα έκδοση (βλ. updater.js).
// Κάθε έκδοση (tag "vX.Y.Z") έχει ένα zip για Windows, ένα για Mac και το SHA256SUMS.txt.
const REPO = 'demelistasos/KOINOXRISTA';
const TAG = /^v(\d[\d.]*)$/;
let pending = null;
let installing = false;
let lastLogged = '';
const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 300 };
const configPath = () => path.join(dataDir(), 'config.json');
function readConfig() { try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; } }
function writeConfig(cfg) { try { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8'); } catch { /* τίποτα */ } }
const updLogFile = () => path.join(dataDir(), 'ενημερώσεις.log');
function updLog(msg) { try { fs.appendFileSync(updLogFile(), `${new Date().toISOString().slice(0, 19)} [${app.getVersion()}] ${msg}\n`, 'utf8'); } catch { /* τίποτα */ } }
function send(status, extra = {}) {
  if (win && !win.isDestroyed()) win.webContents.send('update:status', { status, platform: process.platform, current: app.getVersion(), ...extra });
}
function newer(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
// Ασφάλεια: τα δεδομένα δεν πρέπει να είναι μέσα στον φάκελο του προγράμματος
function dataInside(appPath) {
  const norm = (p) => path.resolve(p).toLowerCase() + path.sep;
  return norm(dataDir()).startsWith(norm(appPath));
}
async function checkUpdates() {
  send('checking');
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Koinoxrista' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let best = null;
    for (const rel of await r.json()) {
      const m = !rel.draft && !rel.prerelease && TAG.exec(rel.tag_name);
      if (m && (!best || newer(m[1], best.version))) best = { version: m[1], url: rel.html_url, rel, notes: rel.body || '' };
    }
    if (best && newer(best.version, app.getVersion())) {
      const assets = upd.pickAssets(best.rel, process.platform, best.version);
      let target = process.platform === 'win32'
        ? { ok: true, appPath: path.dirname(process.execPath) }
        : upd.installTarget(process.execPath, process.platform);
      if (process.platform !== 'win32' && target.ok && dataInside(target.appPath)) target = { ok: false, reason: 'datainside', dir: target.appPath };
      pending = assets && target.ok ? { version: best.version, url: best.url, assets, target } : null;
      if (lastLogged !== best.version) { lastLogged = best.version; updLog(`βρέθηκε νέα έκδοση ${best.version}` + (pending ? '' : ` (χωρίς αυτόματη ενημέρωση: ${!assets ? 'noassets' : target.reason})`)); }
      send('available', { version: best.version, url: best.url, canAuto: !!pending, reason: !assets ? 'noassets' : target.reason });
    } else send('latest');
  } catch (e) {
    send('error', { message: e.message });
  }
}
function cleanOldUpdates() {
  if (installing) return;
  try {
    const t = upd.installTarget(process.execPath, process.platform);
    for (const dir of [app.getPath('temp'), t.parent].filter(Boolean)) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) if (/^\.?koinoxrista-update-/.test(f)) { try { ofs.rmSync(path.join(dir, f), RM); } catch { /* την επόμενη φορά */ } }
    }
  } catch { /* τίποτα */ }
}
function setupUpdates() {
  if (!app.isPackaged) return;
  setTimeout(cleanOldUpdates, 15000);
  setTimeout(checkUpdates, 4000);
  setInterval(checkUpdates, 4 * 60 * 60 * 1000);
}
ipcMain.handle('update:check', () => { if (!app.isPackaged) return { status: 'dev' }; checkUpdates(); return { status: 'checking' }; });
ipcMain.handle('update:version', () => app.getVersion());
ipcMain.handle('update:openLog', () => { if (!fs.existsSync(updLogFile())) updLog('δεν έχει γίνει ακόμα καμία ενημέρωση'); shell.openPath(updLogFile()); return true; });
ipcMain.handle('update:justUpdated', () => {
  const cfg = readConfig();
  if (!cfg.updatedFrom) return null;
  const from = cfg.updatedFrom; delete cfg.updatedFrom; writeConfig(cfg);
  return from !== app.getVersion() ? { from, to: app.getVersion() } : { failed: true, from };
});
ipcMain.handle('update:install', async () => {
  if (installing) return { ok: false, error: 'Η ενημέρωση γίνεται ήδη. Περίμενε λίγο…' };
  if (!pending) return { ok: false, error: 'Δεν υπάρχει ενημέρωση για εγκατάσταση.' };
  installing = true;
  const { version, assets, target } = pending;
  updLog(`ξεκινάει η ενημέρωση στην ${version} (${target.appPath})`);
  const sameDrive = process.platform !== 'win32' || path.win32.parse(app.getPath('temp')).root.toLowerCase() === path.win32.parse(target.appPath).root.toLowerCase();
  const work = path.join(sameDrive ? app.getPath('temp') : target.parent, `koinoxrista-update-${version}-${Date.now()}`);
  const retry = async (what, fn, times = 4) => {
    for (let i = 1; ; i++) {
      try { return await fn(); } catch (e) {
        if (i >= times) throw e;
        updLog(`${what}: απέτυχε (${e.code || e.message}), ξαναδοκιμή ${i + 1}/${times}`);
        await new Promise((r) => setTimeout(r, 1500 * i));
      }
    }
  };
  try {
    // 1. αντίγραφο των δεδομένων πριν από οτιδήποτε
    if (fs.existsSync(dataFile())) {
      const bdir = path.join(dataDir(), 'Αντίγραφα'); fs.mkdirSync(bdir, { recursive: true });
      fs.copyFileSync(dataFile(), path.join(bdir, `koinoxrista-πριν-την-${version}.json`));
    }
    // 2-3. κατέβασμα και έλεγχος αποτυπώματος
    fs.mkdirSync(work, { recursive: true });
    const zip = path.join(work, assets.zipName);
    const sums = upd.parseSums(await retry('αποτυπώματα', () => upd.downloadText(assets.sumsUrl), 3));
    const want = sums[assets.zipName];
    if (!want) throw new Error('Η νέα έκδοση δεν έχει αποτύπωμα για αυτόν τον υπολογιστή.');
    await retry('κατέβασμα', async () => {
      send('progress', { version, percent: 0 });
      await upd.downloadTo(assets.zipUrl, zip, (p) => send('progress', { version, percent: p }));
      send('verifying', { version });
      const got = await upd.sha256File(zip);
      if (want !== got) throw new Error('Το αρχείο δεν κατέβηκε σωστά (δεν ταιριάζει το αποτύπωμα).');
    }, 3);
    // Windows: τρέχει ο νέος installer αθόρυβα (/S) και ξανανοίγει την εφαρμογή (--force-run).
    if (process.platform === 'win32') {
      send('installing', { version });
      updLog('ξεκινάει ο installer της νέας έκδοσης');
      writeConfig({ ...readConfig(), updatedFrom: app.getVersion() });
      const child = require('child_process').spawn(zip, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', cwd: work });
      child.on('error', (e) => updLog('ΣΦΑΛΜΑ στο ξεκίνημα του installer: ' + e.message));
      child.unref();
      send('restarting', { version });
      setTimeout(() => app.quit(), 600);
      return { ok: true };
    }
    // 4. αποσυμπίεση (Mac)
    send('installing', { version });
    await retry('αποσυμπίεση', () => { ofs.rmSync(path.join(work, 'x'), RM); upd.extractZip(zip, path.join(work, 'x'), process.platform); });
    try { fs.rmSync(zip, { force: true }); } catch { /* τίποτα */ }
    const exeName = target.exeName || path.basename(process.execPath);
    const bundleName = process.platform === 'darwin' ? path.basename(target.appPath) : null;
    const newPath = upd.findApp(path.join(work, 'x'), process.platform, exeName, bundleName);
    if (!newPath) throw new Error('Δεν βρέθηκε η νέα εφαρμογή μέσα στο zip.');
    // 5. η εφαρμογή κλείνει και η νέα έκδοση μπαίνει στη θέση της
    const logFile = updLogFile();
    updLog('η νέα έκδοση είναι έτοιμη, η εφαρμογή κλείνει');
    writeConfig({ ...readConfig(), updatedFrom: app.getVersion() });
    let child;
    if (process.platform === 'win32') {
      const arg = Buffer.from(JSON.stringify({ pid: process.pid, appPath: target.appPath, newPath, exeName, logFile })).toString('base64');
      child = require('child_process').spawn(path.join(newPath, exeName), ['--koinoxrista-finish-update', arg], { detached: true, stdio: 'ignore', cwd: newPath });
    } else {
      const h = upd.helperScript(process.platform, { pid: process.pid, appPath: target.appPath, newPath, workDir: work, exeName, logFile });
      const script = path.join(app.getPath('temp'), h.name);
      fs.writeFileSync(script, h.content, 'utf8');
      fs.chmodSync(script, 0o755);
      child = require('child_process').spawn(h.cmd, h.args(script), { detached: true, stdio: 'ignore' });
    }
    child.on('error', (e) => updLog('ΣΦΑΛΜΑ στο ξεκίνημα της ολοκλήρωσης: ' + e.message));
    child.unref();
    send('restarting', { version });
    setTimeout(() => app.quit(), 600);
    return { ok: true };
  } catch (e) {
    installing = false;
    updLog('ΣΦΑΛΜΑ: ' + ((e && e.stack) || e));
    try { ofs.rmSync(work, RM); } catch { /* τίποτα */ }
    send('install-error', { version, message: e.message, url: pending.url });
    return { ok: false, error: e.message };
  }
});

// ---------- εκκίνηση ----------
if (FINISH) {
  // «Ολοκλήρωση ενημέρωσης» (Windows): χωρίς παράθυρο, κάνει την αλλαγή και κλείνει.
  const log = (m) => { try { fs.appendFileSync(FINISH.logFile, `${new Date().toISOString().slice(0, 19)} [${app.getVersion()}] ${m}\n`, 'utf8'); } catch { /* τίποτα */ } };
  const launch = (p) => { try { require('child_process').spawn(p, [], { detached: true, stdio: 'ignore', cwd: path.dirname(p) }).unref(); log('άνοιξε: ' + p); } catch (e) { log('δεν άνοιξε: ' + e.message); } };
  app.whenReady().then(() => upd.finishUpdate(FINISH, { log, launch })).catch((e) => log('ΣΦΑΛΜΑ: ' + e.message)).finally(() => app.exit(0));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    setupUpdates();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
