/* Κοινόχρηστα — αναφορές για εκτύπωση/PDF.
 * Σχεδιασμένες για οικονομία μελανιού: λευκό φόντο, χωρίς γεμίσματα,
 * μόνο κείμενο και λεπτές γραμμές. */
(function (root) {
  'use strict';
  const C = root.Calc;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const m = C.money;
  const e = C.euro;
  const f2 = (v) => C.fmt(v, 2);
  const f0 = (v) => C.fmt(v, 0);
  const f3 = (v) => C.fmt(v, 3);
  // Κεφαλαία χωρίς τόνους, όπως γράφονται στα ελληνικά.
  const up = (v) => String(v == null ? '' : v).normalize('NFD').replace(/\u0301/g, '').normalize('NFC').toUpperCase();

  const BASE_CSS = `
  *{box-sizing:border-box}
  html,body{margin:0;background:#fff;color:#000}
  body{font:9pt/1.35 -apple-system,"Segoe UI",system-ui,Arial,sans-serif}
  .num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
  h1,h2,h3{margin:0}
  .page{page-break-after:always;break-after:page}
  .page:last-child{page-break-after:auto;break-after:auto}
  table{border-collapse:collapse;width:100%}
  .muted{color:#444}
  @media screen{body{background:#e9e6df;padding:20px 0}.page{background:#fff;margin:0 auto 20px;box-shadow:0 4px 18px rgba(0,0,0,.12)}}
  `;

  const expenseList = (t, oil) => {
    const rows = C.ALL_EXPENSES.filter((x) => t.expenses[x.key] > 0).map((x) => [x.label, t.expenses[x.key]]);
    if (oil.costCents > 0) rows.push(['Πετρέλαιο', oil.costCents]);
    return rows;
  };
  const purchasesText = (oil) => oil.purchases.length ? oil.purchases.map((p) => f2(p.liters)).join(' + ') : '0,00';

  // ---------------- Συγκεντρωτικός πίνακας (A4 οριζόντιο) ----------------
  function statement(building, period, comp) {
    const { results, totals: t, oil } = comp;
    const showPay = results.some((r) => r.payment !== 0);
    // Οικονομία μελανιού: ό,τι είναι μηδέν σε όλη την πολυκατοικία δεν τυπώνεται.
    const hasHeat = oil.costCents > 0;
    const hasElev = t.elevator > 0;
    const prevOf = (r) => r.prevBalance + (r.adjust || 0);
    const hasPrev = results.some((r) => prevOf(r) !== 0);
    const H = (x) => (hasHeat ? x : '');
    const E = (x) => (hasElev ? x : '');
    const P = (x) => (hasPrev ? x : '');
    const rows = results.map((r) => `<tr>
      <td class="l">${esc(r.apt.owner)} (${esc(r.apt.code)})</td><td>${f2(r.apt.sqm)}</td><td>${f0(r.mils)}</td>${E(`<td>${f0(r.elevMils)}</td>`)}
      ${H(`<td>${f2(r.prevUnits)}</td><td>${r.currUnits === null ? '—' : f2(r.currUnits)}</td><td>${f2(r.units)}</td>
      <td>${m(r.heatingFixed)}</td><td>${m(r.heatingVariable)}</td><td>${m(r.heating)}</td>`)}${E(`<td>${m(r.elevator)}</td>`)}<td>${m(r.general)}</td>
      <td class="b">${m(r.charges)}</td>${P(`<td>${m(prevOf(r))}</td>`)}
      ${showPay ? `<td>${m(r.payment)}</td><td class="b">${m(r.newBalance)}</td>` : ''}
    </tr>`).join('');
    const exp = expenseList(t, oil).map(([l, v]) => `<div><span>${esc(l)}:</span><b class="num">${e(v)}</b></div>`).join('');
    const css = BASE_CSS + `
      @page{size:A4 landscape;margin:12mm 11mm}
      @media screen{.page{width:297mm;min-height:210mm;padding:12mm 11mm}}
      h1{font-size:13pt;font-weight:700}
      .addr{font-size:8.5pt;margin-top:1px}
      .oil{margin:7px 0 10px;font-size:8.3pt}
      table.main{font-size:7.8pt}
      .main th{font-weight:700;font-size:7.2pt;padding:3px 4px 4px;text-align:right;vertical-align:bottom;border-bottom:1px solid #000;line-height:1.2}
      .main th.l,.main td.l{text-align:left}
      .main td{padding:3px 4px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;border-bottom:.5px solid #bbb}
      .main td.l{max-width:60mm;overflow:hidden;text-overflow:ellipsis}
      .main .b{font-weight:700}
      .main tfoot td{font-weight:700;border-top:1px solid #000;border-bottom:0;padding-top:4px}
      .exp{margin-top:14px;display:grid;grid-template-columns:1fr 96mm;gap:24px;align-items:start}
      .exp h3{font-size:9pt;font-weight:700;margin-bottom:5px}
      .exp .list{display:grid;grid-template-columns:repeat(2,minmax(0,62mm));gap:2px 26px;font-size:8.3pt}
      .exp .list div{display:flex;justify-content:space-between;gap:10px}
      .sumbox{border:.75px solid #000;padding:7px 10px;display:grid;grid-template-columns:1fr auto;gap:2px 12px;font-size:8.5pt}
      .sumbox .g0{font-size:10.5pt;font-weight:700}
      .sumbox .sm{font-size:8pt;color:#333;border-top:.5px solid #999;padding-top:3px;margin-top:3px}
      .foot{margin-top:10px;font-size:7pt;color:#555}
    `;
    const oilLine = `ΚΑΤΑΣΤΑΣΗ ΔΕΞΑΜΕΝΗΣ (lt) → Αρχή: ${f2(oil.startL)} | Αγορά: ${purchasesText(oil)} | Τέλος: ${oil.endL === null ? '—' : f2(oil.endL)} | <b>Καταναλώθηκαν: ${f2(oil.consumedL)} lt</b> | Μέση τιμή: ${f3(oil.avgPrice)} €/lt | Κόστος: ${e(oil.costCents)} | Πάγιο ${f0(comp.fixedPct)}%`;
    return `<!doctype html><html lang="el"><head><meta charset="utf-8"><title>Συγκεντρωτικός πίνακας</title><style>${css}</style></head><body>
    <section class="page">
      <h1>ΣΥΓΚΕΝΤΡΩΤΙΚΟΣ ΠΙΝΑΚΑΣ: ${esc(up(building.name))} — ${esc(up(C.periodLabel(period)))}</h1>
      ${building.address ? `<div class="addr muted">${esc(building.address)}</div>` : ''}
      ${hasHeat ? `<div class="oil">${oilLine}</div>` : '<div style="height:8px"></div>'}
      <table class="main">
        <thead><tr>
          <th class="l">Ένοικος (Διαμ.)</th><th>τ.μ.</th><th>Χιλ.</th>${E('<th>Χιλ.<br>Ασαν.</th>')}${H('<th>Παλαιά<br>Ένδειξη</th><th>Νέα<br>Ένδειξη</th><th>Χρήση</th><th>Πάγιο</th><th>Μεταβλητό</th><th>Σύνολο<br>Θερμ.</th>')}${E('<th>Ασανσέρ</th>')}<th>Κοιν/στα<br>Έξοδα</th><th>ΣΥΝΟΛΟ<br>ΜΗΝΑ</th>${P('<th>Παλαιά<br>Οφειλή</th>')}
          ${showPay ? '<th>Πληρωμή</th><th>Υπόλοιπο</th>' : ''}
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td class="l">ΣΥΝΟΛΑ:</td><td>${f2(t.sqm)}</td><td>${f0(t.mils)}</td>${E(`<td>${f0(t.elevMils)}</td>`)}${H(`<td></td><td></td><td>${f2(t.units)}</td>
          <td>${m(t.heatingFixed)}</td><td>${m(t.heatingVariable)}</td><td>${m(t.heating)}</td>`)}${E(`<td>${m(t.elevator)}</td>`)}<td>${m(t.general)}</td><td>${m(t.charges)}</td>${P(`<td>${m(t.prevBalance + (t.adjust || 0))}</td>`)}
          ${showPay ? `<td>${m(t.payment)}</td><td>${m(t.newBalance)}</td>` : ''}</tr></tfoot>
      </table>
      <div class="exp">
        <div><h3>ΑΝΑΛΥΣΗ ΣΥΝΟΛΙΚΩΝ ΕΞΟΔΩΝ ΠΟΛΥΚΑΤΟΙΚΙΑΣ</h3><div class="list">${exp || '<span class="muted">Δεν υπάρχουν έξοδα.</span>'}</div></div>
        <div class="sumbox">
          <span class="g0">ΣΥΝΟΛΟ ΚΟΙΝΟΧΡΗΣΤΩΝ ΜΗΝΑ</span><b class="g0 num">${e(t.charges)}</b>
          ${hasPrev ? `<span class="sm">Παλαιές οφειλές (εκτός συνόλου)</span><span class="sm num">${e(t.prevBalance + (t.adjust || 0))}</span>` : ''}
        </div>
      </div>
      <div class="foot">Εκδόθηκε ${new Date().toLocaleDateString('el-GR')}</div>
    </section></body></html>`;
  }

  // ---------------- Ειδοποιητήρια (A4 όρθιο, ένα ανά διαμέρισμα) ----------------
  // Κλειδί ενοίκου: ίδιο όνομα (χωρίς τόνους, κεφαλαία/μικρά, κενά) = ίδιος ένοικος.
  const ownerKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').replace(/\s*\.\s*/g, '.').trim();

  function receipts(building, period, comp, opts) {
    opts = opts || {};
    const { results, totals: t, oil } = comp;
    const note = building.note === undefined ? C.DEFAULT_NOTE : building.note;
    const showOverview = building.receiptOverview !== false;
    const only = opts.onlyId ? results.filter((r) => r.id === opts.onlyId) : results;
    const analysis = expenseList(t, oil).map(([l, v]) => `<div class="kv"><span>${esc(l)}:</span><b class="num">${e(v)}</b></div>`).join('');

    // Διαμερίσματα με το ίδιο όνομα ενοίκου ανήκουν στον ίδιο ένοικο: ένα ειδοποιητήριο (ένα χαρτί) για όλα μαζί.
    const groups = [];
    const byKey = {};
    only.forEach((r) => {
      const k = ownerKey(r.apt.owner) || 'id:' + r.id;
      if (!byKey[k]) { byKey[k] = { key: k, owner: r.apt.owner, list: [] }; groups.push(byKey[k]); }
      byKey[k].list.push(r);
    });
    // Ανάλυση ανά ένοικο (όλη η πολυκατοικία), για διαφάνεια.
    const allGroups = [];
    const allByKey = {};
    results.forEach((r) => {
      const k = ownerKey(r.apt.owner) || 'id:' + r.id;
      if (!allByKey[k]) { allByKey[k] = { key: k, owner: r.apt.owner, codes: [], heating: 0, elevator: 0, general: 0, charges: 0 }; allGroups.push(allByKey[k]); }
      const g = allByKey[k];
      g.codes.push(r.apt.code); g.heating += r.heating; g.elevator += r.elevator; g.general += r.general; g.charges += r.charges;
    });

    const aptBox = (r) => {
      // Πρώτα μόνο τα έξοδα του μήνα και το «Σύνολο μήνα». Οφειλές/πιστώσεις χωριστά από κάτω.
      const items = [];
      C.EXPENSES.forEach((x) => { if (r.breakdown[x.key] > 0) items.push([x.label, r.breakdown[x.key]]); });
      if (r.heatingFixed > 0) items.push(['Πάγιο θέρμανσης', r.heatingFixed]);
      if (r.heatingVariable > 0) items.push(['Χρήση θέρμανσης', r.heatingVariable]);
      if (r.elevator > 0) items.push(['Ασανσέρ', r.elevator]);
      const body = items.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="num">${m(v)}</td></tr>`).join('');
      const old = r.prevBalance + (r.adjust || 0);
      const bal = old !== 0 ? `<tbody class="bal"><tr><td>Παλαιά οφειλή</td><td class="num">${m(old)}</td></tr></tbody>` : '';
      return `<div class="apt">
        <div class="ah">ΔΙΑΜΕΡΙΣΜΑ: ${esc(r.apt.code)} (${esc(C.floorLabel(r.apt.floor))})</div>
        <div class="sub">Χιλ.: ${f0(r.mils)}${t.elevator > 0 && r.elevator > 0 ? ` | Χιλ. Ασανσέρ: ${f0(r.elevMils)}` : ''}</div>
        ${oil.costCents > 0 ? `<div class="sub">Παλαιά: ${f2(r.prevUnits)} | Νέα: ${r.currUnits === null ? '—' : f2(r.currUnits)} | Χρήση: ${f2(r.units)}</div>` : ''}
        <table class="ch"><thead><tr><th class="l">ΠΕΡΙΓΡΑΦΗ</th><th>ΠΟΣΟ</th></tr></thead>
          <tbody>${body || '<tr><td colspan="2" class="muted">Καμία χρέωση.</td></tr>'}</tbody>
          <tbody class="sum"><tr><td>Σύνολο μήνα:</td><td class="num">${e(r.charges)}</td></tr></tbody>${bal}</table>
      </div>`;
    };
    const side = `<div class="side"><h3>ΑΝΑΛΥΣΗ ΕΞΟΔΩΝ ΠΟΛ/ΚΙΑΣ</h3>${analysis || '<span class="muted">—</span>'}</div>`;

    const pages = groups.filter((g) => g.list.some((r) => r.total !== 0 || r.charges !== 0)).map((g) => {
      const grand = g.list.reduce((a, r) => a + r.total, 0);
      const multi = g.list.length > 1;
      const overview = showOverview ? `<div class="ov"><h3>ΑΝΑΛΥΣΗ ΑΝΑ ΕΝΟΙΚΟ</h3><table>
        <thead><tr><th class="l">Ένοικος</th><th class="l">Διαμ.</th>${t.heating ? '<th>Θέρμ.</th>' : ''}${t.elevator ? '<th>Ασαν.</th>' : ''}<th>Κοιν.</th><th>Σύνολο</th></tr></thead>
        <tbody>${allGroups.map((x) => `<tr${x.key === g.key ? ' class="me"' : ''}><td class="own">${esc(x.owner || '—')}</td><td class="codes">${esc(x.codes.join(', '))}</td>${t.heating ? `<td class="num">${m(x.heating)}</td>` : ''}${t.elevator ? `<td class="num">${m(x.elevator)}</td>` : ''}<td class="num">${m(x.general)}</td><td class="num">${m(x.charges)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Σύνολο</td>${t.heating ? `<td class="num">${m(t.heating)}</td>` : ''}${t.elevator ? `<td class="num">${m(t.elevator)}</td>` : ''}<td class="num">${m(t.general)}</td><td class="num">${m(t.charges)}</td></tr></tfoot>
      </table><div class="ovnote">Τα ποσά είναι τα έξοδα του μήνα, χωρίς παλαιές οφειλές.</div></div>` : '';

      return `<section class="page">
        <h1>ΕΙΔΟΠΟΙΗΤΗΡΙΟ ΚΟΙΝΟΧΡΗΣΤΩΝ: ${esc(building.name)}</h1>
        <div class="meta">Περίοδος: ${esc(C.periodLabel(period))}${building.address ? ' · ' + esc(building.address) : ''}</div>
        <div class="owner">Υπόχρεος: ${esc(up(g.owner || '—'))}${multi ? ` <span class="cnt">(${g.list.length} διαμερίσματα: ${esc(g.list.map((r) => r.apt.code).join(', '))})</span>` : ''}</div>
        ${oil.costCents > 0 ? `<div class="oil">
          <div class="cap">ΣΤΟΙΧΕΙΑ ΠΕΤΡΕΛΑΙΟΥ ΠΟΛΥΚΑΤΟΙΚΙΑΣ</div>
          <div>Αρχή: ${f2(oil.startL)} lt | Αγορές: ${purchasesText(oil)} lt | Τέλος: ${oil.endL === null ? '—' : f2(oil.endL) + ' lt'} | Μέση τιμή: ${f3(oil.avgPrice)} €/lt</div>
          <div><b>Συνολική κατανάλωση: ${f2(oil.consumedL)} lt</b></div>
        </div>` : ''}
        ${multi
          ? `<div class="apts n${Math.min(g.list.length, 3)}">${g.list.map(aptBox).join('')}</div>
             <div class="cols2">${overview || '<div></div>'}${side}</div>`
          : `<div class="cols">${aptBox(g.list[0])}${side}</div>${overview}`}
        <div class="pay">
          ${note ? `<div class="note"><span class="warn">⚠</span> ${esc(note)}</div>` : ''}
          <div class="amt"><span>ΣΥΝΟΛΙΚΟ ΠΟΣΟ ΠΡΟΣ ΕΞΟΦΛΗΣΗ:</span><b class="num">${e(grand)}</b></div>
        </div>
      </section>`;
    }).join('');

    const css = BASE_CSS + `
      @page{size:A4;margin:14mm 15mm 12mm}
      @media screen{.page{width:210mm;min-height:297mm;padding:14mm 15mm}}
      h1{font-size:13pt;font-weight:700}
      .meta{margin-top:3px;font-size:9pt}
      .owner{margin-top:6px;font-size:11pt;font-weight:700}
      .oil{margin-top:10px;border:.75px solid #888;padding:5px 9px;font-size:8.3pt;display:grid;gap:1px}
      .cap{font-size:7.5pt;font-weight:700}
      .cols{display:grid;grid-template-columns:1fr 58mm;gap:16px;margin-top:12px;align-items:start}
      .apt{border:.75px solid #000;padding:8px 10px}
      .ah{font-weight:700;font-size:9.5pt}
      .sub{font-size:8pt;margin-top:2px}
      .ch{margin-top:8px;font-size:8.6pt}
      .ch th{font-size:7.3pt;font-weight:700;text-align:right;border-bottom:.75px solid #000;padding:2px 4px}
      .ch th.l{text-align:left}
      .ch td{padding:2.5px 4px;border-bottom:.5px dotted #aaa}
      .ch .sum td{font-weight:700;font-size:9.5pt;border-top:.75px solid #000;border-bottom:0;padding-top:5px}
      .ch .bal td{border-bottom:0;padding-top:3px}
      .ch .bal tr:first-child td{padding-top:8px}
      .ch .fin td{font-weight:700;font-size:9.5pt;border-top:.5px solid #000;padding-top:4px}
      .ch tfoot td{font-weight:700;font-size:9.5pt;border-top:.75px solid #000;border-bottom:0;padding-top:5px}
      .side{font-size:8pt;padding-top:2px}
      .side h3{font-size:8.3pt;font-weight:700;text-decoration:underline;margin-bottom:5px}
      .kv{display:flex;justify-content:space-between;gap:8px;padding:1px 0}
      .ov{margin-top:14px}
      .ov h3{font-size:8.3pt;font-weight:700;text-decoration:underline;margin-bottom:4px}
      .ov table{font-size:7.4pt}
      .ov th{text-align:right;font-weight:700;border-bottom:.75px solid #000;padding:1.5px 4px}.ov th.l{text-align:left}
      .ov td{padding:1.5px 4px;border-bottom:.5px solid #ddd}
      .ov td.own{max-width:62mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ov tr.me td{font-weight:700}
      .ov tr.me td:first-child::before{content:"► ";font-size:6pt}
      .ov tfoot td{font-weight:700;border-top:.75px solid #000;border-bottom:0}
      .ovnote{font-size:6.8pt;color:#555;margin-top:2px}
      .pay{margin-top:14px;border:.75px solid #000;padding:8px 12px}
      .note{font-size:9pt;font-weight:700;margin-bottom:6px;color:#c40000}
      .note .warn{font-size:12pt;line-height:1;vertical-align:-1px}
      .cnt{font-weight:400;font-size:9pt}
      .apts{display:grid;gap:10px;margin-top:12px;align-items:start}
      .apts.n2{grid-template-columns:1fr 1fr}
      .apts.n3{grid-template-columns:1fr 1fr 1fr}
      .apts .ch{font-size:8pt}.apts .ch td,.apts .ch th{padding:2px 3px}
      .apts .sub{font-size:7.4pt}
      .cols2{display:grid;grid-template-columns:1fr 58mm;gap:16px;align-items:start}
      .cols2 .side{margin-top:14px}
      .ov td.codes{white-space:nowrap}
      .amt{display:flex;justify-content:space-between;align-items:baseline;gap:16px}
      .amt span{font-size:11pt;font-weight:700}
      .amt b{font-size:15pt}
      tr,.pay,.apt,.oil{break-inside:avoid}
    `;
    return `<!doctype html><html lang="el"><head><meta charset="utf-8"><title>Ειδοποιητήρια</title><style>${css}</style></head><body>${pages || '<p>Δεν υπάρχουν διαμερίσματα.</p>'}</body></html>`;
  }

  root.Reports = { statement, receipts };
})(typeof self !== 'undefined' ? self : this);
