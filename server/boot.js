'use strict';
/*
 * Εκκίνηση του server των Κοινοχρήστων.
 * Διαλέγει ποια έκδοση κώδικα θα τρέξει: την ενσωματωμένη στο image ή μια
 * νεότερη που κατέβηκε αυτόματα στο /data/app. Αν μια νέα έκδοση δεν
 * καταφέρει να ξεκινήσει δύο φορές, επιστρέφει στην ενσωματωμένη.
 */
const fs = require('fs');
const path = require('path');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const BUNDLED = path.join(__dirname, '..');
const APPS = path.join(DATA, 'app');
const CUR = path.join(APPS, 'current.json');
const BOOTING = path.join(APPS, 'booting.json');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const ver = (dir) => (readJson(path.join(dir, 'package.json')) || {}).version || '0.0.0';
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

function pick() {
  const bundled = { dir: BUNDLED, version: ver(BUNDLED) };
  const cur = readJson(CUR);
  if (!cur || !cur.dir || !fs.existsSync(path.join(cur.dir, 'server', 'server.js'))) return bundled;
  if (cmp(cur.version, bundled.version) <= 0) return bundled;
  const b = readJson(BOOTING);
  if (b && b.version === cur.version && b.attempts >= 2) {
    console.error(`[boot] Η έκδοση ${cur.version} δεν ξεκίνησε· επιστροφή στην ${bundled.version}`);
    try { fs.writeFileSync(path.join(APPS, 'failed.json'), JSON.stringify({ version: cur.version, at: new Date().toISOString() })); fs.unlinkSync(CUR); fs.unlinkSync(BOOTING); } catch { /* τίποτα */ }
    return bundled;
  }
  fs.mkdirSync(APPS, { recursive: true });
  fs.writeFileSync(BOOTING, JSON.stringify({ version: cur.version, attempts: (b && b.version === cur.version ? b.attempts : 0) + 1 }));
  return { dir: cur.dir, version: cur.version, trial: true };
}

const chosen = pick();
console.log(`[boot] Κοινόχρηστα ${chosen.version} από ${chosen.dir}`);
require(path.join(chosen.dir, 'server', 'server.js')).start({
  appDir: chosen.dir,
  version: chosen.version,
  dataDir: DATA,
  onHealthy: () => { if (chosen.trial) { try { fs.unlinkSync(BOOTING); } catch { /* τίποτα */ } } }
});
