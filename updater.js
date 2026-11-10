// Ενημέρωση μέσα από την εφαρμογή, για τις εκδόσεις σε zip (χωρίς πρόγραμμα εγκατάστασης).
// Βήματα: κατέβασμα του σωστού zip → έλεγχος «αποτυπώματος» (SHA-256) → αποσυμπίεση δίπλα
// στο τωρινό πρόγραμμα → η εφαρμογή κλείνει → ένα μικρό script βάζει τη νέα έκδοση στη θέση
// της παλιάς και την ξανανοίγει. Αν κάτι αποτύχει, μένει η παλιά έκδοση.
// Τα δεδομένα (φάκελος userData της εφαρμογής) ΔΕΝ αγγίζονται.
// Μέσα στο Electron το κανονικό «fs» βλέπει τα αρχεία .asar σαν φακέλους και μπερδεύεται όταν
// αντιγράφει ή σβήνει μια ολόκληρη εφαρμογή. Το «original-fs» τα βλέπει σαν απλά αρχεία.
const fs = (() => { try { return require('original-fs'); } catch { return require('fs'); } })();
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const PLAT = { win32: 'Windows', darwin: 'Mac' };
const NAME = 'Koinoxrista';

// Ποια αρχεία της έκδοσης χρειαζόμαστε για αυτόν τον υπολογιστή
function pickAssets(release, platform, version) {
  // Windows: ο ίδιος installer (NSIS) τρέχει αθόρυβα πάνω από την παλιά εγκατάσταση.
  // Mac: zip με το .app, που μπαίνει στη θέση του παλιού.
  const want = platform === 'win32' ? `${NAME}-Windows-${version}-Setup.exe` : `${NAME}-${PLAT[platform]}-${version}.zip`;
  const assets = release.assets || [];
  const zip = assets.find(a => a.name === want);
  const sums = assets.find(a => a.name === 'SHA256SUMS.txt');
  return zip && sums ? { zipName: want, zipUrl: zip.browser_download_url, zipSize: zip.size, sumsUrl: sums.browser_download_url } : null;
}

// Πού είναι εγκατεστημένη η εφαρμογή και αν μπορούμε να γράψουμε εκεί
function installTarget(execPath, platform) {
  if (platform === 'win32') {
    const dir = path.win32.dirname(execPath);
    const parent = path.win32.dirname(dir);
    if (/\\Program Files( \(x86\))?\\/i.test(dir + '\\')) return { ok: false, reason: 'programfiles', dir };
    if (!canWrite(dir) || !canWrite(parent)) return { ok: false, reason: 'readonly', dir };
    return { ok: true, appPath: dir, parent, exeName: path.win32.basename(execPath) };
  }
  if (platform === 'darwin') {
    const app = path.resolve(execPath, '..', '..', '..');
    if (!/\.app$/i.test(app)) return { ok: false, reason: 'notbundle', dir: app };
    if (/AppTranslocation/i.test(app)) return { ok: false, reason: 'translocated', dir: app };
    const parent = path.dirname(app);
    if (!canWrite(parent)) return { ok: false, reason: 'readonly', dir: parent };
    return { ok: true, appPath: app, parent };
  }
  return { ok: false, reason: 'platform' };
}
function canWrite(dir) { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } }

function parseSums(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) { const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim()); if (m) out[m[2].trim()] = m[1].toLowerCase(); }
  return out;
}
async function sha256File(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

async function downloadTo(url, file, onProgress) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Koinoxrista' }, redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error('Το κατέβασμα απέτυχε (HTTP ' + r.status + ').');
  const total = +r.headers.get('content-length') || 0;
  let got = 0, lastPct = -1;
  const src = Readable.fromWeb(r.body);
  src.on('data', ch => { got += ch.length; if (total && onProgress) { const p = Math.floor(got / total * 100); if (p !== lastPct) { lastPct = p; onProgress(p); } } });
  await pipeline(src, fs.createWriteStream(file));
  return got;
}
async function downloadText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Koinoxrista' }, redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

