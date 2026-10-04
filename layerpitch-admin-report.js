// layerpitch-admin-report.js — LayerPitch, rapport des AdReels du panneau admin (4/10) : fonctions pures d'affichage et d'export
// des données de admin_adreels_report() (voir la migration 20260930060000). Aucune adresse e-mail ni contenu dans ces données.
(function (root) {
  const BASE = 'https://beta.layerpitch.com/';
  // Adresse publique d'un AdReel : principal -> /<nom>/, par son nom -> /<nom>/<adreel>, sans nom -> /<nom>/?adreel=<id>.
  function adreelUrl(handle, ar) {
    const h = encodeURIComponent(handle);
    if (ar.slug) return BASE + h + '/' + encodeURIComponent(ar.slug);
    return BASE + h + '/' + (ar.id && ar.id !== 'main' ? '?adreel=' + encodeURIComponent(ar.id) : '');
  }
  function filterRows(rows, q) {
    const needle = String(q || '').trim().toLowerCase();
    return needle ? rows.filter(r => String(r.handle || '').toLowerCase().includes(needle)) : rows.slice();
  }
  // opts : { tr(clé), fmtDate(date), esc(texte) }
  function reportHtml(rows, opts) {
    const { tr, fmtDate, esc } = opts;
    const dash = '—';
    const body = rows.map(r => {
      const reels = (r.adreels || []).map(ar => `<a href="${esc(adreelUrl(r.handle, ar))}" target="_blank" rel="noopener">${esc(ar.label || ar.id)}</a> <span class="hint">(${esc(ar.lang || '')}, ${Number(ar.tracks) || 0})</span>`).join('<br>');
      return `<tr data-handle="${esc(r.handle)}"><td><a href="${esc(BASE + encodeURIComponent(r.handle) + '/')}" target="_blank" rel="noopener">${esc(r.handle)}</a></td><td>${esc(r.plan || '')}</td>`
        + `<td>${Number(r.tracks) || 0}</td><td>${Number(r.packs) || 0}</td><td>${Number(r.collections) || 0}</td><td>${Number(r.albums) || 0}</td>`
        + `<td>${r.publishedAt ? esc(fmtDate(new Date(Number(r.publishedAt)))) : dash}</td><td>${r.lastSignInAt ? esc(fmtDate(new Date(r.lastSignInAt))) : dash}</td><td>${reels || dash}</td></tr>`;
    }).join('');
    return `<table><thead><tr><th>${esc(tr('adReelsColComposer'))}</th><th>${esc(tr('adReelsColPlan'))}</th><th>${esc(tr('adReelsColTracks'))}</th><th>${esc(tr('adReelsColPacks'))}</th><th>${esc(tr('adReelsColCollections'))}</th><th>${esc(tr('adReelsColAlbums'))}</th><th>${esc(tr('adReelsColPublished'))}</th><th>${esc(tr('adReelsColSignIn'))}</th><th>${esc(tr('adReelsColAdReels'))}</th></tr></thead><tbody>${body}</tbody></table>`;
  }
  const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  // Un compositeur par ligne ; les AdReels sont listés « nom (langue, morceaux) adresse », séparés par « | ». BOM : accents lus par Excel.
  function reportCsv(rows) {
    const head = ['handle', 'palier', 'morceaux', 'packs', 'collections', 'albums', 'derniere_publication', 'derniere_connexion', 'adreels'];
    const iso = v => (v ? new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : v).toISOString() : '');
    const lines = rows.map(r => [r.handle, r.plan, r.tracks, r.packs, r.collections, r.albums, iso(r.publishedAt), iso(r.lastSignInAt),
      (r.adreels || []).map(ar => `${ar.label || ar.id} (${ar.lang || ''}, ${Number(ar.tracks) || 0}) ${adreelUrl(r.handle, ar)}`).join(' | ')].map(csvCell).join(','));
    return '﻿' + [head.join(',')].concat(lines).join('\n');
  }
  const api = { adreelUrl, filterRows, reportHtml, reportCsv, csvCell };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LayerPitchAdminReport = api;
})(typeof window !== 'undefined' ? window : this);
