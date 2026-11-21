(function () {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const href = (p) => '/pdf/' + p.split('/').map(encodeURIComponent).join('/');
  fetch('/api/pdfs').then((r) => { if (r.status === 401) { location.replace('/login'); throw new Error(''); } return r.json(); }).then(({ files }) => {
    const el = document.getElementById('list');
    if (!files.length) { el.innerHTML = '<section><div class="empty">Δεν υπάρχουν ακόμα PDF. Φτιάχνονται από την εφαρμογή με το κουμπί «PDF».</div></section>'; return; }
    const groups = new Map();
    files.forEach((f) => { const parts = f.path.split('/'); const g = parts.slice(0, -1).join(' › ') || '—'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(f); });
    el.innerHTML = [...groups].map(([g, list]) => `<section><h2>${esc(g)}</h2>${list.map((f) => `<div class="f">
      <a class="n" href="${href(f.path)}" target="_blank" rel="noopener">${esc(f.path.split('/').pop())}</a>
      <small>${new Date(f.mtime).toLocaleDateString('el-GR')}</small>
      <a class="d" href="${href(f.path)}?dl=1">Λήψη</a></div>`).join('')}</section>`).join('');
  }).catch(() => {});
})();