function extractZip(zip, dest, platform) {
  fs.mkdirSync(dest, { recursive: true });
  let res;
  if (platform === 'darwin') res = spawnSync('/usr/bin/ditto', ['-x', '-k', zip, dest], { encoding: 'utf8' });
  else if (platform === 'win32') {
    res = spawnSync('tar', ['-xf', zip, '-C', dest], { encoding: 'utf8', windowsHide: true });
    if (res.status !== 0) res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`], { encoding: 'utf8', windowsHide: true });
  } else res = spawnSync('unzip', ['-q', '-o', zip, '-d', dest], { encoding: 'utf8' });
  if (!res || res.status !== 0) throw new Error('Η αποσυμπίεση απέτυχε. ' + ((res && (res.stderr || res.error && res.error.message)) || ''));
}

// Βρίσκει μέσα στον φάκελο τη νέα εφαρμογή (το zip μπορεί να έχει ή να μην έχει υποφάκελο)
function findApp(dir, platform, exeName, bundleName) {
  const look = (d, depth) => {
    if (platform === 'darwin') { const a = path.join(d, bundleName || 'Κοινόχρηστα.app'); if (fs.existsSync(path.join(a, 'Contents', 'MacOS'))) return a; }
    else if (fs.existsSync(path.join(d, exeName || 'Κοινόχρηστα.exe'))) return d;
    if (depth > 0) for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory() && !/\.app$/i.test(f)) { const r = look(p, depth - 1); if (r) return r; } }
    return null;
  };
  return look(dir, 2);
}

const psq = s => "'" + String(s).replace(/'/g, "''") + "'";
const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";

// Το script που τρέχει αφού κλείσει η εφαρμογή
function helperScript(platform, { pid, appPath, newPath, workDir, exeName, logFile }) {
  if (platform === 'win32') {
    const old = appPath + '.παλιό';
    const content = '﻿' + [
      `$ErrorActionPreference = 'Stop'`,
      `$log = ${psq(logFile)}`,
      `function L($m) { try { Add-Content -LiteralPath $log -Value ((Get-Date -Format s) + ' ' + $m) -Encoding UTF8 } catch {} }`,
      `L 'αναμονή να κλείσουν τα Κοινόχρηστα'`,
      `for ($i = 0; $i -lt 120; $i++) { if (-not (Get-Process -Id ${+pid} -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 500 }`,
      `Start-Sleep -Milliseconds 800`,
      `$app = ${psq(appPath)}; $new = ${psq(newPath)}; $old = ${psq(old)}`,
      `try {`,
      `  if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }`,
      `  $ok = $false`,
      `  for ($i = 0; $i -lt 40 -and -not $ok; $i++) { try { Move-Item -LiteralPath $app -Destination $old; $ok = $true } catch { Start-Sleep -Milliseconds 500 } }`,
      `  if (-not $ok) { throw 'ο φάκελος του προγράμματος είναι ακόμα σε χρήση' }`,
      `  Move-Item -LiteralPath $new -Destination $app`,
      `  L 'η νέα έκδοση μπήκε'`,
      `  Start-Process -FilePath (Join-Path $app ${psq(exeName)})`,
      `  try { Remove-Item -LiteralPath $old -Recurse -Force } catch { L ('δεν σβήστηκε η παλιά: ' + $_) }`,
      `  try { Remove-Item -LiteralPath ${psq(workDir)} -Recurse -Force } catch {}`,
      `} catch {`,
      `  L ('ΣΦΑΛΜΑ: ' + $_)`,
      `  if (-not (Test-Path -LiteralPath $app) -and (Test-Path -LiteralPath $old)) { Move-Item -LiteralPath $old -Destination $app; L 'επαναφορά παλιάς έκδοσης' }`,
      `  Start-Process -FilePath (Join-Path $app ${psq(exeName)})`,
      `}`
    ].join('\r\n');
    return { name: 'koinoxrista-update.ps1', content, cmd: 'powershell.exe', args: f => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', f] };
  }
  const old = appPath.replace(/\.app$/i, '') + '-παλιό.app';
  const content = [
    '#!/bin/bash',
    `LOG=${shq(logFile)}`,
    'L() { echo "$(date +%FT%T) $1" >> "$LOG"; }',
    `APP=${shq(appPath)}; NEW=${shq(newPath)}; OLD=${shq(old)}`,
    'L "αναμονή να κλείσουν τα Κοινόχρηστα"',
    `for i in $(seq 1 120); do kill -0 ${+pid} 2>/dev/null || break; sleep 0.5; done`,
    'sleep 0.8',
    'rm -rf "$OLD"',
    'if mv "$APP" "$OLD" && mv "$NEW" "$APP"; then',
    '  L "η νέα έκδοση μπήκε"',
    '  xattr -cr "$APP" 2>/dev/null',
    '  open "$APP"',
    '  rm -rf "$OLD"',
    `  rm -rf ${shq(workDir)}`,
    'else',
    '  L "ΣΦΑΛΜΑ στην αντικατάσταση"',
    '  [ ! -d "$APP" ] && [ -d "$OLD" ] && mv "$OLD" "$APP" && L "επαναφορά παλιάς έκδοσης"',
    '  open "$APP"',
    'fi'
  ].join('\n');
  return { name: 'koinoxrista-update.sh', content, cmd: '/bin/bash', args: f => [f] };
}

// Ολοκλήρωση ενημέρωσης ΧΩΡΙΣ script (Windows): τρέχει η ίδια η νέα έκδοση από τον προσωρινό φάκελο
// με την παράμετρο --koinoxrista-finish-update. Περιμένει να κλείσει η παλιά, βάζει στην άκρη τον παλιό
// φάκελο, αντιγράφει τη νέα έκδοση στη θέση του και την ανοίγει. Αν κάτι αποτύχει, επαναφέρει την παλιά.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function finishUpdate(o, { log = () => {}, isAlive, launch, wait = 500 } = {}) {
  const alive = isAlive || (pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } });
  const old = o.appPath + '.παλιό';
  const tryMany = async (what, fn, n = 40) => { for (let i = 1; ; i++) { try { return fn(); } catch (e) { if (i >= n) throw new Error(`${what}: ${e.code || e.message}`); await sleep(wait); } } };
  log('ολοκλήρωση: αναμονή να κλείσει η παλιά έκδοση');
  for (let i = 0; i < 120 && alive(o.pid); i++) await sleep(wait);
  await sleep(Math.min(800, wait * 2));
  let moved = false;
  try {
    if (fs.existsSync(old)) await tryMany('σβήσιμο παλιού', () => fs.rmSync(old, { recursive: true, force: true }), 10);
    await tryMany('μετακίνηση παλιάς έκδοσης', () => fs.renameSync(o.appPath, old));
    moved = true;
    await tryMany('αντιγραφή νέας έκδοσης', () => { fs.rmSync(o.appPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); fs.cpSync(o.newPath, o.appPath, { recursive: true }); }, 10);
    if (!fs.existsSync(path.join(o.appPath, o.exeName))) throw new Error('η νέα έκδοση δεν αντιγράφηκε σωστά');
    log('η νέα έκδοση μπήκε');
    launch(path.join(o.appPath, o.exeName));
    try { fs.rmSync(old, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { log('δεν σβήστηκε η παλιά: ' + (e.code || e.message)); }
    return { ok: true };
  } catch (e) {
    log('ΣΦΑΛΜΑ στην ολοκλήρωση: ' + e.message);
    if (moved) {
      try { fs.rmSync(o.appPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e3) { log('δεν σβήστηκε η μισή αντιγραφή: ' + (e3.code || e3.message)); }
      try { await tryMany('επαναφορά', () => fs.renameSync(old, o.appPath), 20); log('επαναφορά παλιάς έκδοσης'); } catch (e2) { log('ΔΕΝ έγινε επαναφορά: ' + (e2.code || e2.message) + ' — η παλιά έκδοση είναι στο ' + old); launch(path.join(old, o.exeName)); return { ok: false }; }
    }
    launch(path.join(o.appPath, o.exeName));
    return { ok: false, error: e.message };
  }
}

module.exports = { finishUpdate,  pickAssets, installTarget, parseSums, sha256File, downloadTo, downloadText, extractZip, findApp, helperScript, PLAT };
