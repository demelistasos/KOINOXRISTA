(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let setup = false;
  fetch('/api/session').then((r) => r.json()).then((s) => {
    if (s.user) { location.replace('/'); return; }
    if (s.needsSetup) {
      setup = true;
      $('t').textContent = 'Καλώς ήρθες';
      $('sub').textContent = 'Πρώτη ρύθμιση: φτιάξε τον λογαριασμό σου. Τα άλλα μέλη τα προσθέτεις μετά από τις Ρυθμίσεις.';
      $('pw').autocomplete = 'new-password';
      $('pw2l').hidden = false; $('pw2').required = true;
      $('go').textContent = 'Δημιουργία λογαριασμού';
    }
    $('name').focus();
  }).catch(() => { $('err').textContent = 'Ο server δεν απαντά.'; });
  $('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('err').textContent = '';
    if (setup && $('pw').value !== $('pw2').value) { $('err').textContent = 'Οι δύο κωδικοί δεν ταιριάζουν.'; return; }
    $('go').disabled = true;
    try {
      const r = await fetch(setup ? '/api/setup' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('name').value, password: $('pw').value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Αποτυχία σύνδεσης');
      location.replace('/');
    } catch (err) { $('err').textContent = err.message; $('go').disabled = false; }
  });
})();
