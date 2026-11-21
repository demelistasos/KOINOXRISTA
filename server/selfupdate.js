'use strict';
/*
 * Αυτόματη ενημέρωση του server από τα releases του GitHub.
 * Κατεβάζει το Koinoxrista-Server-<έκδοση>.tar.gz, ελέγχει το SHA-256 του με
 * το SHA256SUMS.txt, το βάζει στο /data/app/<έκδοση> και ξεκινάει ξανά.
 * Αν η νέα έκδοση δεν ξεκινήσει, το boot.js επιστρέφει στην προηγούμενη.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

module.exports = function ({ repo, version, dataDir, log, status }) {
  const APPS = path.join(dataDir, 'app');
  const enabled = process.env.AUTO_UPDATE !== '0';
  let busy = false;

  async function get(url, asBuffer) {
    const r = await fetch(url, { headers: { 'User-Agent': 'koinoxrista-server', Accept: asBuffer ? 'application/octet-stream' : 'application/vnd.github+json' }, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status} για ${url.split('?')[0]}`);
    return asBuffer ? Buffer.from(await r.arrayBuffer()) : r.json();
  }

  async function check() {
    if (busy) return;
    busy = true;
    status.lastCheck = new Date().toISOString();
    try {
      const rel = await get(`https://api.github.com/repos/${repo}/releases/latest`);
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      status.latest = latest;
      status.error = null;
      if (!latest || cmp(latest, version) <= 0) return;
      const failed = (() => { try { return JSON.parse(fs.readFileSync(path.join(APPS, 'failed.json'), 'utf8')); } catch { return null; } })();
      if (failed && failed.version === latest) { status.error = `Η έκδοση ${latest} δεν ξεκίνησε και παραλείφθηκε`; return; }
      const name = `Koinoxrista-Server-${latest}.tar.gz`;
      const asset = (rel.assets || []).find((a) => a.name === name);
      const sums = (rel.assets || []).find((a) => a.name === 'SHA256SUMS.txt');
      if (!asset || !sums) { status.error = 'Η νέα έκδοση δεν έχει ακόμα αρχείο για τον server'; return; }
      log('[update] κατέβασμα', latest);
      const [buf, sumsTxt] = await Promise.all([get(asset.browser_download_url, true), get(sums.browser_download_url, true).then((b) => b.toString('utf8'))]);
      const want = (sumsTxt.split('\n').map((l) => l.trim().split(/\s+/)).find((x) => x[1] && x[1].replace(/^\*/, '') === name) || [])[0];
      const got = crypto.createHash('sha256').update(buf).digest('hex');
      if (!want || want.toLowerCase() !== got) throw new Error('Το αρχείο της ενημέρωσης δεν πέρασε τον έλεγχο SHA-256');
      await fsp.mkdir(APPS, { recursive: true });
      const tmp = path.join(APPS, latest + '.tmp');
      const dest = path.join(APPS, latest);
      await fsp.rm(tmp, { recursive: true, force: true });
      await fsp.mkdir(tmp, { recursive: true });
      const tgz = path.join(APPS, name);
      await fsp.writeFile(tgz, buf);
      await new Promise((res, rej) => execFile('tar', ['-xzf', tgz, '-C', tmp], (e) => (e ? rej(e) : res())));
      await fsp.unlink(tgz).catch(() => {});
      for (const f of ['server/server.js', 'server/boot.js', 'src/index.html', 'src/app.js', 'package.json']) {
        if (!fs.existsSync(path.join(tmp, f))) throw new Error('Λείπει το ' + f + ' από την ενημέρωση');
      }
      await fsp.rm(dest, { recursive: true, force: true });
      await fsp.rename(tmp, dest);
      fs.writeFileSync(path.join(APPS, 'current.json'), JSON.stringify({ version: latest, dir: dest, at: new Date().toISOString() }));
      // Κρατάμε μόνο την τρέχουσα και την προηγούμενη έκδοση.
      const keep = new Set([latest, version]);
      for (const d of await fsp.readdir(APPS)) {
        if (/^\d+\.\d+\.\d+$/.test(d) && !keep.has(d)) await fsp.rm(path.join(APPS, d), { recursive: true, force: true }).catch(() => {});
      }
      log('[update] εγκαταστάθηκε η', latest, '· επανεκκίνηση');
      status.pending = latest;
      setTimeout(() => process.exit(0), 1500); // το Docker το ξεκινάει ξανά
    } catch (err) {
      status.error = err.message;
      log('[update] σφάλμα', err.message);
    } finally { busy = false; }
  }

  function schedule() {
    if (!enabled) { status.disabled = true; return; }
    setTimeout(check, 60e3);
    setInterval(check, 15 * 60e3);
  }
  return { check, schedule };
};
