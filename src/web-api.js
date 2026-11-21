/*
 * Κοινόχρηστα — σύνδεση με τον server του σπιτιού.
 * Όταν η εφαρμογή ανοίγει από browser (κινητό, tablet, υπολογιστής), αυτό το
 * αρχείο δίνει το ίδιο window.api με το πρόγραμμα του υπολογιστή, αλλά πάνω στον server.
 * Στο πρόγραμμα του υπολογιστή (Electron) δεν κάνει τίποτα.
 */
(function () {
  'use strict';
  if (window.api || location.protocol === 'file:') return;

  let rev = 0;
  let version = '';
  let updListener = null;
  let pendingSave = false;

  async function call(method, url, body) {
    const r = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (r.status === 401) { location.replace('/login'); throw new Error('Χρειάζεται σύνδεση'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('Σφάλμα ' + r.status)); e.status = r.status; e.info = j; throw e; }
    return j;
  }
  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const conflictBanner = (info) => {
    const who = info && info.by ? ` από ${info.by}` : '';
    const box = document.createElement('div');
    box.className = 'conflict';
    box.innerHTML = `<b>Τα στοιχεία άλλαξαν${who.replace(/[<>&]/g, '')} σε άλλη συσκευή.</b><span>Φορτώνω την πιο νέα εικόνα…</span>`;
    document.body.appendChild(box);
    setTimeout(() => location.reload(), 1600);
  };

  // Όταν ξαναγυρίζεις στην εφαρμογή, φέρνει ό,τι άλλαξε σε άλλη συσκευή.
  async function poll() {
    try {
      const s = await call('GET', '/api/rev');
      if (s.version && version && s.version !== version && updListener) updListener({ status: 'available', version: s.version, canAuto: true });
      if (s.rev !== rev && !pendingSave && !document.querySelector('#modal .dialog')) {
        const a = document.activeElement;
        if (!(a && a.matches && a.matches('input, textarea, select'))) location.reload();
      }
    } catch { /* εκτός δικτύου */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
  setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 60e3);

  window.api = {
    web: true,
    platform: 'web',
    async load() {
      const j = await call('GET', '/api/data');
      rev = j.rev;
      return j.data;
    },
    async save(data) {
      pendingSave = true;
      try {
        const j = await call('PUT', '/api/data', { data, rev });
        rev = j.rev;
        return true;
      } catch (e) {
        if (e.status === 409) { conflictBanner(e.info); throw new Error('Άλλαξαν από άλλη συσκευή'); }
        throw e;
      } finally { pendingSave = false; }
    },
    async exportBackup(data, name) { download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), name); return name; },
    importBackup() {
      return new Promise((resolve, reject) => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
        i.onchange = async () => { try { resolve(JSON.parse(await i.files[0].text())); } catch (e) { reject(new Error('Μη έγκυρο αρχείο')); } };
        i.click();
      });
    },
    async autoBackup(_data, reason) { const j = await call('POST', '/api/backup', { reason }); return j.file; },
    backupStatus: () => call('GET', '/api/backups'),
    backupUrl: (name) => '/api/backups/' + encodeURIComponent(name),
    async backupDefaultDir() { return 'Στον server'; },
    async pdfDefaultDir() { return 'Στον server'; },
    savePdf(opts) {
      // Το παράθυρο ανοίγει αμέσως, μέσα στο πάτημα, για να μην το μπλοκάρει ο browser.
      const w = opts.saveAs ? null : window.open('', '_blank');
      if (w) { try { w.document.title = 'PDF…'; w.document.body.innerHTML = '<p style="font:16px -apple-system,sans-serif;padding:24px">Ετοιμάζεται το PDF…</p>'; } catch { /* τίποτα */ } }
      return call('POST', '/api/pdf', { html: opts.html, fileName: opts.fileName, building: opts.building, subdir: opts.subdir })
        .then((j) => {
          if (opts.saveAs) { const a = document.createElement('a'); a.href = j.url + '?dl=1'; a.download = opts.fileName; document.body.appendChild(a); a.click(); a.remove(); }
          else if (w) w.location.href = j.url;
          else location.href = j.url;
          return 'server › ' + j.path.split('/').join(' › ');
        })
        .catch((e) => { if (w) w.close(); throw e; });
    },
    openPdfDir() { window.open('/arxeio', '_blank'); },
    async confirm() { return true; },
    onMenu() {},
    async appVersion() { const j = await call('GET', '/api/version'); version = j.version; return version; },
    async checkUpdates() {
      const j = await call('POST', '/api/update-check', {});
      setTimeout(poll, 4000);
      return j;
    },
    async installUpdate() { location.reload(); return { ok: true }; },
    async justUpdated() {
      let last = null;
      try { last = localStorage.getItem('kx-version'); localStorage.setItem('kx-version', version); } catch { /* τίποτα */ }
      return last && version && last !== version ? { to: version } : null;
    },
    openUpdateLog() {},
    onUpdate(cb) { updListener = cb; },
    users: () => call('GET', '/api/users'),
    addUser: (name, password) => call('POST', '/api/users', { name, password }),
    delUser: (name) => call('DELETE', '/api/users', { name }),
    changePassword: (current, password) => call('POST', '/api/password', { current, password }),
    async logout() { await call('POST', '/api/logout', {}).catch(() => {}); location.replace('/login'); }
  };
})();
