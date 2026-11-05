// Carte « Connecter un assistant IA » de Mon compte (3/11) : cachée tant que le feu vert est fermé, création d'un jeton avec durée
// choisie, jeton affiché une seule fois avec le texte à coller dans l'assistant, révocation. jsdom, faux services.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const tick = () => new Promise(r => setTimeout(r, 0));
const html = fs.readFileSync(path.join(__dirname, 'mon-compte.html'), 'utf8');
const a = html.indexOf('let assistantStatus = null;'), b = html.indexOf('function identifiantsCardHtml(session)');
const block = html.slice(a, b);
check('bloc trouvé dans la page', a > 0 && b > a);
check('carte ajoutée à la rubrique Profil, avant la suppression de compte', /assistantCardHtml\(\)\) \+ \(await deletionCardHtml\(\)\)/.test(html) && /wireAssistantCard\(\)/.test(html));

const sb = { window: {} }; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'layerpitch-i18n.js'), 'utf8'), sb);
const I = sb.window.LAYERPITCH_I18N;
const keys = [...new Set([...block.matchAll(/tr\('(assistant\w+)'/g)].map(m => m[1]))].concat(['assistantErr_not_released', 'assistantErr_too_many_tokens', 'assistantErr_bad_duration']);
check('tous les textes existent en FR et EN', keys.every(k => I.fr.monCompte[k] && I.en.monCompte[k]));
check('le texte à coller contient l\'adresse du programme et le jeton, et interdit de publier', /\{url\}/.test(I.fr.monCompte.assistantPrompt) && /\{token\}/.test(I.fr.monCompte.assistantPrompt) && /Ne publie rien/.test(I.fr.monCompte.assistantPrompt) && /--dry-run/.test(I.fr.monCompte.assistantPrompt));

const TOKEN = 'lpa_' + 'cd'.repeat(32);
function page(status, createError) {
  const dom = new JSDOM('<div id="c"></div>', { runScripts: 'outside-only', url: 'http://localhost/mon-compte.html' });
  const w = dom.window, calls = { create: [], revoke: [], reload: 0 };
  w.escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  w.currentLang = () => 'fr';
  w.tr = (k, v) => { let s = I.fr.monCompte[k] || k; if (v) Object.keys(v).forEach(x => { s = s.split('{' + x + '}').join(v[x]); }); return s; };
  w.LayerPitchNotify = { confirm: async () => true };
  w.LayerPitchAuth = {
    getAssistantStatus: async () => ({ status, error: null }),
    createAssistantToken: async (label, days) => { calls.create.push([label, days]); return createError ? { token: null, error: createError } : { token: { id: 'x', token: TOKEN, prefix: TOKEN.slice(0, 12) }, error: null }; },
    revokeAssistantToken: async id => { calls.revoke.push(id); return { ok: true }; },
  };
  w.eval(block);
  w.reloadPage = () => { calls.reload++; };
  return { w, d: w.document, calls, render: async () => { w.document.getElementById('c').innerHTML = await w.assistantCardHtml(); w.wireAssistantCard(); } };
}
const open = { open: true, tokens: [
  { id: 't1', label: 'Mon Mac', prefix: 'lpa_abcdef01', created_at: '2026-11-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', last_used_at: null, revoked_at: null },
  { id: 't2', label: 'Ancien', prefix: 'lpa_11111111', created_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', last_used_at: null, revoked_at: '2026-02-01T00:00:00Z' },
], limits: { max_active_tokens: 10, token_days: 90, token_days_max: 365 } };

(async () => {
  let s = page({ open: false });
  await s.render();
  check('feu vert fermé : aucune carte', s.d.getElementById('c').innerHTML.trim() === '');

  s = page(open);
  await s.render();
  const text = s.d.body.textContent;
  check('feu vert ouvert : carte, jeton actif listé par son préfixe, jeton révoqué masqué', /Connecter un assistant IA/.test(text) && /Mon Mac/.test(text) && /lpa_abcdef01/.test(text) && !/Ancien/.test(text) && /jamais utilisé/.test(text));
  check('choix de durée : 7 / 30 / 90 jours / 1 an, 90 par défaut', [...s.d.querySelectorAll('#assistantDays option')].map(o => o.value).join() === '7,30,90,365' && s.d.getElementById('assistantDays').value === '90');
  s.d.getElementById('assistantLabel').value = 'Claude'; s.d.getElementById('assistantDays').value = '30';
  s.d.getElementById('btnCreateToken').click(); await tick(); await tick();
  check('création : nom et durée choisis envoyés', JSON.stringify(s.calls.create) === JSON.stringify([['Claude', 30]]));
  const prompt = s.d.getElementById('assistantPromptText');
  check('jeton affiché une fois dans le texte à coller, avec l\'adresse du programme', !!prompt && prompt.value.includes(TOKEN) && prompt.value.includes('http://localhost/layerpitch-cli.js'));
  check('le jeton n\'apparaît nulle part ailleurs dans la page', s.d.body.innerHTML.split(TOKEN).length - 1 <= 1 || s.d.getElementById('assistantPromptText').value.includes(TOKEN));
  s.d.querySelector('[data-revoke-token="t1"]').click(); await tick(); await tick(); await tick();
  check('révocation : appel serveur puis page rechargée', s.calls.revoke[0] === 't1' && s.calls.reload === 1);

  s = page(open, 'assistant:too_many_tokens');
  await s.render();
  s.d.getElementById('btnCreateToken').click(); await tick(); await tick();
  check('erreur du serveur : message clair, aucun jeton affiché', /maximum de jetons/.test(s.d.getElementById('assistantMsg').textContent) && !s.d.getElementById('assistantPromptText'));
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
})();
