/* Κοινόχρηστα — εφαρμογή (renderer). */
(function () {
  'use strict';
  const C = window.Calc;
  const R = window.Reports;
  const api = window.api || null;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const KEY = 'koinoxrista-data';

  // ---------- αποθήκευση ----------
  const store = api ? { load: api.load, save: api.save } : {
    load: async () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
    save: async (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* χωρίς αποθήκευση */ } return true; }
  };

  let data = null;
  const ui = { bId: null, pId: null, tab: 'month' };
  let saveTimer = null;
  let lastSaved = null;
  let pdfDefault = '';
  let backupDefault = '';

  // Αυτόματο αντίγραφο ασφαλείας (στο κλείσιμο μήνα, μία φορά τη μέρα, πριν από επαναφορά).
  async function autoBackup(reason) {
    if (!api || !api.autoBackup || !data || !data.buildings.length) return null;
    try {
      const f = await api.autoBackup(data, reason, data.prefs.backupDir || backupDefault);
      data.prefs.lastBackup = new Date().toISOString();
      data.prefs.lastBackupFile = f;
      scheduleSave();
      return f;
    } catch (err) { toast('Δεν έγινε αντίγραφο ασφαλείας: ' + err.message); return null; }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    setSaveState('Αποθήκευση…');
    saveTimer = setTimeout(saveNow, 350);
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    data.ui = { bId: ui.bId, tab: ui.tab };
    try {
      await store.save(data);
      lastSaved = new Date();
      setSaveState('Αποθηκεύτηκε ' + lastSaved.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      setSaveState('Σφάλμα αποθήκευσης');
      toast('Δεν αποθηκεύτηκαν οι αλλαγές: ' + err.message);
    }
  }
  function setSaveState(t) { const el = $('#saveState'); if (el) el.textContent = t; }

  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    d.version = 1;
    d.buildings = Array.isArray(d.buildings) ? d.buildings : [];
    d.prefs = d.prefs || { theme: 'system' };
    d.buildings.forEach((b) => {
      b.apartments = b.apartments || [];
      b.periods = b.periods || [];
      b.elevatorFactors = b.elevatorFactors || {};
      b.recurring = b.recurring || ['management', 'cleaning'];
      if (b.note === undefined) b.note = C.DEFAULT_NOTE;
      if (b.receiptOverview === undefined) b.receiptOverview = true;
      b.periods.forEach((p) => { p.rows = p.rows || {}; p.expenses = p.expenses || {}; p.oil = p.oil || { purchases: [] }; p.oil.purchases = p.oil.purchases || []; });
      sortPeriods(b);
    });
    return d;
  }
  const pkey = (p) => p.year * 12 + p.month;
  const sortPeriods = (b) => b.periods.sort((a, c) => pkey(a) - pkey(c));

  // ---------- επιλογείς ----------
  const building = () => data.buildings.find((b) => b.id === ui.bId) || null;
  function period(b = building()) {
    if (!b || !b.periods.length) return null;
    return b.periods.find((p) => p.id === ui.pId) || b.periods[b.periods.length - 1];
  }
  const isLast = (b, p) => b.periods[b.periods.length - 1] === p;
  // Σειρά διαμερισμάτων: η δική του (πεδίο order, από σύρσιμο) αν υπάρχει, αλλιώς όροφος και κωδικός.
  const byFloor = (a, c) => (C.num(a.floor) - C.num(c.floor)) || String(a.code).localeCompare(String(c.code), 'el', { numeric: true });
  const hasCustomOrder = (list) => list.length > 0 && list.every((a) => typeof a.order === 'number');
  const sortApts = (list) => list.slice().sort(hasCustomOrder(list) ? (a, c) => a.order - c.order : byFloor);
  // Μετακινεί το διαμέρισμα id στη θέση toIndex και γράφει τη νέα σειρά σε όλα.
  function reorderApt(b, id, toIndex) {
    const list = sortApts(b.apartments);
    const from = list.findIndex((a) => a.id === id);
    if (from < 0) return;
    const [x] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, x);
    list.forEach((a, i) => { a.order = i; });
  }
  const aptsFor = (b, p) => sortApts(p.status === 'closed' && p.aptSnapshot ? p.aptSnapshot : b.apartments);
  const settingsFor = (b, p) => (p.status === 'closed' && p.settingsSnapshot ? p.settingsSnapshot : { elevatorFactors: b.elevatorFactors });
  function ensureRows(b, p) {
    if (!p || p.status !== 'open') return;
    b.apartments.forEach((a) => { if (!p.rows[a.id]) p.rows[a.id] = { prevUnits: '', currUnits: '', prevBalance: '', payment: '' }; });
  }
  const computeFor = (b, p) => C.compute(aptsFor(b, p), p, settingsFor(b, p));
  const MONTHS_GEN = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
  const centsStr = (c) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');

  // Ο κλειστός μήνας ακριβώς πριν από τον ανοιχτό (εκεί σημειώνονται οι εισπράξεις).
  function prevClosed(b, p) {
    if (!p || p.status !== 'open') return null;
    const i = b.periods.indexOf(p);
    const prev = i > 0 ? b.periods[i - 1] : null;
    return prev && prev.status === 'closed' ? prev : null;
  }
  // Η οφειλή του ανοιχτού μήνα = υπόλοιπο του προηγούμενου (σύνολο − πληρωμή).
  function syncBalances(b) {
    const p = b.periods[b.periods.length - 1];
    const prev = prevClosed(b, p);
    if (!prev) return;
    computeFor(b, prev).results.forEach((r) => {
      if (!p.rows[r.id]) p.rows[r.id] = { prevUnits: '', currUnits: '', prevBalance: '', payment: '' };
      p.rows[r.id].prevBalance = centsStr(r.newBalance);
    });
  }
  const expLabel = (key, p) => (key === 'extra' && p && p.extraLabel ? `Λοιπά: ${p.extraLabel}` : (C.ALL_EXPENSES.find((x) => x.key === key) || {}).label);

  // ---------- εικονίδια ----------
  const I = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V9m0 0-4 4m4-4 4 4M5 4h14"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    chevUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/></svg>'
  };

  // ---------- βοηθητικά UI ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function modal(html, { wide = false, onMount } = {}) {
    const root = $('#modal');
    root.innerHTML = `<div class="dialog${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    const prevFocus = document.activeElement;
    const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    root.onclick = (e) => { if (e.target === root) close(); };
    $$('[data-close]', root).forEach((b) => b.addEventListener('click', close));
    const first = $('input, textarea, select', root) || $('.btn.primary', root);
    if (first) setTimeout(() => first.focus(), 30);
    if (onMount) onMount(root, close);
    return close;
  }

  function confirmBox({ title, message, ok = 'Συνέχεια', danger = false }) {
    return new Promise((resolve) => {
      let done = false;
      const close = modal(`<div class="d-h"><h2>${esc(title)}</h2></div><div class="d-b"><div>${message}</div></div>
        <div class="d-f"><button class="btn ghost" data-close>Άκυρο</button><button class="btn ${danger ? 'danger' : 'primary'}" id="okBtn">${esc(ok)}</button></div>`,
      { onMount: (root, cl) => { $('#okBtn', root).onclick = () => { done = true; cl(); resolve(true); }; setTimeout(() => $('#okBtn', root).focus(), 40); } });
      const obs = new MutationObserver(() => { if (!$('#modal').innerHTML) { obs.disconnect(); if (!done) resolve(false); } });
      obs.observe($('#modal'), { childList: true });
      void close;
    });
  }

  function applyTheme() {
    const t = (data && data.prefs.theme) || 'system';
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  // ---------- ενημερώσεις εφαρμογής (πάντα με ερώτηση) ----------
  const upd = { status: '', version: '', current: '', canAuto: false, url: '', percent: 0, later: false, reason: '' };
  const UPD_WHY = {
    programfiles: 'Η εφαρμογή είναι σε φάκελο όπου δεν μπορεί να γράψει μόνη της.',
    readonly: 'Ο φάκελος της εφαρμογής δεν επιτρέπει αλλαγές.',
    translocated: 'Το Mac τρέχει την εφαρμογή από προσωρινή θέση. Βάλε τα Κοινόχρηστα στις Εφαρμογές και άνοιξέ τα από εκεί· η επόμενη ενημέρωση θα γίνει με ένα κλικ.',
    notbundle: 'Η εφαρμογή δεν τρέχει από τον φάκελο Εφαρμογές.',
    noassets: 'Η νέα έκδοση δεν έχει ακόμα αρχεία για αυτόματη ενημέρωση σε αυτόν τον υπολογιστή.',
    datainside: 'Τα στοιχεία σου είναι μέσα στον φάκελο του προγράμματος.'
  };
  function updLine() {
    const v = upd.current ? 'Έκδοση ' + upd.current : 'Ενημερώσεις';
    return ({ checking: v + ' · έλεγχος…', latest: v + ' · η πιο νέα', error: v + ' · χωρίς έλεγχο', available: v + ' · νέα ' + upd.version })[upd.status] || v;
  }
  function renderUpdate() {
    const line = $('#updLine'); if (line) line.textContent = updLine();
    let box = $('#updBox');
    if (!box) { box = document.createElement('div'); box.id = 'updBox'; box.className = 'upd'; document.body.appendChild(box); }
    const s = upd.status;
    let html = '';
    if (s === 'available' && !upd.later) {
      html = upd.canAuto
        ? `<b>Νέα έκδοση ${esc(upd.version)}</b><p>Τα Κοινόχρηστα μπορούν να ενημερωθούν τώρα. Τα στοιχεία σου δεν αλλάζουν.</p><div class="upd-a"><button class="btn sm ghost" data-act="update-later">Αργότερα</button><button class="btn sm primary" data-act="update-now">Ενημέρωση τώρα</button></div>`
        : `<b>Νέα έκδοση ${esc(upd.version)}</b><p>${esc(UPD_WHY[upd.reason] || '')} Κατέβασέ την και εγκατάστησέ την πάνω από την τωρινή· τα στοιχεία σου δεν χάνονται.</p><div class="upd-a"><button class="btn sm ghost" data-act="update-later">Αργότερα</button><button class="btn sm primary" data-act="update-open">Κατέβασμα</button></div>`;
    } else if (s === 'progress') {
      html = `<b>Κατεβαίνει η έκδοση ${esc(upd.version)}…</b><div class="upd-bar"><i style="width:${upd.percent || 0}%"></i></div><p>${upd.percent || 0}% · μην κλείσεις τον υπολογιστή</p>`;
    } else if (s === 'verifying') html = '<b>Έλεγχος του αρχείου…</b><div class="upd-bar"><i style="width:100%"></i></div>';
    else if (s === 'installing') html = `<b>Μπαίνει η έκδοση ${esc(upd.version)}…</b><div class="upd-bar busy"><i></i></div>`;
    else if (s === 'restarting') html = '<b>Τα Κοινόχρηστα κλείνουν και ξανανοίγουν…</b><div class="upd-bar busy"><i></i></div>';
    else if (s === 'install-error') html = `<b class="owed">Η ενημέρωση δεν έγινε</b><p>${esc(upd.message || '')} Η τωρινή έκδοση συνεχίζει κανονικά.</p><div class="upd-a"><button class="btn sm ghost" data-act="update-log">Ημερολόγιο</button><button class="btn sm" data-act="update-open">Με το χέρι</button><button class="btn sm primary" data-act="update-now">Ξανά</button></div>`;
    box.innerHTML = html;
    box.classList.toggle('show', !!html);
  }
  async function updateNow() {
    if (!api || !upd.canAuto) return;
    const ok = await confirmBox({ title: `Ενημέρωση στην έκδοση ${upd.version}`, message: 'Η εφαρμογή θα κατεβάσει τη νέα έκδοση, θα <b>κλείσει</b> και θα <b>ξανανοίξει μόνη της</b>.<ul style="margin:8px 0 0;padding-left:18px"><li>Τα στοιχεία σου δεν αλλάζουν· πριν από την ενημέρωση κρατιέται και αντίγραφο.</li><li>Αν κάτι δεν πάει καλά, μένει η τωρινή έκδοση.</li></ul>', ok: 'Ενημέρωση τώρα' });
    if (!ok) return;
    await saveNow();
    upd.status = 'progress'; upd.percent = 0; renderUpdate();
    const r = await api.installUpdate();
    if (r && !r.ok && r.error) toast(r.error);
  }

  // ---------- rail ----------
  function renderRail() {
    const themeLabel = { system: 'Θέμα: σύστημα', light: 'Θέμα: φωτεινό', dark: 'Θέμα: σκούρο' }[data.prefs.theme || 'system'];
    $('#rail').innerHTML = `
      <div class="brand"><div class="brand-mark">Κ</div><div><div class="brand-name">Κοινόχρηστα</div><div class="brand-sub">διαχείριση πολυκατοικίας</div></div></div>
      ${data.buildings.length ? '<div class="rail-label">Πολυκατοικίες</div>' : ''}
      <ul class="b-list">${data.buildings.map((b) => {
        const p = b.periods[b.periods.length - 1];
        return `<li><button class="b-item" data-act="pick-building" data-id="${b.id}" aria-current="${b.id === ui.bId}">
          <span class="b-name">${esc(b.name)}</span><span class="b-dot ${p && p.status === 'open' ? 'open' : ''}" title="${p && p.status === 'open' ? 'Ανοιχτός μήνας' : ''}"></span>
          <span class="b-meta">${b.apartments.length} διαμ.${p ? ' · ' + esc(C.periodLabel(p)) : ''}</span></button></li>`;
      }).join('')}</ul>
      <button class="rail-add" data-act="new-building">${I.plus.replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px;margin-right:6px"')}Νέα πολυκατοικία</button>
      <div class="rail-foot">
        <button class="rail-link" data-act="backup">${I.down}Αντίγραφο ασφαλείας</button>
        <button class="rail-link" data-act="restore">${I.up}Επαναφορά αντιγράφου</button>
        <button class="rail-link" data-act="theme">${I.moon}${themeLabel}</button>
        <button class="rail-link" data-act="update-check">${I.refresh}<span id="updLine">${esc(updLine())}</span></button>
        <div class="save-state" id="saveState">${lastSaved ? 'Αποθηκεύτηκε ' + lastSaved.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }) : 'Αποθηκεύεται αυτόματα'}</div>
      </div>`;
  }

  // ---------- stage ----------
  function render() {
    renderRail();
    const b = building();
    const st = $('#stage');
    if (!b) { st.innerHTML = welcome(); return; }
    const p = period(b);
    ui.pId = p ? p.id : null;
    ensureRows(b, p);
    syncBalances(b);
    st.innerHTML = head(b, p) + `<div class="body" id="body">${tabBody(b, p)}</div>`;
    refresh();
  }

  function welcome() {
    return `<div class="welcome">
      <h1>Τα κοινόχρηστα,<br>χωρίς λογιστικά φύλλα.</h1>
      <p>Πέρασε τα έξοδα του μήνα, τις ενδείξεις των θερμιδομετρητών και το πετρέλαιο. Η εφαρμογή μοιράζει κάθε ευρώ στο λεπτό και βγάζει έτοιμα ειδοποιητήρια σε PDF.</p>
      <div class="actions"><button class="btn primary" data-act="new-building">${I.plus}Νέα πολυκατοικία</button><button class="btn" data-act="demo">${I.spark}Δοκιμή με παράδειγμα</button></div>
      <ol><li>Πρόσθεσε τα διαμερίσματα με τετραγωνικά και όροφο.</li><li>Συμπλήρωσε τα έξοδα και τις ενδείξεις του μήνα.</li><li>Βγάλε τον πίνακα και τα ειδοποιητήρια, και κλείσε τον μήνα.</li></ol>
    </div>`;
  }

  function head(b, p) {
    const idx = p ? b.periods.indexOf(p) : -1;
    const opts = b.periods.slice().reverse().map((x) => `<option value="${x.id}" ${x === p ? 'selected' : ''}>${esc(C.periodLabel(x))}${x.status === 'closed' ? '' : ' •'}</option>`).join('');
    const canReopen = p && p.status === 'closed' && idx === b.periods.length - 2 && b.periods[b.periods.length - 1].status === 'open';
    const tabs = [['month', 'Μήνας'], ['apartments', 'Διαμερίσματα'], ['history', 'Ιστορικό'], ['settings', 'Ρυθμίσεις']];
    return `<header class="head">
      <div class="head-row">
        <div>
          <h1 class="title" id="bTitle">${esc(b.name)}</h1>
          <div class="subtitle">${b.address ? esc(b.address) + ' · ' : ''}${b.apartments.length} διαμερίσματα ${p ? `· <span class="badge ${p.status === 'closed' ? 'closed' : ''}">${p.status === 'closed' ? 'Κλειστός μήνας' : 'Ανοιχτός μήνας'}</span>` : ''}</div>
        </div>
        ${p ? `<div class="actions">
          <div class="period">
            <button class="icon-btn" data-act="period-step" data-dir="-1" aria-label="Προηγούμενος μήνας" ${idx <= 0 ? 'disabled' : ''}>${I.left}</button>
            <select id="periodSel" aria-label="Μήνας">${opts}</select>
            <button class="icon-btn" data-act="period-step" data-dir="1" aria-label="Επόμενος μήνας" ${idx >= b.periods.length - 1 ? 'disabled' : ''}>${I.right}</button>
          </div>
          <button class="btn" data-act="pdf-statement">${I.table}Πίνακας</button>
          <button class="btn" data-act="pdf-receipts">${I.receipt}Ειδοποιητήρια</button>
          ${p.status === 'open' ? `<button class="btn primary" data-act="close-month">${I.lock}Κλείσιμο μήνα</button>` : ''}
          ${canReopen ? `<button class="btn" data-act="reopen">${I.unlock}Άνοιγμα ξανά</button>` : ''}
        </div>` : ''}
      </div>
      <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-act="tab" data-tab="${k}" aria-selected="${ui.tab === k}">${l}</button>`).join('')}</nav>
    </header>`;
  }

  function tabBody(b, p) {
    if (ui.tab === 'apartments') return apartmentsTab(b, p);
    if (ui.tab === 'history') return historyTab(b);
    if (ui.tab === 'settings') return settingsTab(b);
    return monthTab(b, p);
  }

  // ---------- καρτέλα: μήνας ----------
  const field = (label, root, path, value, { suffix = '', cls = 'money', dis = false, extra = '', type = 'text', ph = '0,00' } = {}) => `
    <label class="field"><span>${label}${extra}</span><div class="affix"><input class="inp ${cls}" type="${type}" inputmode="decimal" data-root="${root}" data-path="${path}" value="${esc(value ?? '')}" placeholder="${ph}" ${dis ? 'disabled' : ''}>${suffix ? `<i>${suffix}</i>` : ''}</div></label>`;

  function monthTab(b, p) {
    if (!p) return '<div class="empty"><b>Δεν υπάρχει μήνας</b></div>';
    const dis = p.status === 'closed';
    const apts = aptsFor(b, p);
    const banner = dis ? `<div class="banner"><span>${I.lock.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px;margin-right:6px"')}Ο <b>${esc(C.periodLabel(p))}</b> έχει κλείσει${p.closedAt ? ' στις ' + new Date(p.closedAt).toLocaleDateString('el-GR') : ''}. Τα στοιχεία είναι μόνο για ανάγνωση — μπορείς ακόμα να βγάλεις PDF.${b.periods[b.periods.indexOf(p) + 1] && b.periods[b.periods.indexOf(p) + 1].status === 'open' ? ` Τις πληρωμές του τις σημειώνεις στον ${esc(C.MONTHS[b.periods[b.periods.indexOf(p) + 1].month])}, στην κάρτα «Εισπράξεις».` : ''}</span></div>` : '';

    const expenses = C.ALL_EXPENSES.map((x) => {
      const pinned = b.recurring.includes(x.key);
      const pinBtn = `<button class="icon-btn pin ${pinned ? 'on' : ''}" data-act="pin" data-key="${x.key}" title="${pinned ? 'Μεταφέρεται αυτόματα στον επόμενο μήνα' : 'Να μεταφέρεται στον επόμενο μήνα'}" aria-pressed="${pinned}">${I.pin}</button>`;
      return field(x.label, 'p', 'expenses.' + x.key, p.expenses[x.key], { suffix: '€', dis, extra: pinBtn });
    }).join('');

    const o = p.oil;
    const purchases = o.purchases.length ? o.purchases.map((x, i) => `<div class="p-row">
        <input class="inp" type="date" data-root="p" data-path="oil.purchases.${i}.date" value="${esc(x.date || '')}" ${dis ? 'disabled' : ''} aria-label="Ημερομηνία">
        <div class="affix"><input class="inp n" inputmode="decimal" data-root="p" data-path="oil.purchases.${i}.liters" value="${esc(x.liters ?? '')}" placeholder="Λίτρα" ${dis ? 'disabled' : ''}><i>lt</i></div>
        <div class="affix"><input class="inp n" inputmode="decimal" data-root="p" data-path="oil.purchases.${i}.price" value="${esc(x.price ?? '')}" placeholder="Τιμή" ${dis ? 'disabled' : ''}><i>€/lt</i></div>
        <span class="cost" data-out="pc:${i}"></span>
        <button class="icon-btn" data-act="del-purchase" data-i="${i}" aria-label="Διαγραφή αγοράς" ${dis ? 'disabled' : ''}>${I.trash}</button>
      </div>`).join('') : '<div class="p-empty">Καμία αγορά πετρελαίου αυτόν τον μήνα.</div>';

    // Το προηγούμενο υπόλοιπο έρχεται αυτόματα από τον προηγούμενο κλειστό μήνα.
    const prevP = prevClosed(b, p);
    const derivedIds = new Set(prevP ? aptsFor(b, prevP).map((a) => a.id) : []);
    const rowsHtml = apts.map((a) => {
      const r = p.rows[a.id] || {};
      const cell = (k, ph = '') => `<td><input class="inp n" inputmode="decimal" data-root="p" data-path="rows.${a.id}.${k}" value="${esc(r[k] ?? '')}" placeholder="${ph}" ${dis ? 'disabled' : ''}></td>`;
      return `<tr>
        <td class="code">${esc(a.code)}</td><td class="owner" title="${esc(a.owner)}">${esc(a.owner)}</td><td class="muted">${esc(C.floorLabel(a.floor))}</td>
        ${a.meterWith && a.meterShared !== false && apts.some((x) => x.id === a.meterWith) ? `<td colspan="2" class="shared">κοινός με ${esc((apts.find((x) => x.id === a.meterWith) || {}).code || '')} · ÷${apts.filter((x) => x.meterWith === a.meterWith && x.meterShared !== false).length + 1}</td>` : cell('prevUnits', '0') + cell('currUnits', '—')}
        <td class="r" data-out="r:${a.id}:units"></td>
        ${dis || derivedIds.has(a.id) ? `<td class="r" data-out="r:${a.id}:prevBalance"></td>` : cell('prevBalance', '0,00')}
        ${dis ? `<td class="r" data-out="r:${a.id}:adjust" title="${esc(r.adjustNote || '')}"></td>` : `<td class="adj"><input class="inp n" inputmode="decimal" data-root="p" data-path="rows.${a.id}.adjust" value="${esc(r.adjust ?? '')}" placeholder="0,00" aria-label="Διόρθωση οφειλής"><input class="inp note" data-root="p" data-path="rows.${a.id}.adjustNote" value="${esc(r.adjustNote ?? '')}" placeholder="αιτία" aria-label="Αιτία διόρθωσης"></td>`}
        <td class="r strong" data-out="r:${a.id}:total"></td>
        ${dis ? `<td class="r" data-out="r:${a.id}:payment"></td><td class="r" data-out="r:${a.id}:newBalance"></td>` : ''}
      </tr>`;
    }).join('');

    return `${banner}${collectionsCard(b, p)}<div class="grid-main"><div class="stack">
      <section class="card">
        <div class="card-h"><h2>Έξοδα μήνα</h2><span class="hint">Η πινέζα κρατά το ποσό και τον επόμενο μήνα</span></div>
        <div class="card-b"><div class="fields">${expenses}
          <label class="field"><span>Περιγραφή λοιπών</span><input class="inp" data-root="p" data-path="extraLabel" value="${esc(p.extraLabel || '')}" placeholder="π.χ. αλλαγή λαμπτήρων" ${dis ? 'disabled' : ''}></label>
        </div></div>
        <div class="card-f"><span>Σύνολο εξόδων</span><strong class="tnum" data-out="tot:expensesSum"></strong></div>
      </section>

      <section class="card">
        <div class="card-h"><h2>Πετρέλαιο θέρμανσης</h2><span class="hint">Κοστολόγηση με μέση τιμή αποθέματος</span></div>
        <div class="card-b">
          <div class="fields">
            ${field('Απόθεμα αρχής', 'p', 'oil.startLiters', o.startLiters, { suffix: 'lt', cls: 'n', dis })}
            ${field('Τιμή αποθέματος', 'p', 'oil.startPrice', o.startPrice, { suffix: '€/lt', cls: 'n', dis, ph: '0,000' })}
            ${field('Απόθεμα τέλους', 'p', 'oil.endLiters', o.endLiters, { suffix: 'lt', cls: 'n', dis, ph: '—' })}
            <label class="field"><span>Πάγιο θέρμανσης</span><div class="pct">
              <input type="range" min="0" max="100" step="5" data-root="p" data-path="fixedPercent" value="${esc(C.num(p.fixedPercent))}" ${dis ? 'disabled' : ''} aria-label="Ποσοστό παγίου">
              <div class="affix"><input class="inp n" inputmode="numeric" data-root="p" data-path="fixedPercent" value="${esc(p.fixedPercent ?? '')}" ${dis ? 'disabled' : ''}><i>%</i></div></div></label>
          </div>
          <div class="purchases"><h3>Αγορές</h3>${purchases}
            ${dis ? '' : `<button class="btn ghost sm" data-act="add-purchase" style="margin-top:8px">${I.plus}Προσθήκη αγοράς</button>`}</div>
          <div class="oil-strip">
            <div><small>Διαθέσιμα</small><b data-out="oil:available"></b></div>
            <div><small>Κατανάλωση</small><b data-out="oil:consumed"></b></div>
            <div><small>Μέση τιμή</small><b data-out="oil:avg"></b></div>
            <div><small>Κόστος θέρμανσης</small><b data-out="oil:cost"></b></div>
          </div>
        </div>
      </section>
    </div>
    <aside class="summary" id="summary"></aside></div>

      <section class="card full">
        <div class="card-h"><h2>Ενδείξεις & λογαριασμοί</h2><span class="hint">${prevP ? `Η παλαιά οφειλή έρχεται από τις εισπράξεις ${MONTHS_GEN[prevP.month]}` : 'Στον πρώτο μήνα γράψε τυχόν παλιές οφειλές'}</span></div>
        <div class="card-b" style="padding-top:8px">${apts.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Διαμ.</th><th>Ένοικος</th><th>Όροφ.</th><th class="r">Παλιά</th><th class="r">Νέα</th><th class="r">Χρήση</th><th class="r">Παλαιά οφειλή</th><th class="r" title="Χειροκίνητη διόρθωση: θετικό = χρέωση, αρνητικό (με −) = πίστωση">Διόρθωση ±</th><th class="r">Σύνολο</th>${dis ? '<th class="r">Πληρωμή</th><th class="r">Υπόλοιπο</th>' : ''}</tr></thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot><tr><td colspan="5">Σύνολα</td><td class="r" data-out="tf:units"></td><td class="r" data-out="tf:prevBalance"></td><td class="r" data-out="tf:adjust"></td><td class="r" data-out="tf:total"></td>${dis ? '<td class="r" data-out="tf:payment"></td><td class="r" data-out="tf:newBalance"></td>' : ''}</tr></tfoot>
        </table></div>` : `<div class="empty"><b>Δεν υπάρχουν διαμερίσματα</b>Πρόσθεσέ τα από την καρτέλα «Διαμερίσματα».<div style="margin-top:12px"><button class="btn" data-act="tab" data-tab="apartments">Πήγαινε στα διαμερίσματα</button></div></div>`}</div>
      </section>`;
  }

  // ---------- εισπράξεις προηγούμενου μήνα ----------
  function collectionsCard(b, p) {
    const prev = prevClosed(b, p);
    if (!prev) return '';
    const comp = computeFor(b, prev);
    const rows = comp.results.map((r) => {
      const pay = (prev.rows[r.id] || {}).payment ?? '';
      return `<tr>
        <td class="code">${esc(r.apt.code)}</td><td class="owner" title="${esc(r.apt.owner)}">${esc(r.apt.owner)}</td>
        <td class="r strong">${C.euro(r.total)}</td>
        <td style="text-align:center"><label class="paid"><input type="checkbox" data-paychk="${r.id}" ${r.total > 0 && r.payment >= r.total ? 'checked' : ''} ${r.total <= 0 ? 'disabled' : ''}><span>Πλήρωσε</span></label></td>
        <td><div class="affix"><input class="inp n" inputmode="decimal" data-payamt="${r.id}" value="${esc(pay)}" placeholder="0,00" aria-label="Ποσό πληρωμής"><i>€</i></div></td>
        <td class="r" data-out="pay:${r.id}"></td>
      </tr>`;
    }).join('');
    return `<section class="card collect" id="collect">
      <div class="card-h"><h2>Εισπράξεις ${MONTHS_GEN[prev.month]}</h2><span class="hint">Τσέκαρε ποιοι πλήρωσαν. Όσα μένουν απλήρωτα περνούν αυτόματα ως οφειλή στον ${esc(C.MONTHS[p.month])}.</span></div>
      <div class="card-b" style="padding-top:8px"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Διαμ.</th><th>Ένοικος</th><th class="r">Ειδοποιητήριο</th><th style="text-align:center">Εξόφληση</th><th class="r">Πληρωμή</th><th class="r">Μένει οφειλή</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>
      <div class="card-f"><span data-out="pay:summary"></span><button class="btn sm" data-act="pay-all">Όλοι πλήρωσαν</button></div>
    </section>`;
  }

  function setPayment(id, value) {
    const b = building(); const prev = prevClosed(b, period(b)); if (!prev) return;
    if (!prev.rows[id]) prev.rows[id] = { prevUnits: '', currUnits: '', prevBalance: '', payment: '' };
    prev.rows[id].payment = value;
    if (value) prev.rows[id].paidAt = prev.rows[id].paidAt || new Date().toISOString(); else delete prev.rows[id].paidAt;
    syncBalances(b);
    scheduleSave();
    refresh();
  }

  function summaryHtml(b, p, comp) {
    const t = comp.totals;
    const parts = [['Θέρμανση', t.heating, 'var(--c-heat)', `πάγιο ${C.money(t.heatingFixed)} · χρήση ${C.money(t.heatingVariable)}`], ['Ανελκυστήρας', t.elevator, 'var(--c-elev)'], ['Γενικά έξοδα', t.general, 'var(--c-gen)']];
    const sum = Math.max(1, t.charges);
    const maxT = Math.max(1, ...comp.results.map((r) => r.charges));
    const [whole, dec] = C.money(t.charges).split(',');
    return `
      <section class="card big">
        <small>Έξοδα ${esc(C.periodLabel(p))}</small>
        <div class="amount">${whole}<span>,${dec} €</span></div>
        <div class="bar">${parts.map(([, v, c]) => `<i style="width:${(v / sum) * 100}%;background:${c}"></i>`).join('')}</div>
        <div class="legend">${parts.map(([l, v, c, s]) => `<div><em style="background:${c}"></em><span>${l}</span><b>${C.euro(v)}</b>${s && v ? `<span class="sub">${s}</span>` : ''}</div>`).join('')}</div>
        <div class="legend" style="border-top:1px solid var(--line);padding-top:12px">
          <div><em></em><span>Παλαιές οφειλές</span><b>${C.euro(t.prevBalance)}</b></div>
          <div><em></em><span><b>Προς είσπραξη</b></span><b>${C.euro(t.total)}</b></div>
        </div>
      </section>
      ${comp.warnings.length ? `<div class="warns"><strong>Χρειάζεται προσοχή</strong><ul>${comp.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      ${comp.results.length ? `<section class="card dist"><h3>Ανά διαμέρισμα</h3>${comp.results.map((r) => `<div class="d-row">
          <span class="who">${esc(r.apt.code)}<span>${esc(r.apt.owner)}</span></span><b>${C.euro(r.charges)}</b>
          <span class="mini" style="width:${(r.charges / maxT) * 100}%"><i style="width:${r.charges ? (r.heating / r.charges) * 100 : 0}%;background:var(--c-heat)"></i><i style="width:${r.charges ? (r.elevator / r.charges) * 100 : 0}%;background:var(--c-elev)"></i><i style="width:${r.charges ? (r.general / r.charges) * 100 : 0}%;background:var(--c-gen)"></i></span>
        </div>`).join('')}</section>` : ''}`;
  }

  // ---------- καρτέλα: διαμερίσματα ----------
  function apartmentsTab(b, p) {
    const apts = sortApts(b.apartments);
    const custom = hasCustomOrder(b.apartments);
    const rows = apts.map((a, i) => `<tr data-apt="${a.id}">
      <td class="grip-cell"><span class="grip" title="Σύρε για να αλλάξεις θέση" aria-hidden="true">⋮⋮</span><span class="mv">
        <button class="icon-btn mini-btn" data-act="move-apt" data-id="${a.id}" data-dir="-1" aria-label="Μετακίνηση πάνω" ${i === 0 ? 'disabled' : ''}>${I.chevUp}</button>
        <button class="icon-btn mini-btn" data-act="move-apt" data-id="${a.id}" data-dir="1" aria-label="Μετακίνηση κάτω" ${i === apts.length - 1 ? 'disabled' : ''}>${I.chevDown}</button></span></td>
      <td><input class="inp" data-root="a" data-path="${a.id}.code" value="${esc(a.code)}" placeholder="Α1" style="min-width:0;width:58px"></td>
      <td><input class="inp" data-root="a" data-path="${a.id}.owner" value="${esc(a.owner)}" placeholder="Ονοματεπώνυμο" style="min-width:130px"></td>
      <td><input class="inp n" inputmode="numeric" data-root="a" data-path="${a.id}.floor" value="${esc(a.floor)}" style="width:70px;min-width:0"></td>
      <td><input class="inp n" inputmode="decimal" data-root="a" data-path="${a.id}.sqm" value="${esc(a.sqm)}" placeholder="0" style="width:80px;min-width:0"></td>
      <td class="r" data-out="a:${a.id}:mils"></td>
      <td class="r muted" data-out="a:${a.id}:factor"></td>
      <td class="r" data-out="a:${a.id}:elevMils"></td>
      <td style="text-align:center"><input type="checkbox" class="chk" data-root="a" data-path="${a.id}.noHeating" ${a.noHeating ? 'checked' : ''} aria-label="Εξαιρείται από θέρμανση"></td>
      <td style="text-align:center"><input type="checkbox" class="chk" data-root="a" data-path="${a.id}.noElevator" ${a.noElevator ? 'checked' : ''} aria-label="Εξαιρείται από ασανσέρ"></td>
      <td class="meter-cell"><label class="switch" title="Κοινός θερμιδομετρητής με άλλο διαμέρισμα"><input type="checkbox" data-root="a" data-path="${a.id}.meterShared" data-rerender ${a.meterWith && a.meterShared !== false ? 'checked' : ''} ${apts.some((x) => x.meterWith === a.id && x.meterShared !== false) ? 'disabled' : ''} aria-label="Κοινός μετρητής"><i></i></label>
        <select class="inp meter-sel" data-root="a" data-path="${a.id}.meterWith" data-rerender aria-label="Με ποιο διαμέρισμα" ${a.meterWith && a.meterShared !== false ? '' : 'disabled'}>
        <option value="">—</option>${apts.filter((x) => x.id !== a.id && !(x.meterWith && x.meterShared !== false)).map((x) => `<option value="${x.id}" ${a.meterWith === x.id ? 'selected' : ''}>με ${esc(x.code || '—')}</option>`).join('')}</select></td>
      <td><button class="icon-btn" data-act="del-apt" data-id="${a.id}" aria-label="Διαγραφή διαμερίσματος">${I.trash}</button></td>
    </tr>`).join('');
    return `<section class="card">
      <div class="card-h"><h2>Διαμερίσματα</h2><span class="hint">${custom ? `Δική σου σειρά · <button class="link" data-act="sort-floor">Ταξινόμηση κατά όροφο</button>` : 'Σύρε τις γραμμές από το ⋮⋮ για να τις βάλεις σε όποια σειρά θέλεις'}</span></div>
      <div class="card-b" style="padding-top:8px">
        ${apts.length ? `<div class="tbl-wrap"><table class="tbl apts" id="aptTable">
          <thead><tr><th></th><th>Κωδικός</th><th>Ένοικος</th><th>Όροφος</th><th>τ.μ.</th><th class="r">Χιλιοστά</th><th class="r">Συντ. ασ.</th><th class="r">Χιλ. ασανσέρ</th><th style="text-align:center">Χωρίς θέρμ.</th><th style="text-align:center">Χωρίς ασ.</th><th title="Αν δύο ή περισσότερα διαμερίσματα έχουν κοινό θερμιδομετρητή, η χρήση μοιράζεται εξίσου">Κοινός μετρ.</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="4">Σύνολα</td><td class="r" data-out="at:sqm"></td><td class="r" data-out="at:mils"></td><td></td><td class="r" data-out="at:elevMils"></td><td colspan="4"></td></tr></tfoot>
        </table></div>` : '<div class="empty"><b>Κανένα διαμέρισμα ακόμα</b>Ξεκίνα προσθέτοντας το πρώτο.</div>'}
        <button class="btn primary" data-act="add-apt" style="margin-top:14px">${I.plus}Νέο διαμέρισμα</button>
        <p class="hint" style="color:var(--ink-3);font-size:12.5px;margin:14px 0 0">Όροφος: 0 για ισόγειο, −1 για υπόγειο. Τα χιλιοστά υπολογίζονται από τα τετραγωνικά· οι συντελεστές ασανσέρ αλλάζουν από τις Ρυθμίσεις. Η σειρά των διαμερισμάτων ισχύει παντού: στους πίνακες, στις εισπράξεις και στα PDF.</p>
      </div></section>`;
  }

  // ---------- καρτέλα: ιστορικό ----------
  function historyTab(b) {
    const list = b.periods.slice().reverse().map((p) => {
      const c = computeFor(b, p);
      return `<div class="hist-row">
        <div><span class="m">${esc(C.periodLabel(p))}</span><small>${p.status === 'closed' ? 'Έκλεισε ' + (p.closedAt ? new Date(p.closedAt).toLocaleDateString('el-GR') : '') : 'Ανοιχτός'}</small></div>
        <span class="badge ${p.status === 'closed' ? 'closed' : ''}">${p.status === 'closed' ? 'Κλειστός' : 'Ανοιχτός'}</span>
        <div class="r"><small>Έξοδα</small>${C.euro(c.totals.charges)}</div>
        <div class="r"><small>Πετρέλαιο</small>${C.fmt(c.oil.consumedL, 0)} lt</div>
        <div class="actions"><button class="btn sm" data-act="open-period" data-id="${p.id}">Άνοιγμα</button><button class="btn sm ghost" data-act="pdf-statement" data-id="${p.id}">${I.table}</button><button class="btn sm ghost" data-act="pdf-receipts" data-id="${p.id}">${I.receipt}</button></div>
      </div>`;
    }).join('');
    const years = [...new Set(b.periods.map((p) => p.year))].sort((x, y) => y - x);
    return `<section class="card" style="margin-bottom:22px"><div class="card-h"><h2>Ετήσια κατάσταση ανά ένοικο</h2><span class="hint">Πιλοτικά · κοινόχρηστα, πληρωμές και υπόλοιπο κάθε ενοίκου</span></div>
      <div class="card-b chips">${years.map((y) => `<button class="btn" data-act="annual" data-year="${y}">${I.table}${y}</button>`).join('')}</div></section>
      <section class="card"><div class="card-h"><h2>Ιστορικό μηνών</h2><span class="hint">${b.periods.length} μήνες</span></div><div style="padding-top:8px">${list}</div></section>`;
  }

  // ---------- καρτέλα: ρυθμίσεις ----------
  function settingsTab(b) {
    const maxFloor = Math.max(8, ...b.apartments.map((a) => Math.trunc(C.num(a.floor))));
    const floors = []; for (let f = -1; f <= maxFloor; f++) floors.push(f);
    const factors = floors.map((f) => `<label class="field"><span>${esc(C.floorLabel(f))}</span><input class="inp n" inputmode="decimal" data-root="b" data-path="elevatorFactors.${f}" value="${esc(b.elevatorFactors[f] ?? '')}" placeholder="${C.fmt(C.defaultElevatorFactor(f), 2)}"></label>`).join('');
    const chips = C.ALL_EXPENSES.map((x) => `<button class="chip" data-act="pin" data-key="${x.key}" aria-pressed="${b.recurring.includes(x.key)}">${esc(x.label)}</button>`).join('');
    return `<div class="stack" style="max-width:880px">
      <section class="card"><div class="card-h"><h2>Στοιχεία πολυκατοικίας</h2></div><div class="card-b"><div class="row2">
        <label class="field"><span>Όνομα</span><input class="inp" data-root="b" data-path="name" value="${esc(b.name)}" data-rail></label>
        <label class="field"><span>Διεύθυνση</span><input class="inp" data-root="b" data-path="address" value="${esc(b.address || '')}" placeholder="Οδός, αριθμός, πόλη" data-rail></label>
      </div></div></section>
      <section class="card"><div class="card-h"><h2>Συντελεστές ανελκυστήρα</h2><button class="btn ghost sm" data-act="reset-factors">Επαναφορά προεπιλογών</button></div>
        <div class="card-b"><p style="margin:0 0 14px;color:var(--ink-2)">Τα χιλιοστά ασανσέρ = χιλιοστά × συντελεστής ορόφου, αναγμένα στα 1000. Άφησε κενό για την προεπιλογή (ισόγειο 0, 1ος 1,00 και +0,10 ανά όροφο).</p><div class="factors">${factors}</div></div></section>
      <section class="card"><div class="card-h"><h2>Επαναλαμβανόμενα έξοδα</h2></div><div class="card-b"><p style="margin:0 0 12px;color:var(--ink-2)">Όσα επιλέξεις μεταφέρονται με το ίδιο ποσό στον επόμενο μήνα κατά το κλείσιμο.</p><div class="chips">${chips}</div></div></section>
      <section class="card"><div class="card-h"><h2>Αντίγραφα ασφαλείας</h2><span class="hint">Κοινά για όλες τις πολυκατοικίες</span></div><div class="card-b" style="display:grid;gap:12px">
        ${api && api.autoBackup ? `<div class="folder"><code>${esc(data.prefs.backupDir || backupDefault)}</code>
          <button class="btn sm" data-act="bk-folder">Αλλαγή…</button><button class="btn sm" data-act="bk-folder-open">Άνοιγμα</button>${data.prefs.backupDir ? '<button class="btn sm ghost" data-act="bk-folder-reset">Προεπιλογή</button>' : ''}</div>
          <p style="margin:0;color:var(--ink-2)">Αντίγραφο γίνεται αυτόματα <b>σε κάθε κλείσιμο μήνα</b>, <b>μία φορά τη μέρα</b> και <b>πριν από κάθε επαναφορά</b>. Κρατιούνται τα 60 πιο πρόσφατα. Για να είναι ασφαλή αν χαλάσει ο υπολογιστής, διάλεξε φάκελο σε USB, OneDrive, iCloud ή Dropbox.</p>
          <div class="folder" style="justify-content:space-between"><span style="color:var(--ink-3);font-size:12.5px">${data.prefs.lastBackup ? 'Τελευταίο αντίγραφο: ' + new Date(data.prefs.lastBackup).toLocaleString('el-GR', { dateStyle: 'medium', timeStyle: 'short' }) : 'Δεν έχει γίνει ακόμα αντίγραφο'}</span><button class="btn sm" data-act="bk-now">${I.down}Αντίγραφο τώρα</button></div>`
        : '<p style="margin:0;color:var(--ink-2)">Διαθέσιμο στην εφαρμογή για υπολογιστή.</p>'}
      </div></section>
      <section class="card"><div class="card-h"><h2>Φάκελος PDF</h2><span class="hint">Κοινός για όλες τις πολυκατοικίες</span></div><div class="card-b" style="display:grid;gap:12px">
        ${api ? `<div class="folder"><code>${esc(data.prefs.pdfDir || pdfDefault)}</code>
          <button class="btn sm" data-act="pdf-folder">Αλλαγή…</button><button class="btn sm" data-act="pdf-folder-open">Άνοιγμα</button>${data.prefs.pdfDir ? '<button class="btn sm ghost" data-act="pdf-folder-reset">Προεπιλογή</button>' : ''}</div>
          <p style="margin:0;color:var(--ink-2)">Τα PDF αποθηκεύονται αυτόματα με αυτή τη σειρά: φάκελος › πολυκατοικία › μήνας, π.χ. <b>${esc(b.name)} › 2026-11 Νοέμβριος</b>. Αν ξαναβγάλεις PDF για τον ίδιο μήνα, αντικαθίσταται το παλιό αρχείο.</p>`
        : '<p style="margin:0;color:var(--ink-2)">Διαθέσιμο στην εφαρμογή για υπολογιστή.</p>'}
      </div></section>
      <section class="card"><div class="card-h"><h2>Ειδοποιητήρια</h2></div><div class="card-b" style="display:grid;gap:14px">
        <label class="field"><span>Σημείωση προς τους ενοίκους</span><textarea class="inp" data-root="b" data-path="note" rows="2">${esc(b.note || '')}</textarea></label>
        <label class="check"><input type="checkbox" data-root="b" data-path="receiptOverview" ${b.receiptOverview !== false ? 'checked' : ''}>Να εμφανίζεται η «Ανάλυση ανά ένοικο» σε κάθε ειδοποιητήριο (διαμερίσματα με το ίδιο όνομα ενοίκου βγαίνουν μαζί σε ένα χαρτί)</label>
      </div></section>
      <section class="card"><div class="card-h"><h2>Σχετικά</h2><span class="hint">${upd.current ? 'Έκδοση ' + esc(upd.current) : ''}</span></div><div class="card-b" style="color:var(--ink-2);display:grid;gap:6px">
        <div><b style="color:var(--ink)">© 2026 Τάσος Δεμέλης.</b> Άδεια χρήσης PolyForm Noncommercial 1.0.0.</div>
        <div>Ελεύθερη για προσωπική και μη κερδοσκοπική χρήση. <b>Απαγορεύεται κάθε εμπορική χρήση</b>, όπως η πώληση της εφαρμογής ή παραλλαγής της ή η χρήση της για διαχείριση πολυκατοικιών έναντι αμοιβής, χωρίς γραπτή άδεια του δημιουργού.</div>
      </div></section>
      <section class="card danger-zone"><div class="card-h"><h2>Διαγραφή</h2></div><div class="card-b" style="display:flex;justify-content:space-between;align-items:center;gap:16px">
        <span style="color:var(--ink-2)">Διαγράφει την πολυκατοικία, τα διαμερίσματα και όλο το ιστορικό της.</span>
        <button class="btn danger" data-act="del-building">${I.trash}Διαγραφή πολυκατοικίας</button></div></section>
    </div>`;
  }

  // ---------- υπολογισμένα πεδία ----------
  function refresh() {
    const b = building(); if (!b) return;
    const p = period(b); if (!p) return;
    const comp = computeFor(b, p);
    const byId = {}; comp.results.forEach((r) => { byId[r.id] = r; });
    // Για την καρτέλα διαμερισμάτων: πάντα με τα τρέχοντα διαμερίσματα.
    const live = ui.tab === 'apartments' ? C.compute(sortApts(b.apartments), p, { elevatorFactors: b.elevatorFactors }) : null;
    const liveById = {}; if (live) live.results.forEach((r) => { liveById[r.id] = r; });
    const t = comp.totals;
    const o = comp.oil;
    const val = (k) => {
      const [kind, a, c] = k.split(':');
      if (kind === 'tot') return C.euro(t[a]);
      if (kind === 'oil') return { available: C.fmt(o.availableL) + ' lt', consumed: C.fmt(o.consumedL) + ' lt', avg: C.fmt(o.avgPrice, 3) + ' €', cost: C.euro(o.costCents) }[a];
      if (kind === 'pc') { const x = o.purchases[+a]; return x ? C.euro(Math.round(x.liters * x.price * 100)) : ''; }
      if (kind === 'r') { const r = byId[a]; if (!r) return ''; return c === 'units' ? C.fmt(r.units) : C.euro(r[c]); }
      if (kind === 'tf') return a === 'units' ? C.fmt(t.units) : C.euro(t[a]);
      if (kind === 'a') { const r = liveById[a]; if (!r) return ''; return c === 'factor' ? C.fmt(r.factor) : C.fmt(r[c]); }
      if (kind === 'at') return live ? C.fmt(live.totals[a]) : '';
      return '';
    };
    $$('[data-out]').forEach((el) => {
      el.textContent = val(el.dataset.out);
      const [kind, id, c] = el.dataset.out.split(':');
      if (kind === 'r' && c === 'newBalance' && byId[id]) el.className = 'r ' + (byId[id].newBalance < 0 ? 'neg' : byId[id].newBalance === 0 ? 'muted' : '');
    });
    const s = $('#summary'); if (s) s.innerHTML = summaryHtml(b, p, comp);
    // Εισπράξεις προηγούμενου μήνα
    const prev = prevClosed(b, p);
    if (prev && $('#collect')) {
      const pc = computeFor(b, prev);
      let due = 0, paid = 0, open = 0, payers = 0;
      pc.results.forEach((r) => {
        const el = $(`[data-out="pay:${r.id}"]`);
        if (el) { el.textContent = r.newBalance > 0 ? C.euro(r.newBalance) : r.newBalance < 0 ? 'Πίστωση ' + C.euro(-r.newBalance) : '—'; el.className = 'r ' + (r.newBalance > 0 ? 'owed' : 'muted'); }
        const chk = $(`[data-paychk="${r.id}"]`); if (chk) chk.checked = r.total > 0 && r.payment >= r.total;
        due += Math.max(0, r.total); paid += r.payment; if (r.newBalance > 0) open++; if (r.payment > 0) payers++;
      });
      const sm = $('[data-out="pay:summary"]');
      if (sm) sm.innerHTML = `Εισπράχθηκαν <strong>${C.euro(paid)}</strong> από ${C.euro(due)} · ${open ? `<span class="owed">${open} με οφειλή</span>` : '<span class="neg">όλοι εξόφλησαν</span>'}`;
    }
  }

  // ---------- επεξεργασία ----------
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = value;
  }

  function onEdit(el) {
    const b = building(); if (!b) return;
    const root = el.dataset.root; const path = el.dataset.path;
    const value = el.type === 'checkbox' ? el.checked : el.value;
    if (root === 'p') { const p = period(b); if (!p || p.status === 'closed') return; setPath(p, path, value); }
    else if (root === 'b') setPath(b, path, value);
    else if (root === 'a') { const [id, ...rest] = path.split('.'); const a = b.apartments.find((x) => x.id === id); if (!a) return; setPath(a, rest.join('.'), value); }
    // Συγχρονισμός άλλων πεδίων με την ίδια διαδρομή (π.χ. range + αριθμός).
    $$(`[data-root="${root}"][data-path="${path}"]`).forEach((x) => { if (x !== el && x.type !== 'checkbox') x.value = value; });
    if (el.hasAttribute('data-rerender')) {
      if (root === 'a' && path.endsWith('.meterShared')) {
        const a = b.apartments.find((x) => x.id === path.split('.')[0]);
        if (a && value && !a.meterWith) { const c = sortApts(b.apartments).find((x) => x.id !== a.id && !(x.meterWith && x.meterShared !== false)); if (c) a.meterWith = c.id; }
      }
      scheduleSave(); rerenderBody(); return;
    }
    if (el.hasAttribute('data-rail')) { renderRail(); const t = $('#bTitle'); if (t) t.textContent = b.name; }
    scheduleSave();
    refresh();
  }

  async function act(btn) {
    const a = btn.dataset.act;
    const b = building();
    const p = b ? period(b) : null;
    switch (a) {
      case 'pick-building': ui.bId = btn.dataset.id; ui.pId = null; render(); scheduleSave(); break;
      case 'new-building': newBuildingDialog(); break;
      case 'demo': loadDemo(); break;
      case 'tab': ui.tab = btn.dataset.tab; render(); scheduleSave(); break;
      case 'period-step': { const i = b.periods.indexOf(p) + Number(btn.dataset.dir); if (b.periods[i]) { ui.pId = b.periods[i].id; render(); } break; }
      case 'open-period': ui.pId = btn.dataset.id; ui.tab = 'month'; render(); break;
      case 'pin': {
        const k = btn.dataset.key; const i = b.recurring.indexOf(k);
        if (i >= 0) b.recurring.splice(i, 1); else b.recurring.push(k);
        const on = b.recurring.includes(k);
        $$(`[data-act="pin"][data-key="${k}"]`).forEach((x) => { x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
        scheduleSave(); break;
      }
      case 'add-purchase': p.oil.purchases.push({ id: uid(), date: new Date().toISOString().slice(0, 10), liters: '', price: '' }); rerenderBody(); focusLast('[data-path$=".liters"]'); scheduleSave(); break;
      case 'del-purchase': p.oil.purchases.splice(Number(btn.dataset.i), 1); rerenderBody(); scheduleSave(); break;
      case 'move-apt': {
        const list = sortApts(b.apartments); const i = list.findIndex((a) => a.id === btn.dataset.id);
        reorderApt(b, btn.dataset.id, i + Number(btn.dataset.dir));
        rerenderBody(); scheduleSave();
        const again = $(`[data-act="move-apt"][data-id="${btn.dataset.id}"][data-dir="${btn.dataset.dir}"]`);
        if (again && !again.disabled) again.focus();
        break;
      }
      case 'sort-floor': b.apartments.forEach((a) => { delete a.order; }); rerenderBody(); scheduleSave(); toast('Ταξινόμηση κατά όροφο'); break;
      case 'update-check': if (api && api.checkUpdates) { const r = await api.checkUpdates(); if (r && r.status === 'dev') toast('Ο έλεγχος γίνεται μόνο στην εγκατεστημένη εφαρμογή'); } break;
      case 'update-now': updateNow(); break;
      case 'update-later': upd.later = true; renderUpdate(); break;
      case 'update-open': window.open(upd.url, '_blank'); break;
      case 'update-log': api && api.openUpdateLog && api.openUpdateLog(); break;
      case 'add-apt': {
        const maxF = b.apartments.reduce((m, x) => Math.max(m, Math.trunc(C.num(x.floor))), 0);
        const apt = { id: uid(), code: '', owner: '', floor: b.apartments.length ? maxF : 1, sqm: '' };
        if (hasCustomOrder(b.apartments)) apt.order = Math.max(...b.apartments.map((x) => x.order)) + 1;
        b.apartments.push(apt); ensureRows(b, p); rerenderBody();
        const inp = $(`[data-path="${apt.id}.code"]`); if (inp) { inp.focus(); inp.scrollIntoView({ block: 'center' }); }
        renderRail(); scheduleSave(); break;
      }
      case 'del-apt': {
        const apt = b.apartments.find((x) => x.id === btn.dataset.id);
        if (!(await confirmBox({ title: 'Διαγραφή διαμερίσματος', message: `Να διαγραφεί το διαμέρισμα <b>${esc(apt.code || '—')}</b>${apt.owner ? ' (' + esc(apt.owner) + ')' : ''}; Οι κλειστοί μήνες δεν επηρεάζονται.`, ok: 'Διαγραφή', danger: true }))) return;
        b.apartments = b.apartments.filter((x) => x !== apt);
        b.periods.forEach((x) => { if (x.status === 'open') delete x.rows[apt.id]; });
        rerenderBody(); renderRail(); scheduleSave(); break;
      }
      case 'pay-all': {
        const prev = prevClosed(b, p); if (!prev) break;
        computeFor(b, prev).results.forEach((r) => {
          if (r.total <= 0) return;
          if (!prev.rows[r.id]) prev.rows[r.id] = {};
          prev.rows[r.id].payment = centsStr(r.total);
          prev.rows[r.id].paidAt = prev.rows[r.id].paidAt || new Date().toISOString();
          const amt = $(`[data-payamt="${r.id}"]`); if (amt) amt.value = centsStr(r.total);
        });
        syncBalances(b); scheduleSave(); refresh(); break;
      }
      case 'pdf-folder': {
        const dir = await api.choosePdfDir(data.prefs.pdfDir || pdfDefault);
        if (dir) { data.prefs.pdfDir = dir; rerenderBody(); scheduleSave(); }
        break;
      }
      case 'pdf-folder-reset': delete data.prefs.pdfDir; rerenderBody(); scheduleSave(); break;
      case 'pdf-folder-open': api.openPdfDir(data.prefs.pdfDir || pdfDefault); break;
      case 'bk-folder': { const dir = await api.chooseBackupDir(data.prefs.backupDir || backupDefault); if (dir) { data.prefs.backupDir = dir; rerenderBody(); scheduleSave(); } break; }
      case 'bk-folder-reset': delete data.prefs.backupDir; rerenderBody(); scheduleSave(); break;
      case 'bk-folder-open': api.openBackupDir(data.prefs.backupDir || backupDefault); break;
      case 'bk-now': { const f = await autoBackup('χειροκίνητο'); if (f) { toast('Έγινε αντίγραφο ασφαλείας'); rerenderBody(); } break; }
      case 'close-month': closeMonth(b, p); break;
      case 'reopen': reopen(b, p); break;
      case 'pdf-statement': case 'pdf-receipts': {
        const per = btn.dataset.id ? b.periods.find((x) => x.id === btn.dataset.id) : p;
        preview(b, per, a === 'pdf-statement' ? 'statement' : 'receipts'); break;
      }
      case 'annual': preview(b, null, 'annual', Number(btn.dataset.year)); break;
      case 'reset-factors': b.elevatorFactors = {}; rerenderBody(); scheduleSave(); break;
      case 'del-building':
        if (!(await confirmBox({ title: 'Διαγραφή πολυκατοικίας', message: `Θα διαγραφεί οριστικά η <b>${esc(b.name)}</b> με ${b.apartments.length} διαμερίσματα και ${b.periods.length} μήνες ιστορικού. Δεν αναιρείται.`, ok: 'Οριστική διαγραφή', danger: true }))) return;
        data.buildings = data.buildings.filter((x) => x !== b);
        ui.bId = data.buildings[0] ? data.buildings[0].id : null; ui.tab = 'month'; render(); await saveNow(); toast('Η πολυκατοικία διαγράφηκε'); break;
      case 'backup': backup(); break;
      case 'restore': restore(); break;
      case 'theme': { const order = ['system', 'light', 'dark']; data.prefs.theme = order[(order.indexOf(data.prefs.theme || 'system') + 1) % 3]; applyTheme(); renderRail(); scheduleSave(); break; }
      default: break;
    }
  }

  function rerenderBody() {
    const b = building(); const p = period(b);
    const st = $('#stage'); const y = st.scrollTop;
    $('#body').innerHTML = tabBody(b, p);
    refresh(); st.scrollTop = y;
  }
  function focusLast(sel) { const els = $$(sel); const el = els[els.length - 1]; if (el) el.focus(); }

  // ---------- μήνας: κλείσιμο / άνοιγμα ----------
  async function closeMonth(b, p) {
    if (!b.apartments.length) { toast('Πρόσθεσε πρώτα διαμερίσματα'); return; }
    const comp = computeFor(b, p);
    const nm = C.nextMonth(p.year, p.month);
    const warn = comp.warnings.length ? `<br><br><span style="color:var(--warn)">Υπάρχουν ${comp.warnings.length} προειδοποιήσεις:</span><ul style="margin:6px 0 0;padding-left:18px">${comp.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
    const ok = await confirmBox({
      title: `Κλείσιμο ${C.periodLabel(p)}`,
      message: `Ο μήνας κλειδώνει και ανοίγει ο <b>${C.MONTHS[nm.month]} ${nm.year}</b> με:<ul style="margin:8px 0 0;padding-left:18px"><li>τις νέες ενδείξεις ως παλιές</li><li>το απόθεμα τέλους (${C.fmt(comp.oil.endL === null ? comp.oil.availableL : comp.oil.endL)} lt) ως αρχή, με τιμή ${C.fmt(comp.oil.avgPrice, 3)} €/lt</li><li>τα ποσά του μήνα (${C.euro(comp.totals.total)}) ως οφειλή — όποιος πληρώσει, το τσεκάρεις στις «Εισπράξεις» του επόμενου μήνα</li><li>τα επαναλαμβανόμενα έξοδα</li></ul>${warn}`,
      ok: 'Κλείσιμο μήνα'
    });
    if (!ok) return;
    p.status = 'closed';
    p.closedAt = new Date().toISOString();
    p.aptSnapshot = clone(b.apartments);
    p.settingsSnapshot = { elevatorFactors: clone(b.elevatorFactors) };
    const next = C.rollover(p, comp, b.recurring, uid);
    next.extraLabel = b.recurring.includes('extra') ? p.extraLabel : '';
    b.periods.push(next);
    ui.pId = next.id;
    render(); await saveNow();
    await autoBackup('κλείσιμο ' + C.periodLabel(p));
    toast(`Άνοιξε ο ${C.periodLabel(next)}`);
  }

  async function reopen(b, p) {
    const next = b.periods[b.periods.length - 1];
    const ok = await confirmBox({ title: `Άνοιγμα ${C.periodLabel(p)}`, message: `Ο <b>${esc(C.periodLabel(next))}</b> θα διαγραφεί μαζί με ό,τι έχεις περάσει σε αυτόν, και ο ${esc(C.periodLabel(p))} θα γίνει ξανά επεξεργάσιμος.`, ok: 'Άνοιγμα ξανά', danger: true });
    if (!ok) return;
    b.periods.pop();
    p.status = 'open'; delete p.closedAt; delete p.aptSnapshot; delete p.settingsSnapshot;
    ui.pId = p.id; render(); await saveNow();
  }

  // ---------- PDF ----------
  const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  function reportFor(b, p, kind) {
    const comp = computeFor(b, p);
    // ετικέτα λοιπών εξόδων
    const view = { ...b, note: b.note };
    const html = kind === 'statement' ? R.statement(view, p, comp) : R.receipts(view, p, comp);
    const label = expLabel('extra', p);
    return html.replaceAll('Λοιπά έξοδα', esc(label));
  }
  function preview(b, p, kind, year) {
    const annual = kind === 'annual';
    const items = annual ? b.periods.filter((x) => x.year === year).map((x) => ({ period: x, comp: computeFor(b, x) })) : null;
    const html = annual ? R.annual(b, year, items) : reportFor(b, p, kind);
    const title = annual ? 'Ετήσια κατάσταση' : kind === 'statement' ? 'Συγκεντρωτικός πίνακας' : 'Ειδοποιητήρια';
    const label = annual ? String(year) : C.periodLabel(p);
    const fileName = safeName(`${annual ? 'Ετήσια κατάσταση' : kind === 'statement' ? 'Πίνακας' : 'Ειδοποιητήρια'} ${label}`) + '.pdf';
    const subdir = annual ? `${year} Ετήσια κατάσταση` : `${p.year}-${String(p.month + 1).padStart(2, '0')} ${C.MONTHS[p.month]}`;
    modal(`<div class="d-h"><div><h2>${title}</h2><div style="color:var(--ink-3);font-size:13px">${esc(b.name)} · ${esc(label)}</div></div>
      <div class="actions"><button class="btn ghost" data-close>Κλείσιμο</button><button class="btn ${api ? 'ghost' : 'primary'}" id="printBtn">Εκτύπωση</button>${api ? `<button class="btn" id="saveAsBtn">Αποθήκευση ως…</button><button class="btn primary" id="pdfBtn">${I.down}Αποθήκευση PDF</button>` : ''}</div></div>
      <iframe id="pv" title="Προεπισκόπηση"></iframe>`, {
      wide: true,
      onMount: (root) => {
        const fr = $('#pv', root); fr.srcdoc = html;
        const doPrint = () => fr.contentWindow.print();
        $('#printBtn', root).onclick = doPrint;
        const save = async (btn, saveAs) => {
          btn.disabled = true;
          try {
            const out = await api.savePdf({
              html, landscape: kind === 'statement', fileName, saveAs,
              dir: data.prefs.pdfDir || pdfDefault, building: b.name,
              subdir
            });
            if (out) toast('Αποθηκεύτηκε: ' + out.split(/[\\/]/).slice(-3).join(' › '));
          } catch (err) { toast('Σφάλμα PDF: ' + err.message); }
          finally { btn.disabled = false; }
        };
        if (api) {
          $('#pdfBtn', root).onclick = (e) => save(e.currentTarget, false);
          $('#saveAsBtn', root).onclick = (e) => save(e.currentTarget, true);
        }
      }
    });
  }

  // ---------- νέα πολυκατοικία ----------
  function newBuildingDialog() {
    const now = new Date();
    const years = []; for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 2; y++) years.push(y);
    modal(`<form id="nbForm"><div class="d-h"><h2>Νέα πολυκατοικία</h2></div>
      <div class="d-b">
        <label class="field"><span>Όνομα</span><input class="inp" name="name" required placeholder="π.χ. Πολυκατοικία Ερμού 24"></label>
        <label class="field"><span>Διεύθυνση (προαιρετικά)</span><input class="inp" name="address"></label>
        <div class="row2">
          <label class="field"><span>Πρώτος μήνας</span><select class="inp" name="month">${C.MONTHS.map((mm, i) => `<option value="${i}" ${i === now.getMonth() ? 'selected' : ''}>${mm}</option>`).join('')}</select></label>
          <label class="field"><span>Έτος</span><select class="inp" name="year">${years.map((y) => `<option ${y === now.getFullYear() ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        </div>
      </div>
      <div class="d-f"><button type="button" class="btn ghost" data-close>Άκυρο</button><button class="btn primary" type="submit">Δημιουργία</button></div></form>`, {
      onMount: (root, close) => {
        $('#nbForm', root).onsubmit = (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const name = String(fd.get('name')).trim(); if (!name) return;
          const b = newBuilding(name, String(fd.get('address') || '').trim(), Number(fd.get('year')), Number(fd.get('month')));
          data.buildings.push(b); ui.bId = b.id; ui.pId = null; ui.tab = 'apartments';
          close(); render(); scheduleSave();
        };
      }
    });
  }
  function newBuilding(name, address, year, month) {
    return {
      id: uid(), name, address, apartments: [], elevatorFactors: {}, recurring: ['management', 'cleaning'],
      note: C.DEFAULT_NOTE, receiptOverview: true,
      periods: [{ id: uid(), year, month, status: 'open', fixedPercent: 20, oil: { startLiters: '', startPrice: '', endLiters: '', purchases: [] }, expenses: {}, rows: {} }]
    };
  }

  function loadDemo() {
    const now = new Date();
    const b = newBuilding('Πολυκατοικία Ερμού 24', 'Ερμού 24, Αθήνα', now.getFullYear(), now.getMonth());
    const list = [['Ι1', 'Καλογεράκη Μαρία', 0, 62], ['Α1', 'Παπαδόπουλος Γιώργος', 1, 85], ['Α2', 'Νικολάου Ελένη', 1, 78], ['Β1', 'Γεωργίου Κώστας', 2, 95], ['Β2', 'Δημητρίου Άννα', 2, 70], ['Γ1', 'Αλεξίου Νίκος', 3, 110]];
    const readings = [[120, 165], [340, 412], [210, 268], [505, 590], [80, 80], [610, 702]];
    list.forEach(([code, owner, floor, sqm], i) => {
      const a = { id: uid(), code, owner, floor, sqm: String(sqm) };
      b.apartments.push(a);
      b.periods[0].rows[a.id] = { prevUnits: String(readings[i][0]), currUnits: String(readings[i][1]), prevBalance: i === 3 ? '42,50' : '', payment: '' };
    });
    Object.assign(b.periods[0], {
      expenses: { dei: '48,20', water: '14,60', elevator: '85', cleaning: '70', management: '40', burner: '35' },
      oil: { startLiters: '420', startPrice: '1,185', endLiters: '610', purchases: [{ id: uid(), date: new Date(now.getFullYear(), now.getMonth(), 6).toISOString().slice(0, 10), liters: '1000', price: '1,142' }] }
    });
    data.buildings.push(b); ui.bId = b.id; ui.pId = null; ui.tab = 'month';
    render(); scheduleSave();
  }

  // ---------- αντίγραφα ----------
  async function backup() {
    const name = `koinoxrista-${new Date().toISOString().slice(0, 10)}.json`;
    if (api) { const out = await api.exportBackup(data, name); if (out) toast('Το αντίγραφο αποθηκεύτηκε'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function restore() {
    let incoming = null;
    if (api) incoming = await api.importBackup().catch((err) => { toast('Μη έγκυρο αρχείο: ' + err.message); return null; });
    else incoming = await new Promise((res) => {
      const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
      i.onchange = async () => { try { res(JSON.parse(await i.files[0].text())); } catch { toast('Μη έγκυρο αρχείο'); res(null); } };
      i.click();
    });
    if (!incoming) return;
    if (!Array.isArray(incoming.buildings)) { toast('Το αρχείο δεν είναι αντίγραφο της εφαρμογής'); return; }
    const ok = await confirmBox({ title: 'Επαναφορά αντιγράφου', message: `Τα τρέχοντα δεδομένα (${data.buildings.length} πολυκατοικίες) θα αντικατασταθούν από το αντίγραφο (${incoming.buildings.length} πολυκατοικίες).`, ok: 'Επαναφορά', danger: true });
    if (!ok) return;
    await autoBackup('πριν την επαναφορά');
    data = normalize(incoming); ui.bId = data.buildings[0] ? data.buildings[0].id : null; ui.pId = null; ui.tab = 'month';
    applyTheme(); render(); await saveNow(); toast('Έγινε επαναφορά');
  }

  // ---------- εκκίνηση ----------
  async function init() {
    if (api && api.platform === 'darwin') document.body.classList.add('mac');
    data = normalize(await store.load());
    if (api && api.pdfDefaultDir) pdfDefault = await api.pdfDefaultDir();
    if (api && api.backupDefaultDir) backupDefault = await api.backupDefaultDir();
    applyTheme();
    const saved = data.ui || {};
    ui.bId = data.buildings.some((b) => b.id === saved.bId) ? saved.bId : (data.buildings[0] ? data.buildings[0].id : null);
    ui.tab = saved.tab || 'month';
    render();

    document.addEventListener('click', (e) => { const btn = e.target.closest('[data-act]'); if (btn && !btn.disabled) act(btn); });
    document.addEventListener('input', (e) => {
      if (e.target.matches('[data-path]') && e.target.type !== 'checkbox') onEdit(e.target);
      if (e.target.matches('[data-payamt]')) setPayment(e.target.dataset.payamt, e.target.value);
    });
    document.addEventListener('change', (e) => {
      if (e.target.matches('[data-paychk]')) {
        const id = e.target.dataset.paychk;
        const b = building(); const prev = prevClosed(b, period(b));
        const r = computeFor(b, prev).results.find((x) => x.id === id);
        const v = e.target.checked && r ? centsStr(r.total) : '';
        const amt = $(`[data-payamt="${id}"]`); if (amt) amt.value = v;
        setPayment(id, v);
      }
      if (e.target.matches('[data-path][type="checkbox"]')) onEdit(e.target);
      if (e.target.id === 'periodSel') { ui.pId = e.target.value; render(); }
    });
    // Enter μετακινεί στο επόμενο πεδίο, όπως σε λογιστικό φύλλο.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('input.inp[data-path]')) return;
      e.preventDefault();
      const all = $$('input.inp[data-path]:not([disabled])');
      const i = all.indexOf(e.target);
      const td = e.target.closest('td');
      if (td) { // στον πίνακα: ίδια στήλη, επόμενη γραμμή
        const col = Array.from(td.parentNode.children).indexOf(td);
        const nextRow = td.parentNode.nextElementSibling;
        const tgt = nextRow && nextRow.children[col] && nextRow.children[col].querySelector('input.inp');
        if (tgt) { tgt.focus(); tgt.select(); return; }
      }
      if (all[i + 1]) { all[i + 1].focus(); all[i + 1].select && all[i + 1].select(); }
    });
    if (api && api.onMenu) api.onMenu((cmd) => { if (cmd === 'backup') backup(); if (cmd === 'restore') restore(); });
    if (api && api.onUpdate) {
      upd.current = await api.appVersion();
      api.onUpdate((s) => { Object.assign(upd, s); if (s.status === 'available' && s.version !== upd.seen) { upd.seen = s.version; upd.later = false; } renderUpdate(); });
      renderUpdate();
      const j = await api.justUpdated();
      if (j && j.to) toast(`Τα Κοινόχρηστα ενημερώθηκαν στην έκδοση ${j.to}`);
      else if (j && j.failed) toast('Η τελευταία ενημέρωση δεν ολοκληρώθηκε· έμεινε η προηγούμενη έκδοση.');
    }
    setupDrag();
    if ((data.prefs.lastBackup || '').slice(0, 10) !== new Date().toISOString().slice(0, 10)) autoBackup('ημερήσιο');
    window.addEventListener('beforeunload', () => { if (saveTimer) saveNow(); });
  }

  // ---------- σύρσιμο διαμερισμάτων ----------
  function setupDrag() {
    let dragId = null;
    const clear = () => $$('.drop-before, .drop-after, .dragging').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'dragging'));
    document.addEventListener('mousedown', (e) => { const g = e.target.closest('.grip'); if (g) g.closest('tr').draggable = true; });
    document.addEventListener('mouseup', () => $$('tr[draggable="true"]').forEach((tr) => { if (!tr.classList.contains('dragging')) tr.draggable = false; }));
    document.addEventListener('dragstart', (e) => {
      const tr = e.target.closest && e.target.closest('tr[data-apt]');
      if (!tr || !tr.draggable) return;
      dragId = tr.dataset.apt; tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch { /* τίποτα */ }
    });
    document.addEventListener('dragover', (e) => {
      if (!dragId) return;
      const tr = e.target.closest && e.target.closest('#aptTable tbody tr[data-apt]');
      if (!tr) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      const r = tr.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2;
      $$('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      if (tr.dataset.apt !== dragId) tr.classList.add(after ? 'drop-after' : 'drop-before');
    });
    document.addEventListener('drop', (e) => {
      if (!dragId) return;
      const tr = e.target.closest && e.target.closest('#aptTable tbody tr[data-apt]');
      if (tr && tr.dataset.apt !== dragId) {
        e.preventDefault();
        const b = building();
        const list = sortApts(b.apartments).map((a) => a.id).filter((id) => id !== dragId);
        let idx = list.indexOf(tr.dataset.apt);
        if (tr.classList.contains('drop-after')) idx += 1;
        reorderApt(b, dragId, idx);
        dragId = null; clear(); rerenderBody(); scheduleSave();
      }
    });
    document.addEventListener('dragend', () => { dragId = null; clear(); $$('tr[draggable="true"]').forEach((tr) => { tr.draggable = false; }); });
  }

  init();
})();
