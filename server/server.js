'use strict';
/*
 * Κοινόχρηστα — server για το σπίτι.
 * Σερβίρει την ίδια εφαρμογή με το πρόγραμμα του υπολογιστή, κρατάει τα
 * δεδομένα σε ένα σημείο, φτιάχνει PDF, κρατάει αντίγραφα και ενημερώνεται μόνος του.
 * Χωρίς εξωτερικές βιβλιοθήκες: μόνο Node.
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');

const REPO = process.env.UPDATE_REPO || 'demelistasos/KOINOXRISTA';
const MAX_BODY = 25 * 1024 * 1024;

function start({ appDir, version, dataDir, onHealthy = () => {} }) {
  const PORT = Number(process.env.PORT || 8080);
  const DATA = dataDir;
  const SRC = path.join(appDir, 'src');
  const PUB = path.join(appDir, 'server', 'public');
  const F = {
    data: path.join(DATA, 'koinoxrista.json'),
    prev: path.join(DATA, 'koinoxrista.previous.json'),
    meta: path.join(DATA, 'meta.json'),
    users: path.join(DATA, 'users.json'),
    sessions: path.join(DATA, 'sessions.json'),
    backups: path.join(DATA, 'backups'),
    pdf: path.join(DATA, 'pdf'),
    log: path.join(DATA, 'server.log')
  };
  for (const d of [DATA, F.backups, F.pdf]) fs.mkdirSync(d, { recursive: true });

  // ---------- βοηθητικά ----------
  const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
  const writeAtomic = (f, text) => { const tmp = f + '.tmp-' + process.pid; fs.writeFileSync(tmp, text); fs.renameSync(tmp, f); };
  const log = (...a) => {
    const line = `${new Date().toISOString()} ${a.join(' ')}\n`;
    process.stdout.write(line);
    try { fs.appendFileSync(F.log, line); const st = fs.statSync(F.log); if (st.size > 2e6) fs.renameSync(F.log, F.log + '.1'); } catch { /* τίποτα */ }
  };
  const stamp = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
  };
  const safe = (s) => String(s || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim().slice(0, 120) || 'χωρίς όνομα';

  // ---------- κατάσταση ----------
  let meta = readJson(F.meta, { rev: 0 });
  let users = readJson(F.users, []);
  let sessions = readJson(F.sessions, {});
  const saveUsers = () => writeAtomic(F.users, JSON.stringify(users, null, 1));
  let sessTimer = null;
  const saveSessions = () => { clearTimeout(sessTimer); sessTimer = setTimeout(() => writeAtomic(F.sessions, JSON.stringify(sessions)), 200); };
  const status = { backup: readJson(path.join(DATA, 'backup-status.json'), {}), update: { current: version } };
  const saveBackupStatus = () => writeAtomic(path.join(DATA, 'backup-status.json'), JSON.stringify(status.backup));

  // ---------- κωδικοί ----------
  const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
  const findUser = (name) => users.find((u) => u.name.toLocaleLowerCase('el') === String(name || '').trim().toLocaleLowerCase('el'));
  function checkPw(u, pw) {
    const h = Buffer.from(hashPw(pw, u.salt), 'hex');
    const want = Buffer.from(u.hash, 'hex');
    return h.length === want.length && crypto.timingSafeEqual(h, want);
  }
  function makeUser(name, pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    return { name: String(name).trim().slice(0, 40), salt, hash: hashPw(pw, salt), created: new Date().toISOString() };
  }
  const SESSION_DAYS = 400;
  function newSession(user) {
    const token = crypto.randomBytes(32).toString('base64url');
    sessions[token] = { user, exp: Date.now() + SESSION_DAYS * 864e5 };
    saveSessions();
    return token;
  }
  function sessionOf(req) {
    const m = /(?:^|;\s*)kx_s=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
    if (!m) return null;
    const s = sessions[m[1]];
    if (!s || s.exp < Date.now() || !findUser(s.user)) return null;
    return { token: m[1], user: findUser(s.user).name };
  }
  const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';
  const cookie = (req, token, maxAge) => `kx_s=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;

  // Προστασία από μαντέματα κωδικού: 8 λάθος προσπάθειες ανά 10 λεπτά ανά διεύθυνση.
  const fails = new Map();
  const ipOf = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  function tooMany(ip) { const f = fails.get(ip); return f && f.n >= 8 && Date.now() - f.t < 10 * 60e3; }
  function failed(ip) { const f = fails.get(ip); if (!f || Date.now() - f.t > 10 * 60e3) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; }

  // ---------- απαντήσεις ----------
  const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' };
  function send(res, code, body, headers = {}) {
    const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
    const buf = isObj ? Buffer.from(JSON.stringify(body)) : Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''));
    res.writeHead(code, { ...SEC, 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store', ...headers });
    res.end(buf);
  }
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf', '.ico': 'image/x-icon' };
  async function sendFile(res, file, extra = {}) {
    try {
      const st = await fsp.stat(file);
      if (!st.isFile()) throw new Error('όχι αρχείο');
      res.writeHead(200, { ...SEC, 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', ...extra });
      fs.createReadStream(file).pipe(res);
    } catch { send(res, 404, 'Δεν βρέθηκε'); }
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let n = 0;
      req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new Error('Πολύ μεγάλο αίτημα')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('Μη έγκυρα δεδομένα')); } });
      req.on('error', reject);
    });
  }
  // Μέσα σε ένα path δεν επιτρέπουμε έξοδο από τον φάκελο.
  function inside(root, rel) {
    const p = path.resolve(root, '.' + path.sep + rel);
    return p === root || p.startsWith(root + path.sep) ? p : null;
  }

  // ---------- δεδομένα ----------
  function loadData() { return readJson(F.data, null); }
  function saveData(d, user) {
    if (fs.existsSync(F.data)) { try { fs.copyFileSync(F.data, F.prev); } catch { /* τίποτα */ } }
    writeAtomic(F.data, JSON.stringify(d));
    meta = { rev: (meta.rev || 0) + 1, by: user, at: new Date().toISOString() };
    writeAtomic(F.meta, JSON.stringify(meta));
  }

  // ---------- αντίγραφα ----------
  const KEEP = 90;
  async function prune(dir, keep) {
    const files = (await fsp.readdir(dir)).filter((f) => /^koinoxrista-.*\.json$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) await fsp.unlink(path.join(dir, f)).catch(() => {});
  }
  async function makeBackup(reason) {
    if (!fs.existsSync(F.data)) return null;
    const name = `koinoxrista-${stamp()}-${safe(reason).replace(/ /g, '-')}.json`;
    await fsp.copyFile(F.data, path.join(F.backups, name));
    await prune(F.backups, KEEP);
    status.backup.last = new Date().toISOString();
    status.backup.lastFile = name;
    await copyOffServer(name);
    saveBackupStatus();
    log('[backup]', name);
    return name;
  }
  // Δεύτερο αντίγραφο έξω από τον δίσκο του server: σε USB (ή σε όποιον φάκελο ορίσεις).
  function offServerTargets() {
    const out = [];
    if (process.env.BACKUP_COPY_DIR) out.push(process.env.BACKUP_COPY_DIR);
    const root = process.env.USB_ROOT || '/media';
    try {
      const mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n').map((l) => l.split(' ')[1]).filter(Boolean)
        .map((m) => m.replace(/\\040/g, ' ')).filter((m) => m.startsWith(root + '/'));
      for (const m of mounts) out.push(path.join(m, 'Koinoxrista-antigrafa'));
    } catch { /* όχι Linux */ }
    return [...new Set(out)];
  }
  async function copyOffServer(name) {
    const targets = offServerTargets();
    status.backup.copies = [];
    for (const dir of targets) {
      try {
        await fsp.mkdir(dir, { recursive: true });
        await fsp.copyFile(path.join(F.backups, name), path.join(dir, name));
        await prune(dir, 60);
        status.backup.copies.push({ dir, ok: true });
        status.backup.lastCopy = new Date().toISOString();
      } catch (err) { status.backup.copies.push({ dir, ok: false, error: err.code || err.message }); }
    }
  }
  async function dailyBackup() {
    const today = stamp().slice(0, 10);
    const files = await fsp.readdir(F.backups).catch(() => []);
    if (!files.some((f) => f.startsWith('koinoxrista-' + today))) await makeBackup('ημερήσιο').catch((e) => log('[backup] σφάλμα', e.message));
  }

  // ---------- PDF ----------
  const CHROME = process.env.CHROME_BIN || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
  let pdfQueue = Promise.resolve();
  function htmlToPdf(html) {
    const job = pdfQueue.then(() => new Promise((resolve, reject) => {
      if (!CHROME) return reject(new Error('Δεν υπάρχει Chromium στον server'));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-pdf-'));
      const inF = path.join(dir, 'in.html'); const outF = path.join(dir, 'out.pdf');
      fs.writeFileSync(inF, html);
      execFile(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--no-pdf-header-footer',
        '--run-all-compositor-stages-before-draw', `--user-data-dir=${path.join(dir, 'prof')}`, `--print-to-pdf=${outF}`, 'file://' + inF],
      { timeout: 60e3 }, (err) => {
        let buf = null;
        try { buf = fs.readFileSync(outF); } catch { /* τίποτα */ }
        fs.rm(dir, { recursive: true, force: true }, () => {});
        if (!buf || !buf.length) return reject(new Error('Το PDF δεν δημιουργήθηκε' + (err ? ': ' + err.message.split('\n')[0] : '')));
        resolve(buf);
      });
    }));
    pdfQueue = job.catch(() => {});
    return job;
  }

  // ---------- αυτόματη ενημέρωση ----------
  const updater = require('./selfupdate.js')({ repo: REPO, version, dataDir: DATA, log, status: status.update });

  // ---------- λίστα PDF ----------
  async function pdfTree() {
    const out = [];
    async function walk(rel) {
      const ents = await fsp.readdir(path.join(F.pdf, rel), { withFileTypes: true }).catch(() => []);
      for (const e of ents) {
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) await walk(r);
        else if (e.name.toLowerCase().endsWith('.pdf')) { const st = await fsp.stat(path.join(F.pdf, r)); out.push({ path: r, size: st.size, mtime: st.mtime.toISOString() }); }
      }
    }
    await walk('');
    return out.sort((a, b) => b.path.localeCompare(a.path, 'el'));
  }

  // ---------- δρομολόγηση ----------
  const PUBLIC = new Set(['/login', '/login.html', '/login.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.ico', '/styles.css', '/glass.css']);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    const method = req.method;

    // Προστασία CSRF: οι αλλαγές δεχονται μόνο από την ίδια την εφαρμογή.
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) { let h = ''; try { h = new URL(origin).host; } catch { /* τίποτα */ } if (h !== req.headers.host && h !== req.headers['x-forwarded-host'] && !/\.ts\.net(:\d+)?$/.test(h)) return send(res, 403, { error: 'Μη επιτρεπτή προέλευση' }); }
      if (!String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'Αναμενόταν JSON' });
    }

    if (p === '/healthz') return send(res, 200, 'ok');

    // --- σύνδεση ---
    if (p === '/api/session' && method === 'GET') { const s = sessionOf(req); return send(res, 200, { user: s ? s.user : null, needsSetup: users.length === 0, version }); }
    if (p === '/api/setup' && method === 'POST') {
      if (users.length) return send(res, 409, { error: 'Υπάρχει ήδη λογαριασμός' });
      const b = await readBody(req);
      if (!String(b.name || '').trim() || String(b.password || '').length < 6) return send(res, 400, { error: 'Όνομα και κωδικός τουλάχιστον 6 χαρακτήρων' });
      users.push(makeUser(b.name, b.password)); saveUsers();
      log('[auth] πρώτος λογαριασμός', b.name);
      const t = newSession(users[0].name);
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, t, SESSION_DAYS * 86400) });
    }
    if (p === '/api/login' && method === 'POST') {
      const ip = ipOf(req);
      if (tooMany(ip)) return send(res, 429, { error: 'Πολλές λάθος προσπάθειες. Δοκίμασε ξανά σε λίγα λεπτά.' });
      const b = await readBody(req);
      const u = findUser(b.name);
      if (!u || !checkPw(u, b.password || '')) { failed(ip); log('[auth] λάθος σύνδεση', ip, String(b.name || '').slice(0, 40)); return send(res, 401, { error: 'Λάθος όνομα ή κωδικός' }); }
      fails.delete(ip);
      const t = newSession(u.name);
      log('[auth] σύνδεση', u.name, ip);
      return send(res, 200, { ok: true, user: u.name }, { 'Set-Cookie': cookie(req, t, SESSION_DAYS * 86400) });
    }
    if (p === '/api/logout' && method === 'POST') {
      const s = sessionOf(req); if (s) { delete sessions[s.token]; saveSessions(); }
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }

    // --- δημόσια αρχεία ---
    if (method === 'GET' && PUBLIC.has(p)) {
      if (p === '/login' || p === '/login.html') return sendFile(res, path.join(PUB, 'login.html'));
      if (p === '/login.js') return sendFile(res, path.join(PUB, 'login.js'));
      if (p === '/favicon.ico') return sendFile(res, path.join(SRC, 'icon-192.png'));
      return sendFile(res, path.join(SRC, p.slice(1)));
    }

    const s = sessionOf(req);
    if (!s) {
      if (p.startsWith('/api/')) return send(res, 401, { error: 'Χρειάζεται σύνδεση' });
      res.writeHead(302, { Location: '/login' }); return res.end();
    }

    // --- δεδομένα ---
    if (p === '/api/data' && method === 'GET') return send(res, 200, { data: loadData(), rev: meta.rev || 0 });
    if (p === '/api/data' && method === 'PUT') {
      const b = await readBody(req);
      if (!b.data || !Array.isArray(b.data.buildings)) return send(res, 400, { error: 'Μη έγκυρα δεδομένα' });
      if (Number(b.rev) !== (meta.rev || 0)) return send(res, 409, { error: 'Τα στοιχεία άλλαξαν από άλλη συσκευή', rev: meta.rev, by: meta.by, at: meta.at });
      saveData(b.data, s.user);
      return send(res, 200, { rev: meta.rev });
    }
    if (p === '/api/rev' && method === 'GET') return send(res, 200, { rev: meta.rev || 0, by: meta.by || null, at: meta.at || null, version });
    if (p === '/api/version' && method === 'GET') return send(res, 200, { version, update: status.update });

    // --- αντίγραφα ---
    if (p === '/api/backup' && method === 'POST') {
      const b = await readBody(req);
      const name = await makeBackup(b.reason || 'χειροκίνητο');
      return send(res, 200, { file: name });
    }
    if (p === '/api/backups' && method === 'GET') {
      const files = (await fsp.readdir(F.backups).catch(() => [])).filter((f) => f.endsWith('.json')).sort().reverse();
      return send(res, 200, { files, status: status.backup, targets: offServerTargets() });
    }
    if (p.startsWith('/api/backups/') && method === 'GET') {
      const f = inside(F.backups, p.slice('/api/backups/'.length));
      if (!f) return send(res, 400, 'Μη έγκυρο όνομα');
      return sendFile(res, f, { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` });
    }

    // --- PDF ---
    if (p === '/api/pdf' && method === 'POST') {
      const b = await readBody(req);
      if (!b.html) return send(res, 400, { error: 'Λείπει το περιεχόμενο' });
      const rel = [safe(b.building), safe(b.subdir), safe(String(b.fileName || 'έγγραφο').replace(/\.pdf$/i, '')) + '.pdf'].join('/');
      try {
        const buf = await htmlToPdf(b.html);
        const out = inside(F.pdf, rel);
        await fsp.mkdir(path.dirname(out), { recursive: true });
        await fsp.writeFile(out, buf);
        log('[pdf]', s.user, rel);
        return send(res, 200, { path: rel, url: '/pdf/' + rel.split('/').map(encodeURIComponent).join('/') });
      } catch (err) { log('[pdf] σφάλμα', err.message); return send(res, 500, { error: err.message }); }
    }
    if (p === '/api/pdfs' && method === 'GET') return send(res, 200, { files: await pdfTree() });
    if (p.startsWith('/pdf/') && method === 'GET') {
      const f = inside(F.pdf, p.slice(5));
      if (!f) return send(res, 400, 'Μη έγκυρο όνομα');
      const dl = url.searchParams.get('dl') ? `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` : `inline; filename*=UTF-8''${encodeURIComponent(path.basename(f))}`;
      return sendFile(res, f, { 'Content-Disposition': dl });
    }

    // --- χρήστες ---
    if (p === '/api/users' && method === 'GET') return send(res, 200, { me: s.user, users: users.map((u) => ({ name: u.name, created: u.created })) });
    if (p === '/api/users' && method === 'POST') {
      const b = await readBody(req);
      const name = String(b.name || '').trim();
      if (!name || String(b.password || '').length < 6) return send(res, 400, { error: 'Όνομα και κωδικός τουλάχιστον 6 χαρακτήρων' });
      if (findUser(name)) return send(res, 409, { error: 'Υπάρχει ήδη χρήστης με αυτό το όνομα' });
      if (users.length >= 20) return send(res, 400, { error: 'Πάρα πολλοί χρήστες' });
      users.push(makeUser(name, b.password)); saveUsers(); log('[auth] νέος χρήστης', name, 'από', s.user);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/users' && method === 'DELETE') {
      const b = await readBody(req);
      const u = findUser(b.name);
      if (!u) return send(res, 404, { error: 'Δεν βρέθηκε' });
      if (u.name === s.user) return send(res, 400, { error: 'Δεν μπορείς να διαγράψεις τον εαυτό σου' });
      users = users.filter((x) => x !== u); saveUsers();
      for (const [t, x] of Object.entries(sessions)) if (x.user === u.name) delete sessions[t];
      saveSessions(); log('[auth] διαγραφή χρήστη', u.name, 'από', s.user);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/password' && method === 'POST') {
      const b = await readBody(req);
      const u = findUser(s.user);
      if (!checkPw(u, b.current || '')) return send(res, 401, { error: 'Λάθος τωρινός κωδικός' });
      if (String(b.password || '').length < 6) return send(res, 400, { error: 'Ο νέος κωδικός θέλει τουλάχιστον 6 χαρακτήρες' });
      Object.assign(u, makeUser(u.name, b.password), { created: u.created }); saveUsers();
      for (const [t, x] of Object.entries(sessions)) if (x.user === u.name && t !== s.token) delete sessions[t];
      saveSessions();
      return send(res, 200, { ok: true });
    }

    // --- ενημέρωση ---
    if (p === '/api/update-check' && method === 'POST') { updater.check().catch(() => {}); return send(res, 200, { ok: true, update: status.update }); }

    // --- η εφαρμογή ---
    if (method === 'GET') {
      if (p === '/' || p === '/index.html') return sendFile(res, path.join(SRC, 'index.html'));
      if (p === '/arxeio') return sendFile(res, path.join(PUB, 'arxeio.html'));
      if (p === '/arxeio.js') return sendFile(res, path.join(PUB, 'arxeio.js'));
      const f = inside(SRC, p.slice(1));
      if (f && /\.(js|css|png|svg|webmanifest)$/.test(f)) return sendFile(res, f);
    }
    return send(res, 404, 'Δεν βρέθηκε');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => { log('[σφάλμα]', req.method, req.url, err.stack || err.message); if (!res.headersSent) send(res, 500, { error: err.message }); });
  });
  server.listen(PORT, () => {
    log(`[server] Κοινόχρηστα ${version} στη θύρα ${PORT} · δεδομένα: ${DATA} · PDF: ${CHROME || 'χωρίς Chromium'}`);
    setTimeout(onHealthy, 20e3);
    setTimeout(() => dailyBackup(), 30e3);
    setInterval(() => dailyBackup(), 60 * 60e3);
    // καθάρισμα ληγμένων συνδέσεων
    setInterval(() => { let ch = false; for (const [t, x] of Object.entries(sessions)) if (x.exp < Date.now()) { delete sessions[t]; ch = true; } if (ch) saveSessions(); }, 6 * 3600e3);
    updater.schedule();
  });
  const stop = () => { log('[server] τερματισμός'); server.close(); clearTimeout(sessTimer); writeAtomic(F.sessions, JSON.stringify(sessions)); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

module.exports = { start };
