const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/calc.js');

const apts = [
  { id: 'a', code: 'Α1', owner: 'Παπαδόπουλος', floor: 1, sqm: 85 },
  { id: 'b', code: 'Β1', owner: 'Νικολάου', floor: 2, sqm: 95 },
  { id: 'c', code: 'Γ1', owner: 'Γεωργίου', floor: 3, sqm: 70 },
  { id: 'd', code: 'Ι1', owner: 'Δημητρίου', floor: 0, sqm: 60 }
];
const period = {
  year: 2026, month: 10, fixedPercent: 20,
  oil: { startLiters: 500, startPrice: 1.2, endLiters: 300, purchases: [{ liters: 1000, price: 1.1 }] },
  expenses: { dei: '45,30', water: '12', elevator: '80', cleaning: '60', management: '30', extra: '0,01' },
  rows: {
    a: { prevUnits: 100, currUnits: 160, prevBalance: '10,50', payment: '' },
    b: { prevUnits: 200, currUnits: 290 },
    c: { prevUnits: 50, currUnits: 50 },
    d: { prevUnits: 10, currUnits: 30, payment: 20 }
  }
};

test('parses Greek and dotted numbers', () => {
  assert.strictEqual(C.num('1.234,56'), 1234.56);
  assert.strictEqual(C.num('12.5'), 12.5);
  assert.strictEqual(C.num('45,30 €'), 45.3);
  assert.strictEqual(C.num(''), 0);
  assert.strictEqual(C.num('abc'), 0);
});

test('allocation sums exactly', () => {
  for (let t = 0; t < 200; t++) {
    const total = Math.floor(Math.random() * 100000);
    const w = Array.from({ length: 1 + Math.floor(Math.random() * 12) }, () => Math.random() * 100);
    assert.strictEqual(C.allocate(total, w).reduce((a, b) => a + b, 0), total);
  }
  assert.deepStrictEqual(C.allocate(-101, [1, 1]), [-51, -50]);
});

test('every expense is fully distributed to the cent', () => {
  const r = C.compute(apts, period, {});
  const t = r.totals;
  assert.strictEqual(t.general + t.elevator, t.expensesSum);
  assert.strictEqual(t.heating, t.oilCost);
  assert.strictEqual(Math.round(t.mils), 1000);
  assert.strictEqual(Math.round(t.elevMils), 1000);
  assert.strictEqual(t.total, t.charges + t.prevBalance);
});

test('oil uses weighted average price of stock + purchases', () => {
  const o = C.oilSummary(period.oil);
  assert.strictEqual(o.consumedL, 1200);
  const avg = (500 * 1.2 + 1000 * 1.1) / 1500;
  assert.ok(Math.abs(o.avgPrice - avg) < 1e-9);
  assert.strictEqual(o.costCents, Math.round(1200 * avg * 100));
});

test('matches the original Swift formulas (before rounding)', () => {
  const r = C.compute(apts, period, {});
  const totalSqm = 310;
  const mil = (a) => a.sqm / totalSqm * 1000;
  const factors = { 0: 0, 1: 1, 2: 1.1, 3: 1.2 };
  const pts = apts.reduce((s, a) => s + mil(a) * factors[a.floor], 0);
  const oilCost = r.totals.oilCost / 100;
  const units = { a: 60, b: 90, c: 0, d: 20 };
  const wsum = apts.reduce((s, a) => s + mil(a) * units[a.id], 0);
  apts.forEach((a, i) => {
    const x = r.results[i];
    const general = (45.3 + 12 + 60 + 30 + 0.01) * mil(a) / 1000;
    const elev = 80 * (mil(a) * factors[a.floor] / pts);
    const fixed = oilCost * 0.2 * mil(a) / 1000;
    const variable = oilCost * 0.8 * mil(a) * units[a.id] / wsum;
    assert.ok(Math.abs(x.general / 100 - general) <= 0.011, 'general ' + a.id);
    assert.ok(Math.abs(x.elevator / 100 - elev) <= 0.011, 'elevator ' + a.id);
    assert.ok(Math.abs(x.heatingFixed / 100 - fixed) <= 0.011, 'fixed ' + a.id);
    assert.ok(Math.abs(x.heatingVariable / 100 - variable) <= 0.011, 'variable ' + a.id);
  });
});

