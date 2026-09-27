// ---- Effets par couche (filtre/reverb/écho/bitcrusher) — chantier "effets dynamiques" (22/09) ----
// Réglages fixes posés par le compositeur (layer.fx dans data.json/Postgres), pas encore automatisés ni
// déclenchables en direct — ça viendra dans un second temps (cascades de triggers, cf. discussion
// produit), qui réutilisera cette même chaîne plutôt que d'en construire une autre. buildLayerFxChain
// renvoie { input, output, nodes } avec des références NOMMÉES à chaque nœud créé (nodes.lowcut, nodes.highcut,
// nodes.delay, ...) plutôt que des closures anonymes : ça ne sert à rien aujourd'hui, mais évite une
// réécriture le jour où un contrôle en direct (ex. depuis un futur Espace Projet) devra retrouver ces
// nœuds pour les piloter plutôt que reconstruire toute la chaîne.
const _impulseResponseCache = new Map();
function getOrBuildImpulseResponse(ctx, decaySeconds) {
  const decay = Math.min(Math.max(decaySeconds || 2, 0.1), 10);
  const key = ctx.sampleRate + ':' + decay;
  if (_impulseResponseCache.has(key)) return _impulseResponseCache.get(key);
  // Reverb synthétique (bruit blanc + décroissance exponentielle) plutôt qu'un fichier de réponse
  // impulsionnelle à héberger : évite d'ajouter un nouveau type d'asset/upload pour ce chantier, qualité
  // suffisante pour l'usage démo/pitch visé ici.
  // Bruit TIRÉ D'UNE GRAINE fixe (25/09) plutôt que Math.random() : même réponse à chaque chargement et dans le rendu
  // hors-ligne d'une version figée, qui retrouve ainsi exactement la reverb entendue (même texture de bruit).
  const length = Math.max(1, Math.floor(ctx.sampleRate * decay));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const rand = mulberry32((key + ':' + ch).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
    for (let i = 0; i < length; i++) data[i] = (rand() * 2 - 1) * Math.pow(1 - i / length, 2);
  }
  _impulseResponseCache.set(key, buffer);
  return buffer;
}
