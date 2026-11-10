/* Κοινόχρηστα — αναφορές για εκτύπωση/PDF (HTML με δικό του CSS). */
(function (root) {
  'use strict';
  const C = root.Calc;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const m = C.money;
  const e = C.euro;
  const f2 = (v) => C.fmt(v, 2);
  const f0 = (v) => C.fmt(v, 0);

  const BASE_CSS = `
  *{box-sizing:border-box}
  html,body{margin:0;background:#fff;color:#1c2130}
  body{font:9.5pt/1.4 -apple-system,"Segoe UI",system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .serif{font-family:"Palatino","Palatino Linotype","Book Antiqua",Georgia,serif}
  .num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
  h1,h2,h3{margin:0}
  .page{page-break-after:always;break-after:page}
  .page:last-child{page-break-after:auto;break-after:auto}
  table{border-collapse:collapse;width:100%}
  .muted{color:#6b7080}
  .accent{color:#b5532c}
  @media screen{body{background:#e9e6df;padding:20px 0}.page{background:#fff;margin:0 auto 20px;box-shadow:0 4px 18px rgba(0,0,0,.12)}}
  `;

  function header(building, period, kind) {
    return `<header class="hd">
      <div><div class="kind">${esc(kind)}</div><h1 class="serif">${esc(building.name)}</h1>${building.address ? `<div class="muted">${esc(building.address)}</div>` : ''}</div>
      <div class="per"><div class="muted">Περίοδος</div><div class="serif pm">${esc(C.periodLabel(period))}</div></div>
    </header>`;
  }

  function expenseRows(t, oil) {
    const rows = C.ALL_EXPENSES.filter((x) => t.expenses[x.key] > 0).map((x) => [x.label, t.expenses[x.key]]);
    if (oil.costCents > 0) rows.push(['Πετρέλαιο θέρμανσης', oil.costCents]);
    return rows;
  }

  // ---------------- Συγκεντρωτικός πίνακας (A4 οριζόντιο) ----------------
  function statement(building, period, comp) {
    const { results, totals: t, oil } = comp;
    const showPay = results.some((r) => r.payment !== 0);
    const rows = results.map((r) => `<tr>
      <td><b>${esc(r.apt.code)}</b></td><td class="own">${esc(r.apt.owner)}</td><td class="c">${esc(C.floorLabel(r.apt.floor))}</td>
      <td class="num">${f2(r.apt.sqm)}</td><td class="num">${f2(r.mils)}</td><td class="num">${f2(r.elevMils)}</td>
      <td class="num">${f2(r.prevUnits)}</td><td class="num">${r.currUnits === null ? '—' : f2(r.currUnits)}</td><td class="num">${f2(r.units)}</td>
      <td class="num">${m(r.heatingFixed)}</td><td class="num">${m(r.heatingVariable)}</td><td class="num">${m(r.elevator)}</td><td class="num">${m(r.general)}</td>
      <td class="num b">${m(r.charges)}</td><td class="num">${m(r.prevBalance)}</td><td class="num b tot">${m(r.total)}</td>
      ${showPay ? `<td class="num">${m(r.payment)}</td><td class="num b">${m(r.newBalance)}</td>` : ''}
    </tr>`).join('');
    const exp = expenseRows(t, oil).map(([l, v]) => `<div><span>${esc(l)}</span><b class="num">${e(v)}</b></div>`).join('');
    const css = BASE_CSS + `
      @page{size:A4 landscape;margin:12mm 11mm}
      @media screen{.page{width:297mm;min-height:210mm;padding:12mm 11mm}}
      .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1c2130;padding-bottom:8px}
      .kind{font-size:7.5pt;letter-spacing:.14em;text-transform:uppercase;color:#b5532c;font-weight:700}
      h1{font-size:19pt;font-weight:600}
      .per{text-align:right}.pm{font-size:15pt;font-weight:600}
      .oil{display:flex;gap:0;margin:9px 0 10px;border:1px solid #d9d2c3;border-radius:5px;overflow:hidden}
      .oil div{flex:1;padding:5px 9px;border-right:1px solid #e3ddd0;background:#f7f4ee}
      .oil div:last-child{border-right:0;background:#f8e6db}
      .oil small{display:block;font-size:7pt;color:#6b7080;text-transform:uppercase;letter-spacing:.06em}
      .oil b{font-size:10pt}
      table.main{font-size:7.9pt}
      .main th{background:#1c2130;color:#fff;font-weight:600;font-size:7pt;text-transform:uppercase;letter-spacing:.03em;padding:5px 4px;text-align:right;vertical-align:bottom}
      .main th.l{text-align:left}.main th.c,.main td.c{text-align:center}
      .main th.grp{background:#3a4152;text-align:center}
      .main td{padding:3px 4px;border-bottom:1px solid #e6e1d6}
      .main tbody tr:nth-child(even) td{background:#faf8f4}
      .main td.own{max-width:42mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .main .b{font-weight:700}.main .tot{background:#f8e6db!important;color:#8f3f1f}
      .main tfoot td{font-weight:700;border-top:1.5px solid #1c2130;border-bottom:0;padding-top:5px}
      .exp{margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:18px}
      .exp h3{font-size:8pt;text-transform:uppercase;letter-spacing:.1em;color:#6b7080;margin-bottom:5px}
      .exp .list{display:grid;grid-template-columns:1fr 1fr;gap:2px 22px}
      .exp .list div{display:flex;justify-content:space-between;border-bottom:1px dotted #d9d2c3;padding:2px 0}
      .sumbox{border:1px solid #1c2130;border-radius:5px;padding:8px 12px;display:grid;grid-template-columns:1fr auto;gap:3px 12px;align-self:start}
      .sumbox .g{font-size:12pt;font-weight:700;border-top:1px solid #1c2130;padding-top:4px;margin-top:3px}
      .foot{margin-top:10px;font-size:7pt;color:#8a8f9c;display:flex;justify-content:space-between}
    `;
    return `<!doctype html><html lang="el"><head><meta charset="utf-8"><title>Συγκεντρωτικός πίνακας</title><style>${css}</style></head><body>
    <section class="page">
      ${header(building, period, 'Συγκεντρωτικός πίνακας κοινοχρήστων')}
      <div class="oil">
        <div><small>Απόθεμα αρχής</small><b class="num">${f2(oil.startL)} lt</b></div>
        <div><small>Αγορές</small><b class="num">${f2(oil.boughtL)} lt</b></div>
        <div><small>Απόθεμα τέλους</small><b class="num">${oil.endL === null ? '—' : f2(oil.endL) + ' lt'}</b></div>
        <div><small>Κατανάλωση</small><b class="num">${f2(oil.consumedL)} lt</b></div>
        <div><small>Μέση τιμή</small><b class="num">${C.fmt(oil.avgPrice, 3)} €/lt</b></div>
        <div><small>Πάγιο / Χρήση</small><b class="num">${f0(comp.fixedPct)}% / ${f0(100 - comp.fixedPct)}%</b></div>
        <div><small>Κόστος θέρμανσης</small><b class="num">${e(oil.costCents)}</b></div>
      </div>
      <table class="main">
        <thead>
          <tr><th class="l" rowspan="2">Διαμ.</th><th class="l" rowspan="2">Ένοικος</th><th class="c" rowspan="2">Όροφ.</th><th rowspan="2">τ.μ.</th><th rowspan="2">Χιλ.</th><th rowspan="2">Χιλ. ασ.</th>
          <th class="grp" colspan="3">Θερμιδομετρητής</th><th class="grp" colspan="2">Θέρμανση</th><th rowspan="2">Ασανσέρ</th><th rowspan="2">Γενικά</th><th rowspan="2">Μήνα</th><th rowspan="2">Προηγ.</th><th rowspan="2">Σύνολο</th>
          ${showPay ? '<th rowspan="2">Πληρωμή</th><th rowspan="2">Υπόλοιπο</th>' : ''}</tr>
          <tr><th>Παλιά</th><th>Νέα</th><th>Χρήση</th><th>Πάγιο</th><th>Χρήση</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">Σύνολα</td><td class="num">${f2(t.sqm)}</td><td class="num">${f0(t.mils)}</td><td class="num">${f0(t.elevMils)}</td>
          <td></td><td></td><td class="num">${f2(t.units)}</td><td class="num">${m(t.heatingFixed)}</td><td class="num">${m(t.heatingVariable)}</td>
          <td class="num">${m(t.elevator)}</td><td class="num">${m(t.general)}</td><td class="num">${m(t.charges)}</td><td class="num">${m(t.prevBalance)}</td><td class="num">${m(t.total)}</td>
          ${showPay ? `<td class="num">${m(t.payment)}</td><td class="num">${m(t.newBalance)}</td>` : ''}</tr></tfoot>
      </table>
      <div class="exp">
        <div><h3>Ανάλυση εξόδων πολυκατοικίας</h3><div class="list">${exp || '<span class="muted">Δεν υπάρχουν έξοδα.</span>'}</div></div>
        <div class="sumbox">
          <span>Έξοδα μήνα</span><b class="num">${e(t.charges)}</b>
          <span>Προηγούμενα υπόλοιπα</span><b class="num">${e(t.prevBalance)}</b>
          <span class="g">Προς είσπραξη</span><span class="g num">${e(t.total)}</span>
        </div>
      </div>
      <div class="foot"><span>Χιλιοστά βάσει τετραγωνικών · Ασανσέρ με συντελεστή ορόφου · Θέρμανση: ${f0(comp.fixedPct)}% πάγιο με χιλιοστά, ${f0(100 - comp.fixedPct)}% με χιλιοστά × χρήση</span><span>Εκδόθηκε ${new Date().toLocaleDateString('el-GR')}</span></div>
    </section></body></html>`;
  }

  // ---------------- Ειδοποιητήρια (A4 όρθιο, ένα ανά διαμέρισμα) ----------------
  function receipts(building, period, comp, opts) {
    opts = opts || {};
    const { results, totals: t, oil } = comp;
    const note = building.note === undefined ? C.DEFAULT_NOTE : building.note;
    const showOverview = building.receiptOverview !== false;
    const only = opts.onlyId ? results.filter((r) => r.id === opts.onlyId) : results;

    const overview = showOverview ? `<div class="ov"><h3>Κατάσταση πολυκατοικίας</h3><table>
      <thead><tr><th class="l">Διαμ.</th><th class="l">Ένοικος</th><th>Θέρμανση</th><th>Ασανσέρ</th><th>Γενικά</th><th>Σύνολο</th></tr></thead>
      <tbody>${results.map((r) => `<tr class="__ID_${esc(r.id)}"><td>${esc(r.apt.code)}</td><td class="own">${esc(r.apt.owner)}</td><td class="num">${m(r.heating)}</td><td class="num">${m(r.elevator)}</td><td class="num">${m(r.general)}</td><td class="num"><b>${m(r.total)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">Σύνολο</td><td class="num">${m(t.heating)}</td><td class="num">${m(t.elevator)}</td><td class="num">${m(t.general)}</td><td class="num">${m(t.total)}</td></tr></tfoot>
    </table></div>` : '';

    const pages = only.map((r) => {
      const lines = [];
      C.EXPENSES.forEach((x) => { if (t.expenses[x.key] > 0) lines.push([x.label, t.expenses[x.key], r.breakdown[x.key], `${f2(r.mils)}‰`]); });
      if (t.expenses.elevator > 0) lines.push(['Ανελκυστήρας', t.expenses.elevator, r.elevator, r.apt.noElevator ? 'εξαιρείται' : `${f2(r.elevMils)}‰`]);
      if (oil.costCents > 0) {
        lines.push([`Θέρμανση — πάγιο ${f0(comp.fixedPct)}%`, t.fixedPool, r.heatingFixed, r.apt.noHeating ? 'εξαιρείται' : `${f2(r.mils)}‰`]);
        lines.push([`Θέρμανση — χρήση ${f0(100 - comp.fixedPct)}%`, t.variablePool, r.heatingVariable, r.apt.noHeating ? 'εξαιρείται' : `${f2(r.units)} μον.`]);
      }
      const body = lines.map(([l, all, share, basis]) => `<tr><td>${esc(l)}</td><td class="num muted">${m(all)}</td><td class="c muted">${esc(basis)}</td><td class="num">${m(share)}</td></tr>`).join('');
      const ov = overview.replace(`class="__ID_${esc(r.id)}"`, 'class="me"').replace(/ class="__ID_[^"]*"/g, '');
      return `<section class="page">
        ${header(building, period, 'Ειδοποιητήριο κοινοχρήστων')}
        <div class="who">
          <div><small>Διαμέρισμα</small><b class="serif">${esc(r.apt.code)}</b></div>
          <div class="grow"><small>Ένοικος / Υπόχρεος</small><b class="serif">${esc(r.apt.owner || '—')}</b></div>
          <div><small>Όροφος</small><b>${esc(C.floorLabel(r.apt.floor))}</b></div>
          <div><small>τ.μ.</small><b class="num">${f2(r.apt.sqm)}</b></div>
          <div><small>Χιλιοστά</small><b class="num">${f2(r.mils)}</b></div>
          <div><small>Χιλ. ασανσέρ</small><b class="num">${f2(r.elevMils)}</b></div>
        </div>
        <div class="cols">
          <div>
            <table class="ch"><thead><tr><th class="l">Περιγραφή</th><th>Σύνολο πολ/κίας</th><th class="c">Βάση</th><th>Αναλογεί</th></tr></thead>
            <tbody>${body || '<tr><td colspan="4" class="muted">Δεν υπάρχουν χρεώσεις αυτόν τον μήνα.</td></tr>'}</tbody>
            <tfoot>
              <tr><td colspan="3">Έξοδα μήνα</td><td class="num">${m(r.charges)}</td></tr>
              ${r.prevBalance !== 0 ? `<tr><td colspan="3">${r.prevBalance > 0 ? 'Προηγούμενη οφειλή' : 'Πιστωτικό υπόλοιπο'}</td><td class="num">${m(r.prevBalance)}</td></tr>` : ''}
            </tfoot></table>
          </div>
          <aside class="side">
            <h3>Θερμιδομετρητής</h3>
            <div class="kv"><span>Παλιά ένδειξη</span><b class="num">${f2(r.prevUnits)}</b></div>
            <div class="kv"><span>Νέα ένδειξη</span><b class="num">${r.currUnits === null ? '—' : f2(r.currUnits)}</b></div>
            <div class="kv"><span>Χρήση</span><b class="num">${f2(r.units)}</b></div>
            <h3>Πετρέλαιο πολυκατοικίας</h3>
            <div class="kv"><span>Αρχή</span><b class="num">${f2(oil.startL)} lt</b></div>
            ${oil.purchases.map((p) => `<div class="kv"><span>Αγορά${p.date ? ' ' + esc(new Date(p.date).toLocaleDateString('el-GR')) : ''}</span><b class="num">${f2(p.liters)} lt × ${C.fmt(p.price, 3)}</b></div>`).join('')}
            <div class="kv"><span>Τέλος</span><b class="num">${oil.endL === null ? '—' : f2(oil.endL) + ' lt'}</b></div>
            <div class="kv"><span>Κατανάλωση</span><b class="num accent">${f2(oil.consumedL)} lt</b></div>
            <div class="kv"><span>Μέση τιμή</span><b class="num">${C.fmt(oil.avgPrice, 3)} €/lt</b></div>
          </aside>
        </div>
        <div class="pay">
          <div><small>Ποσό προς εξόφληση</small>${note ? `<p>${esc(note)}</p>` : ''}</div>
          <b class="serif num">${e(r.total)}</b>
        </div>
        ${ov}
      </section>`;
    }).join('');

    const css = BASE_CSS + `
      @page{size:A4;margin:14mm 14mm 12mm}
      @media screen{.page{width:210mm;min-height:297mm;padding:14mm}}
      .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1c2130;padding-bottom:9px}
      .kind{font-size:7.5pt;letter-spacing:.14em;text-transform:uppercase;color:#b5532c;font-weight:700}
      h1{font-size:20pt;font-weight:600}.per{text-align:right}.pm{font-size:15pt;font-weight:600}
      .who{display:flex;gap:0;margin:12px 0 14px;border:1px solid #d9d2c3;border-radius:6px;overflow:hidden}
      .who div{padding:7px 10px;border-right:1px solid #e3ddd0;background:#f7f4ee}
      .who div:last-child{border-right:0}.who .grow{flex:1;background:#fff}
      .who small{display:block;font-size:6.8pt;color:#6b7080;text-transform:uppercase;letter-spacing:.07em}
      .who b{font-size:11.5pt}
      .cols{display:grid;grid-template-columns:1fr 54mm;gap:12px}
      .ch th{font-size:7pt;text-transform:uppercase;letter-spacing:.05em;color:#6b7080;border-bottom:1.5px solid #1c2130;padding:4px 5px;text-align:right;font-weight:700}
      .ch th.l{text-align:left}.ch th.c,.ch td.c{text-align:center}
      .ch td{padding:5px;border-bottom:1px solid #ebe6dc}
      .ch tfoot td{font-weight:700;border-bottom:0;padding-top:6px}
      .ch tfoot tr:first-child td{border-top:1px solid #1c2130}
      .side{background:#f7f4ee;border-radius:6px;padding:8px 10px;font-size:8.3pt;align-self:start}
      .side h3{font-size:7pt;text-transform:uppercase;letter-spacing:.1em;color:#6b7080;margin:2px 0 4px}
      .side h3:not(:first-child){margin-top:10px}
      .kv{display:flex;justify-content:space-between;gap:8px;padding:1.5px 0;border-bottom:1px dotted #d9d2c3}
      .pay{margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:16px;border:1.5px solid #b5532c;background:#fbf0e9;border-radius:7px;padding:11px 16px}
      .pay small{font-size:8pt;text-transform:uppercase;letter-spacing:.12em;color:#8f3f1f;font-weight:700}
      .pay p{margin:4px 0 0;color:#4a5163;font-size:8.5pt;max-width:110mm}
      .pay b{font-size:23pt;color:#8f3f1f;font-weight:600}
      .ov{margin-top:16px}
      .ov h3{font-size:7pt;text-transform:uppercase;letter-spacing:.1em;color:#6b7080;margin-bottom:4px}
      .ov table{font-size:7.4pt}
      .ov th{text-align:right;font-weight:600;color:#6b7080;border-bottom:1px solid #b9b2a3;padding:2px 4px}.ov th.l{text-align:left}
      .ov td{padding:2px 4px;border-bottom:1px solid #efebe3}
      .ov td.own{max-width:60mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ov tr.me td{background:#f8e6db;font-weight:700}
      .ov tfoot td{font-weight:700;border-top:1px solid #b9b2a3;border-bottom:0}
      tr,.pay,.who{break-inside:avoid}
    `;
    return `<!doctype html><html lang="el"><head><meta charset="utf-8"><title>Ειδοποιητήρια</title><style>${css}</style></head><body>${pages || '<p>Δεν υπάρχουν διαμερίσματα.</p>'}</body></html>`;
  }

  root.Reports = { statement, receipts };
})(typeof self !== 'undefined' ? self : this);
