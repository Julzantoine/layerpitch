// Cloche et bandeau d'arrivée avec une annonce longue (8/10) : le bandeau ne montre que le début, le message complet
// reste dans la cloche (clic pour l'ouvrir), les adresses y sont cliquables ; le bandeau défile et garde sa croix.
const fs = require('fs');
const path = require('path');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; };
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const shell = read('layerpitch-shell.js');
const grab = (src, re) => { const m = re.exec(src); if (!m) throw new Error('introuvable : ' + re); return m[0]; };

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toastExcerpt = eval('(' + grab(shell, /function toastExcerpt\(text, max\) \{[\s\S]*?\n  \}/).replace(/^function toastExcerpt/, 'function') + ')');
const linkify = eval('(' + grab(shell, /function linkify\(t\) \{[^\n]*\}/).replace(/^function linkify/, 'function') + ')');

const long = 'Bonjour à toutes et à tous, ' + 'voici un très long message sur les modes de lecture. '.repeat(30);
const ex = toastExcerpt(long);
check('bandeau : début du message conservé', ex.startsWith('Bonjour à toutes et à tous,'));
check('bandeau : texte long raccourci (≤ 121 caractères) et marqué « … »', ex.length <= 121 && ex.endsWith('…'));
check('bandeau : texte court inchangé', toastExcerpt('Salut  tout   le monde') === 'Salut tout le monde');
check('cloche : adresse http(s) rendue cliquable', linkify('Démo : https://youtu.be/abc123.').includes('<a href="https://youtu.be/abc123" target="_blank" rel="noopener">https://youtu.be/abc123</a>.'));
check('cloche : aucune balise du message n\'est interprétée', !linkify('<img src=x onerror=1>').includes('<img'));
check('bandeau : défile si trop haut (max-height + overflow)', /\.lp-toast-msg \{[^}]*max-height: 60vh;[^}]*overflow-y: auto/.test(read('layerpitch-notify.js')));
check('bandeau : garde sa croix de fermeture', /close\.className = 'lp-toast-close'/.test(read('layerpitch-notify.js')));
check('cloche commune : clic sur un message = ouvrir/fermer (hors lien)', /div\.lp-bell-item/.test(shell) && /classList\.toggle\('expanded'\)/.test(shell));
check('cloche du Backstage : clic sur un message = ouvrir/fermer', /const onItem = /.test(read('src/backstage/14-connexion-abonnement-admin.js')));

// Carte « nouvelle notification » sous la cloche : vrai module dans un navigateur simulé.
(async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html lang="fr"><body><button id="btnInboxBell" style="position:absolute;right:20px;top:10px">cloche</button></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(read('layerpitch-notify.js'));
  let opened = 0;
  w.LayerPitchNotify.inbox({ title: 'LayerPitch 101', text: 'Bonjour à toutes et à tous', anchor: '#btnInboxBell, #lpBell', onClick: () => opened++ });
  const card = () => w.document.querySelector('.lp-inbox-card');
  check('carte : affichée avec titre et début du texte', !!card() && card().textContent.includes('LayerPitch 101') && card().textContent.includes('Bonjour à toutes'));
  w.LayerPitchNotify.inbox({ title: 'Deuxième', anchor: '#btnInboxBell' });
  check('carte : une seule à la fois (la nouvelle remplace l\'ancienne)', w.document.querySelectorAll('.lp-inbox-card').length === 1 && card().textContent.includes('Deuxième'));
  w.LayerPitchNotify.inbox({ title: 'Cliquable', onClick: () => opened++ });
  card().click();
  check('carte : un clic appelle l\'action (ouvrir la cloche)', opened === 1);
  w.LayerPitchNotify.inbox({ title: 'Avec croix', onClick: () => opened++ });
  card().querySelector('.lp-inbox-card-close').click();
  check('carte : la croix ferme sans ouvrir la cloche', opened === 1);
  check('carte : le bandeau classique n\'a pas changé (toast.info existe)', typeof w.LayerPitchNotify.info === 'function');
  check('cloche : la carte est branchée à l\'arrivée d\'un message', /LayerPitchNotify\.inbox\(\{/.test(shell) && /function openBell\(\)/.test(shell));
  check('seules les annonces ouvrent la carte (messages de contact, Projets, invitations : cloche seulement)', /kind === 'announcement' && it\.unread && !inbox\.known\.has\(it\.key\)/.test(shell) && !/inboxToastProject/.test(grab(shell, /const fresh = [\s\S]*?inbox\.known = new Set/)));
  process.exit(failures ? 1 : 0);
})();
