/*
 * Κοινόχρηστα — λογική υπολογισμών.
 * Καθαρές συναρτήσεις, χωρίς DOM, ώστε να τρέχουν και σε Node για τα tests.
 * Όλα τα ποσά κατανέμονται σε λεπτά (cents) με τη μέθοδο του μεγαλύτερου
 * υπολοίπου, ώστε τα επιμέρους μερίδια να αθροίζουν ακριβώς στο σύνολο.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
    'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];

  // Γενικά έξοδα: μοιράζονται με τα χιλιοστά. Το ασανσέρ έχει δική του κλίμακα.
  const EXPENSES = [
    { key: 'dei', label: 'ΔΕΗ κοινοχρήστων' },
    { key: 'water', label: 'Νερό κοινοχρήστων' },
    { key: 'cleaning', label: 'Καθαρισμός' },
    { key: 'burner', label: 'Συντήρηση καυστήρα' },
    { key: 'extinguishers', label: 'Πυροσβεστήρες' },
    { key: 'disinfection', label: 'Απολύμανση' },
    { key: 'management', label: 'Διαχείριση' },
    { key: 'extra', label: 'Λοιπά έξοδα' }
  ];
  const ELEVATOR = { key: 'elevator', label: 'Ανελκυστήρας' };
  const ALL_EXPENSES = [EXPENSES[0], ELEVATOR, ...EXPENSES.slice(1)];

  const DEFAULT_NOTE = 'Παρακαλούμε, όχι χαρτιά στις αποχετεύσεις — οι αποφράξεις κοστίζουν σε όλους.';

  // ---------- αριθμοί ----------
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (v === null || v === undefined) return 0;
    let s = String(v).trim().replace(/\s|€/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  const toCents = (v) => Math.round(num(v) * 100);
  const fromCents = (c) => c / 100;

  // Κατανομή ακέραιου συνόλου σε βάρη, με το μεγαλύτερο υπόλοιπο.
  function allocate(total, weights) {
    const n = weights.length;
    const out = new Array(n).fill(0);
    const sumW = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0);
    if (!n || !total || sumW <= 0) return out;
    const sign = total < 0 ? -1 : 1;
    const abs = Math.abs(total);
    const rema = [];
    let used = 0;
    for (let i = 0; i < n; i++) {
      const w = weights[i] > 0 ? weights[i] : 0;
      const exact = (abs * w) / sumW;
      const fl = Math.floor(exact + 1e-9);
      out[i] = fl; used += fl;
      rema.push({ i, r: exact - fl, w });
    }
    rema.sort((a, b) => (b.r - a.r) || (b.w - a.w) || (a.i - b.i));
    for (let k = 0; k < abs - used; k++) out[rema[k % n].i] += 1;
    return out.map((c) => c * sign);
  }

  // ---------- ασανσέρ ----------
  // Προεπιλογή: υπόγειο/ισόγειο 0, 1ος 1,00 και +0,10 ανά όροφο, χωρίς ανώτατο όριο.
  function defaultElevatorFactor(floor) {
    const f = Math.trunc(num(floor));
    return f <= 0 ? 0 : Math.round((1 + 0.1 * (f - 1)) * 100) / 100;
  }
  function elevatorFactor(floor, table) {
    const f = String(Math.trunc(num(floor)));
    if (table && table[f] !== undefined && table[f] !== null && table[f] !== '') return num(table[f]);
    return defaultElevatorFactor(floor);
  }

  // ---------- πετρέλαιο ----------
  // Μέση σταθμισμένη τιμή: το απόθεμα αρχής κοστολογείται με την τιμή που
  // μεταφέρθηκε από τον προηγούμενο μήνα, κάθε αγορά με τη δική της τιμή.
  function oilSummary(oil) {
    oil = oil || {};
    const startL = Math.max(0, num(oil.startLiters));
    const startP = Math.max(0, num(oil.startPrice));
    const purchases = (oil.purchases || []).map((p) => ({ liters: Math.max(0, num(p.liters)), price: Math.max(0, num(p.price)), date: p.date || '' }));
    const boughtL = purchases.reduce((a, p) => a + p.liters, 0);
    const boughtCost = purchases.reduce((a, p) => a + p.liters * p.price, 0);
    const availableL = startL + boughtL;
    const value = startL * startP + boughtCost;
    const avgPrice = availableL > 0 ? value / availableL : 0;
    const endL = oil.endLiters === '' || oil.endLiters === null || oil.endLiters === undefined ? null : Math.max(0, num(oil.endLiters));
    const warnings = [];
    let consumedL = 0;
    if (endL === null) { if (availableL > 0) warnings.push('Δεν έχει συμπληρωθεί η ένδειξη τέλους της δεξαμενής.'); }
    else if (endL > availableL + 1e-9) warnings.push('Η ένδειξη τέλους είναι μεγαλύτερη από αρχή + αγορές.');
    else consumedL = availableL - endL;
    if (startL > 0 && startP === 0) warnings.push('Λείπει η τιμή του αποθέματος αρχής.');
    const costCents = Math.round(consumedL * avgPrice * 100);
    return { startL, startP, purchases, boughtL, boughtCost, availableL, avgPrice, endL, consumedL, costCents, warnings };
  }

  // ---------- κύριος υπολογισμός ----------
  function consumption(row) {
    if (!row) return { units: 0, missing: true, negative: false };
    const prev = num(row.prevUnits);
    if (row.currUnits === null || row.currUnits === undefined || row.currUnits === '') return { units: 0, missing: true, negative: false };
    const d = num(row.currUnits) - prev;
    return { units: d > 0 ? d : 0, missing: false, negative: d < 0 };
  }

  /**
   * apartments: [{id, code, owner, floor, sqm, noHeating, noElevator}]
   * period: {fixedPercent, oil, expenses:{key:value}, rows:{aptId:{prevUnits,currUnits,prevBalance,payment}}}
   * settings: {elevatorFactors:{floor:factor}}
   */
  function compute(apartments, period, settings) {
    apartments = apartments || [];
    settings = settings || {};
    const rows = period.rows || {};
    const exp = period.expenses || {};
    const warnings = [];

    const totalSqm = apartments.reduce((a, x) => a + Math.max(0, num(x.sqm)), 0);
    const mils = apartments.map((a) => (totalSqm > 0 ? (Math.max(0, num(a.sqm)) / totalSqm) * 1000 : 0));
    const elevRaw = apartments.map((a, i) => (a.noElevator ? 0 : mils[i] * elevatorFactor(a.floor, settings.elevatorFactors)));
    let elevSum = elevRaw.reduce((a, b) => a + b, 0);
    let elevWeights = elevRaw;
    if (elevSum <= 0) { elevWeights = mils.slice(); elevSum = mils.reduce((a, b) => a + b, 0); }
    const elevMils = elevWeights.map((w) => (elevSum > 0 ? (w / elevSum) * 1000 : 0));
    if (!totalSqm && apartments.length) warnings.push('Δεν έχουν οριστεί τετραγωνικά — τα χιλιοστά είναι μηδενικά.');

    // Γενικά έξοδα, ανά κατηγορία.
    const generalByKey = {};
    EXPENSES.forEach((e) => { generalByKey[e.key] = allocate(toCents(exp[e.key]), mils); });
    const elevatorShares = allocate(toCents(exp.elevator), elevWeights);

    // Θέρμανση.
    const oil = oilSummary(period.oil);
    warnings.push(...oil.warnings);
    const fixedPct = Math.min(100, Math.max(0, num(period.fixedPercent)));
    const fixedPool = Math.round(oil.costCents * fixedPct / 100);
    const variablePool = oil.costCents - fixedPool;
    const heatMils = apartments.map((a, i) => (a.noHeating ? 0 : mils[i]));
    // Κοινός θερμιδομετρητής: ένα διαμέρισμα (meterWith) διαβάζει τον μετρητή ενός άλλου.
    // Η χρήση του μετρητή μοιράζεται εξίσου σε όλα τα διαμερίσματα που τον μοιράζονται.
    const byId = {}; apartments.forEach((a) => { byId[a.id] = a; });
    const sharing = (a) => !!(a && a.meterWith && a.meterShared !== false);
    const meterOf = (a) => (sharing(a) && byId[a.meterWith] && !sharing(byId[a.meterWith]) ? a.meterWith : a.id);
    const share = {}; apartments.forEach((a) => { const k = meterOf(a); share[k] = (share[k] || 0) + 1; });
    const cons = apartments.map((a) => {
      const k = meterOf(a); const c = consumption(rows[k]); const n = share[k] || 1;
      return { ...c, units: c.units / n, meter: k, shareN: n };
    });
    cons.forEach((c, i) => {
      if (apartments[i].noHeating) return;
      if (cons[i].meter !== apartments[i].id) return;
      if (c.missing && oil.costCents > 0) warnings.push(`Διαμ. ${apartments[i].code || '—'}: λείπει η νέα ένδειξη θερμιδομετρητή.`);
      if (c.negative) warnings.push(`Διαμ. ${apartments[i].code || '—'}: η νέα ένδειξη είναι μικρότερη από την παλιά.`);
    });
    const varWeights = apartments.map((a, i) => heatMils[i] * cons[i].units);
    let variableFallback = false;
    let varShares;
    if (variablePool > 0 && varWeights.reduce((a, b) => a + b, 0) <= 0) {
      variableFallback = true;
      varShares = allocate(variablePool, heatMils);
      warnings.push('Δεν υπάρχει καταγεγραμμένη χρήση θέρμανσης — το μεταβλητό μέρος μοιράστηκε με τα χιλιοστά.');
    } else varShares = allocate(variablePool, varWeights);
    const fixedShares = allocate(fixedPool, heatMils);

    const results = apartments.map((a, i) => {
      const r = rows[a.id] || {};
      const breakdown = {};
      let general = 0;
      EXPENSES.forEach((e) => { breakdown[e.key] = generalByKey[e.key][i]; general += generalByKey[e.key][i]; });
      const heatingFixed = fixedShares[i];
      const heatingVariable = varShares[i];
      const elevator = elevatorShares[i];
      const charges = heatingFixed + heatingVariable + elevator + general;
      const prevBalance = toCents(r.prevBalance);
      // Χειροκίνητη διόρθωση οφειλής (π.χ. πίστωση λόγω λάθους): θετική = χρέωση, αρνητική = πίστωση.
      const adjust = toCents(r.adjust);
      const total = charges + prevBalance + adjust;
      const payment = toCents(r.payment);
      return {
        id: a.id, apt: a,
        mils: mils[i], elevMils: elevMils[i], factor: a.noElevator ? 0 : elevatorFactor(a.floor, settings.elevatorFactors),
        ...(() => { const mr = rows[cons[i].meter] || {}; return { prevUnits: num(mr.prevUnits), currUnits: mr.currUnits === '' || mr.currUnits == null ? null : num(mr.currUnits) }; })(),
        units: cons[i].units, shareN: cons[i].shareN, meterId: cons[i].meter,
        heatingFixed, heatingVariable, heating: heatingFixed + heatingVariable,
        elevator, general, breakdown, charges, prevBalance, adjust, adjustNote: r.adjustNote || '', total, payment, newBalance: total - payment
      };
    });

    const sum = (k) => results.reduce((a, r) => a + r[k], 0);
    const expenseTotals = {};
    ALL_EXPENSES.forEach((e) => { expenseTotals[e.key] = toCents(exp[e.key]); });
    const totals = {
      sqm: totalSqm, mils: mils.reduce((a, b) => a + b, 0), elevMils: elevMils.reduce((a, b) => a + b, 0),
      units: sum('units'), heatingFixed: sum('heatingFixed'), heatingVariable: sum('heatingVariable'), heating: sum('heating'),
      elevator: sum('elevator'), general: sum('general'), charges: sum('charges'), prevBalance: sum('prevBalance'), adjust: sum('adjust'),
      total: sum('total'), payment: sum('payment'), newBalance: sum('newBalance'),
      oilCost: oil.costCents, fixedPool, variablePool, expenses: expenseTotals,
      expensesSum: Object.values(expenseTotals).reduce((a, b) => a + b, 0)
    };
    return { results, totals, oil, fixedPct, variableFallback, warnings };
  }

  // ---------- κλείσιμο μήνα ----------
  function nextMonth(year, month) { return month >= 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }; }

  // Φτιάχνει τον επόμενο μήνα από έναν που κλείνει.
  function rollover(period, computed, recurringKeys, uid) {
    const nm = nextMonth(period.year, period.month);
    const rows = {};
    computed.results.forEach((r) => {
      rows[r.id] = { prevUnits: gr(r.currUnits === null ? r.prevUnits : r.currUnits), currUnits: '', prevBalance: r.newBalance ? gr(fromCents(r.newBalance)) : '', payment: '' };
    });
    const expenses = {};
    (recurringKeys || []).forEach((k) => { if (period.expenses && period.expenses[k] !== undefined) expenses[k] = period.expenses[k]; });
    const o = computed.oil;
    const endL = o.endL === null ? o.availableL : o.endL;
    return {
      id: uid(), year: nm.year, month: nm.month, status: 'open',
      fixedPercent: period.fixedPercent,
      oil: { startLiters: gr(round2(endL)), startPrice: gr(round4(o.avgPrice || o.startP)), endLiters: '', purchases: [] },
      expenses, rows
    };
  }
  // Αριθμός σε κείμενο με ελληνική υποδιαστολή, χωρίς διαχωριστικό χιλιάδων.
  const gr = (x) => String(x).replace('.', ',');
  const round2 = (x) => Math.round(x * 100) / 100;
  const round4 = (x) => Math.round(x * 10000) / 10000;

  // ---------- μορφοποίηση ----------
  const fmtMoney = new Intl.NumberFormat('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const euro = (cents) => fmtMoney.format(fromCents(cents)) + ' €';
  const money = (cents) => fmtMoney.format(fromCents(cents));
  const fmt = (v, d = 2) => new Intl.NumberFormat('el-GR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(num(v));
  const periodLabel = (p) => `${MONTHS[p.month]} ${p.year}`;
  const floorLabel = (f) => { const n = Math.trunc(num(f)); return n < 0 ? 'Υπόγειο' : n === 0 ? 'Ισόγειο' : `${n}ος`; };

  return { MONTHS, EXPENSES, ELEVATOR, ALL_EXPENSES, DEFAULT_NOTE, num, toCents, fromCents, allocate, defaultElevatorFactor, elevatorFactor, oilSummary, compute, nextMonth, rollover, euro, money, fmt, periodLabel, floorLabel, round2 };
});
