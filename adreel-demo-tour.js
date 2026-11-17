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
      packs: ['Les packs', 'Regroupe des morceaux et des bruitages en packs pour les présenter de manière thématique. Tu peux aussi mettre tes packs d’assets audio en vente.'],
      video: ['La musique sur des vidéos', 'Sur un même gameplay, propose à ton auditeur plusieurs musiques différentes. Il peut passer d’une version à l’autre et reste calé.'],
      ytvideo: ['Ou ta chaîne YouTube', '…mais tu peux aussi simplement afficher les vidéos de ta chaîne YouTube.'],
      bio: ['Qui est derrière la musique', 'Ta bio, tes réseaux sociaux, ton site, des photos, de la vidéo… LayerPitch te permet d’afficher tous les types d’informations qui te permettront de convaincre un studio de bosser avec toi.'],
      end: ['À toi de jouer', 'Tu as fait le tour. Tu peux continuer d’explorer ici ou accéder au tutoriel complet. Et si ça te branche, on recrute des bêta-testeurs ;)'],
      btn: 'Visite guidée',
      bar: 'Ceci est un AdReel de démonstration : vous pouvez tout parcourir, mais rien ne se modifie ici.',
      tuto: 'Tutoriel',
      cta: 'Demander une invitation',
    },
    en: {
      intro: ['An AdReel: a composer’s page', 'This is the presentation page of a game composer: everything is playable, nothing can be changed. Let’s go through it.'],
      music: ['Adaptive tracks', 'Play a track: it is not a plain audio file. The music reacts, with intensity layers you can switch on and off live, like in a game.'],
      branch: ['Paths, not just loops', 'Some tracks chain through segments or branches: once it plays, you see the map of paths and choose where the music goes next.'],
      sfx: ['Sound effects', 'Each sound effect triggers with a click, and can play over the music so you can judge the whole.'],
      packs: ['Packs', 'Group tracks and sound effects into packs to present them by theme. You can also put your audio asset packs up for sale.'],
      video: ['Music on video', 'On the same gameplay, offer your listener several different pieces of music. They can switch from one version to another and stay in sync.'],
      ytvideo: ['Or your YouTube channel', '…but you can also simply display the videos from your YouTube channel.'],
      bio: ['Who is behind the music', 'Your bio, social networks, website, photos, video… LayerPitch lets you display every kind of information that will help convince a studio to work with you.'],
      end: ['Your turn', 'That is the tour. You can keep exploring here or go through the full tutorial. And if you are up for it, we are recruiting beta testers ;)'],
      btn: 'Guided tour',
      bar: 'This is a demo AdReel: you can browse everything, but nothing can be changed here.',
      tuto: 'Tutorial',
      cta: 'Request an invitation',
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
    { selector: () => document.querySelectorAll('.video-item')[1] || null, titleKey: 'adt_ytvideo_title', textKey: 'adt_ytvideo_text', skip: () => document.querySelectorAll('.video-item').length < 2 },
    { selector: first('.bio'), titleKey: 'adt_bio_title', textKey: 'adt_bio_text', skip: absent('.bio') },
    { titleKey: 'adt_end_title', textKey: 'adt_end_text', final: true },
  ];
  const start = () => G.open('tour', steps, 'section:adreel-demo-tour');

  // Même barre que le Projet de démonstration : texte, « Visite guidée » et « Demander une invitation », en haut de la page.
  function addButton() {
    if (document.getElementById('lpAdreelDemoBar')) return;
    const bar = document.createElement('div');
    bar.id = 'lpAdreelDemoBar';
    bar.style.cssText = 'position:sticky;top:0;z-index:9000;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;margin:8px;padding:10px 14px;border-radius:10px;border:1px solid #2f80c0;background:#e6eef8;color:#1c2733;font:13px system-ui,sans-serif;';
    const msg = document.createElement('span'); msg.textContent = T.bar;
    const box = document.createElement('span'); box.style.cssText = 'display:inline-flex;gap:8px;flex-wrap:wrap;';
    const b = document.createElement('button');
    b.id = 'lpAdreelTourBtn'; b.type = 'button'; b.textContent = T.btn;
    b.style.cssText = 'padding:6px 14px;border-radius:20px;border:1px solid #d5dbe3;background:#fff;color:#1c2733;font:600 12px system-ui,sans-serif;cursor:pointer;';
    b.onclick = start;
    // Bouton « Tutoriel » : la page « Tous les tutoriels », dans un nouvel onglet.
    const t = document.createElement('a');
    t.href = './tutoriels.html?lang=' + lang; t.target = '_blank'; t.rel = 'noopener'; t.textContent = T.tuto;
    t.style.cssText = b.style.cssText + 'text-decoration:none;display:inline-block;';
    const a = document.createElement('a');
    a.href = 'https://layerpitch.com/'; a.textContent = T.cta;
    a.style.cssText = 'padding:6px 14px;border-radius:20px;background:#2f80c0;color:#fff;font:600 12px system-ui,sans-serif;text-decoration:none;';
    box.append(b, t, a); bar.append(msg, box);
    document.body.insertBefore(bar, document.body.firstChild);
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