test('elevator factors continue above the 6th floor', () => {
  assert.strictEqual(C.defaultElevatorFactor(6), 1.5);
  assert.strictEqual(C.defaultElevatorFactor(7), 1.6);
  assert.strictEqual(C.defaultElevatorFactor(0), 0);
  assert.strictEqual(C.defaultElevatorFactor(-1), 0);
  assert.strictEqual(C.elevatorFactor(2, { 2: '1,3' }), 1.3);
});

test('no usage recorded: variable heating falls back to mils', () => {
  const p = JSON.parse(JSON.stringify(period));
  Object.values(p.rows).forEach((r) => { r.currUnits = r.prevUnits; });
  const r = C.compute(apts, p, {});
  assert.ok(r.variableFallback);
  assert.strictEqual(r.totals.heating, r.totals.oilCost);
});

test('rollover carries readings, balances, stock and average price', () => {
  const r = C.compute(apts, period, {});
  let n = 0;
  const next = C.rollover(period, r, ['management'], () => 'id' + (++n));
  assert.strictEqual(next.month, 11);
  assert.strictEqual(C.num(next.oil.startLiters), 300);
  assert.ok(Math.abs(C.num(next.oil.startPrice) - r.oil.avgPrice) < 1e-4);
  assert.strictEqual(C.num(next.rows.a.prevUnits), 160);
  assert.strictEqual(C.toCents(next.rows.a.prevBalance), r.results[0].newBalance);
  assert.strictEqual(C.toCents(next.rows.d.prevBalance), r.results[3].newBalance);
  assert.ok(!String(next.oil.startPrice).includes('.'));
  assert.deepStrictEqual(next.expenses, { management: '30' });
  const dec = C.rollover({ ...period, month: 11 }, r, [], () => 'x');
  assert.deepStrictEqual([dec.year, dec.month], [2027, 0]);
});

test('apartments excluded from heating or elevator pay nothing for them', () => {
  const a2 = apts.map((a) => (a.id === 'd' ? { ...a, noHeating: true, noElevator: true, floor: 4 } : a));
  const r = C.compute(a2, period, {});
  const d = r.results[3];
  assert.strictEqual(d.heating, 0);
  assert.strictEqual(d.elevator, 0);
  assert.strictEqual(r.totals.heating, r.totals.oilCost);
});

test('manual debt adjustment (credit) enters total and carries via newBalance', () => {
  const p = JSON.parse(JSON.stringify(period));
  p.rows.c.adjust = '-25,40'; p.rows.c.adjustNote = 'Διόρθωση ΔΕΗ';
  const r = C.compute(apts, p, {});
  const c = r.results[2];
  assert.strictEqual(c.adjust, -2540);
  assert.strictEqual(c.total, c.charges + c.prevBalance - 2540);
  assert.strictEqual(r.totals.total, r.totals.charges + r.totals.prevBalance + r.totals.adjust);
  const next = C.rollover(p, r, [], () => 'id');
  assert.strictEqual(C.toCents(next.rows.c.prevBalance), c.newBalance);
  assert.strictEqual(next.rows.c.adjust, undefined);
});

test('shared heat meter: usage split equally, readings from the main apartment', () => {
  const a2 = apts.map((a) => (a.id === 'd' ? { ...a, meterWith: 'c' } : a));
  const p = JSON.parse(JSON.stringify(period));
  p.rows.c = { prevUnits: 100, currUnits: 130 };
  p.rows.d = { prevUnits: 0, currUnits: '' };
  const r = C.compute(a2, p, {});
  const c = r.results[2], d = r.results[3];
  assert.strictEqual(c.units, 15); assert.strictEqual(d.units, 15);
  assert.strictEqual(d.prevUnits, 100); assert.strictEqual(d.currUnits, 130);
  assert.strictEqual(c.shareN, 2);
  assert.strictEqual(r.totals.heating, r.totals.oilCost);
  assert.ok(!r.warnings.some((w) => w.includes(d.apt.code)));
});

test('shared meter switched off: each apartment uses its own readings again', () => {
  const a2 = apts.map((a) => (a.id === 'd' ? { ...a, meterWith: 'c', meterShared: false } : a));
  const p = JSON.parse(JSON.stringify(period));
  p.rows.c = { prevUnits: 100, currUnits: 130 };
  p.rows.d = { prevUnits: 10, currUnits: 14 };
  const r = C.compute(a2, p, {});
  assert.strictEqual(r.results[2].units, 30); assert.strictEqual(r.results[3].units, 4);
});
