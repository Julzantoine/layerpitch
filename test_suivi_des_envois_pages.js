// Suivi des envois (23/11) côté pages : la page d'un AdReel lit le code destinataire (#r=) AVANT de remettre l'adresse jolie
// (sinon il disparaît, même piège que ?u=), et rattache la visite juste après « page_open » ; le Backstage cache le bouton
// et l'onglet tant que le feu vert est fermé, et n'utilise aucun confirm() natif.
const fs = require('fs');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };

const index = fs.readFileSync('index.html', 'utf8');
const capture = index.indexOf('const sendCodeFromUrl');
const restore = index.indexOf('(function restorePrettyUrl()');
check('index.html : code #r= capturé', capture > 0);
check('index.html : capturé avant la remise en place de l\'adresse jolie', capture > 0 && restore > 0 && capture < restore);
check('index.html : lu dans le fragment, pas dans la requête', /const sendCodeFromUrl[\s\S]{0,120}location\.hash/.test(index));
const open = index.indexOf("'page_open'");
const reg = index.indexOf('registerSendVisit(sendCodeFromUrl');
check("index.html : visite rattachée juste après page_open, dans son propre bloc, pas en mode aperçu", open > 0 && reg > open && reg - open < 700 && /sendCodeFromUrl && !previewActive/.test(index));
check("player.js : lpDeviceType exposé aux pages (sinon page_open échoue en silence)", /window\.lpDeviceType = lpDeviceType/.test(fs.readFileSync("src/player/01-contexte-audio-ios.js", "utf8")));

const api = fs.readFileSync('api/analytics.js', 'utf8');
check('api/analytics.js : registerSendVisit exposé et muet', /registerSendVisit/.test(api) && /register_send_visit/.test(api) && /catch \(e\) \{ \/\* jamais bloquant/.test(api));

const html = fs.readFileSync('src/backstage/03-ecran-et-scripts.html', 'utf8');
check('Backstage : onglet Envois caché par défaut', /id="navItemSends" hidden/.test(html));
check('Backstage : bouton « Envoyer à… » caché par défaut', /id="btnSendAdReel"[^>]* hidden/.test(html));
const gate = fs.readFileSync('src/backstage/14-connexion-abonnement-admin.js', 'utf8');
check('Backstage : bouton et onglet suivent le feu vert sends_tracking', /flagOpen\('sends_tracking'\)/.test(gate) && /navItemSends/.test(gate) && /btnSendAdReel/.test(gate));
const js = fs.readFileSync('src/backstage/50-envois.js', 'utf8');
check('50-envois.js : lien = adresse de l\'AdReel + #r=<code>', /#r=\$\{s\.code\}/.test(js));
check('50-envois.js : AdReel à lien magique -> on ajoute &r=<code> au lien magique', /&r=\$\{s\.code\}/.test(js));
check('50-envois.js : aucun confirm() natif', !/[^.\w]confirm\(/.test(js));

console.log(failures ? `\n${failures} échec(s)` : '\nTout est OK');
process.exit(failures ? 1 : 0);
