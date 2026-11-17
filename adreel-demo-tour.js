/* adreel-demo-tour.js — visite guidée de l'AdReel de démonstration de la landing (index.html?adreel=demo-fr / demo-en), 17/11.
 *
 * Même moteur que la visite du Projet de démo (layerpitch-guide.js). Ne s'active QUE sur ces deux AdReels de démo : jamais sur la page
 * d'un vrai compositeur. Page publique : la visite ne bloque rien (« Passer » à tout moment), elle se lance d'emblée la première fois
 * (mémorisé dans ce navigateur) et peut se relancer par le bouton « Visite guidée ». Étapes dont le bloc est absent : sautées.
 * Textes FR/EN ici (zone propre), les libellés des boutons (Suivant, Passer…) viennent du dictionnaire partagé.
 */
(function () {
  const q = new URLSearchParams(window.location.search);
  if (!/^demo(-|$)/.test(q.get('adreel') || '') || q.has('preview') || q.has('tuto') || !window.LayerPitchGuide) return;
  const KEY = 'layerpitch_adreel_demo_tour_seen_v1';
  const lang = (q.get('lang') || document.documentElement.lang || localStorage.getItem('layerpitch_lang') || ((q.get('adreel') || '').endsWith('-en') ? 'en' : 'fr')).slice(0, 2) === 'en' ? 'en' : 'fr';
  const T = {
    fr: {
      intro: ['Un AdReel : la page d’un compositeur', 'Voici la page de présentation d’un compositeur de jeu vidéo : tout y est jouable, rien ne se modifie. On en fait le tour.'],
      music: ['Des morceaux adaptatifs', 'Lance un morceau : ce n’est pas un simple fichier audio. La musique réagit, avec des couches d’intensité que tu peux activer et couper en direct, comme dans un jeu.'],
      branch: ['Des parcours, pas seulement des boucles', 'Certains morceaux s’enchaînent par segments ou par embranchements : en le lançant, tu vois la carte des chemins et tu choisis où la musique part ensuite.'],
      sfx: ['Les bruitages', 'Chaque bruitage se déclenche d’un clic, et peut se jouer par-dessus la musique pour juger de l’ensemble.'],
      packs: ['Les packs', 'Les morceaux et bruitages sont regroupés en packs, pour les retrouver ensemble.'],
      video: ['Une vidéo, plusieurs musiques', 'Le compositeur montre son travail en situation, sur des images de jeu. Sous le lecteur, change de version : même vidéo, autre musique.'],
      bio: ['Qui est derrière la musique', 'Une présentation du compositeur et de quoi le contacter.'],
      end: ['À toi de jouer', 'Tu as fait le tour. Reviens sur les morceaux et essaie-les à ton rythme. Pour créer ton propre AdReel, demande une invitation sur layerpitch.com.'],
      btn: 'Visite guidée',
    },
    en: {
      intro: ['An AdReel: a composer’s page', 'This is the presentation page of a game composer: everything is playable, nothing can be changed. Let’s go through it.'],
      music: ['Adaptive tracks', 'Play a track: it is not a plain audio file. The music reacts, with intensity layers you can switch on and off live, like in a game.'],
      branch: ['Paths, not just loops', 'Some tracks chain through segments or branches: once it plays, you see the map of paths and choose where the music goes next.'],
      sfx: ['Sound effects', 'Each sound effect triggers with a click, and can play over the music so you can judge the whole.'],
      packs: ['Packs', 'Tracks and sound effects are grouped into packs, to find them together.'],
      video: ['One video, several scores', 'The composer shows the work in context, on game footage. Under the player, switch version: same video, different music.'],
      bio: ['Who is behind the music', 'An introduction to the composer and how to get in touch.'],
      end: ['Your turn', 'That is the tour. Go back to the tracks and try them at your own pace. To create your own AdReel, request an invitation on layerpitch.com.'],
      btn: 'Guided tour',
    },
  }[lang];
  const I = window.LAYERPITCH_I18N || { fr: {}, en: {} };
  function tr(key, vars) {
    if (key.startsWith('adt_')) { const p = key.slice(4).split('_'); const v = T[p[0]]; return v ? v[p[1] === 'title' ? 0 : 1] : key; }
    let s = null;
    for (const l of [lang, 'fr']) { const zones = I[l] ? Object.values(I[l]) : []; for (const z of zones) { if (z && typeof z === 'object' && z[key] != null) { s = z[key]; break; } } if (s != null) break; }
    if (s == null) s = key;
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  const first = sel => () => document.querySelector(sel);
  const absent = sel => () => !document.querySelector(sel);
  const music = '.track-row-wrapper:not(.sfx-row-wrapper)';
  const G = window.LayerPitchGuide.create({ tr, textVars: () => ({}) });
  const steps = [
    { titleKey: 'adt_intro_title', textKey: 'adt_intro_text' },
    { selector: first(music), titleKey: 'adt_music_title', textKey: 'adt_music_text', skip: absent(music) },
    { selector: () => document.querySelector('.track-row-wrapper .path-map, .track-row-wrapper [class*="path"]') || document.querySelectorAll(music)[1] || null, titleKey: 'adt_branch_title', textKey: 'adt_branch_text', skip: () => document.querySelectorAll(music).length < 2 },
    { selector: first('.sfx-row-wrapper'), titleKey: 'adt_sfx_title', textKey: 'adt_sfx_text', skip: absent('.sfx-row-wrapper') },
    { selector: first('.packs-list'), titleKey: 'adt_packs_title', textKey: 'adt_packs_text', skip: absent('.packs-list') },
    { selector: first('.video-item'), titleKey: 'adt_video_title', textKey: 'adt_video_text', skip: absent('.video-item') },
    { selector: first('.bio'), titleKey: 'adt_bio_title', textKey: 'adt_bio_text', skip: absent('.bio') },
    { titleKey: 'adt_end_title', textKey: 'adt_end_text', final: true },
  ];
  const start = () => G.open('tour', steps, 'section:adreel-demo-tour');

  function addButton() {
    if (document.getElementById('lpAdreelTourBtn')) return;
    const b = document.createElement('button');
    b.id = 'lpAdreelTourBtn'; b.type = 'button'; b.textContent = T.btn;
    b.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9000;padding:8px 14px;border-radius:20px;border:1px solid #2f80c0;background:#fff;color:#2f80c0;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)';
    b.onclick = start;
    document.body.appendChild(b);
  }
  // Attend que les blocs soient dessinés et que le bandeau cookies soit réglé, puis lance la visite la première fois.
  async function boot() {
    for (let i = 0; i < 100 && !(document.querySelector('#blocksContainer .block')); i++) await new Promise(r => setTimeout(r, 150));
    addButton();
    let seen = false; try { seen = localStorage.getItem(KEY) === '1'; } catch (e) { /* stockage indisponible */ }
    if (seen) return;
    const banner = document.getElementById('cookieBanner');
    for (let i = 0; i < 400 && banner && !banner.hidden; i++) await new Promise(r => setTimeout(r, 300)); // le choix cookies d'abord (jusqu'à 2 min)
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignoré */ }
    start();
  }
  window.addEventListener('load', boot);
})();
