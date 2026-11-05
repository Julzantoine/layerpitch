// Aperçus « Ce qu’on va construire » (02/11) : un schéma du résultat final, dans la 2e bulle de chaque leçon (juste après l’accueil).
// Partagé par le Backstage (src/backstage/43-visite-guidee.js) et les pages Projet (projet-lecons.js). Validés par Jules-Antoine sur une
// page d’aperçus le 02/11 : un rectangle gris par variante, sous chaque nom de section seulement le mode de lecture.
// Les textes viennent de layerpitch-i18n.js (zone `shared`, clés gl…) via le tr() de la page. La carte de la leçon hybride reste dans
// 43-visite-guidee.js (lhMapPreviewHtml).
(function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CARD = 'var(--bg-card, var(--bg))', OFF = 'var(--border)', WARM = '#c98a2b';

  // Briques de dessin (mêmes formes que la carte des chemins).
  const box = (x, y, w, h, label, sub, o = {}) => {
    const lines = String(label).split('\n');
    const ty = y + h / 2 - (lines.length - 1) * 5.5 + (sub ? -4 : 3);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${o.fill || CARD}" stroke="${o.stroke || 'var(--accent)'}" stroke-width="1.2"/>`
      + lines.map((l, k) => `<text x="${x + w / 2}" y="${ty + k * 11}" text-anchor="middle" font-size="${o.fs || 9}" fill="${o.tc || 'var(--text)'}"${o.bold ? ' font-weight="600"' : ''}>${esc(l)}</text>`).join('')
      + (sub ? `<text x="${x + w / 2}" y="${y + h - 6}" text-anchor="middle" font-size="7.5" fill="var(--text-dim)">${esc(sub)}</text>` : '');
  };
  const curve = (x1, y1, x2, y2, o = {}) => `<path d="M${x1} ${y1} C${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}" fill="none" stroke="${o.c || 'var(--border)'}" stroke-width="${o.w || 1.4}"${o.arrow ? ' marker-end="url(#lpvArrow)"' : ''}/>`;
  const line = (x1, y1, x2, y2, o = {}) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.c || 'var(--border)'}" stroke-width="${o.w || 1.4}"${o.dash ? ' stroke-dasharray="3 3"' : ''}${o.arrow ? ' marker-end="url(#lpvArrow)"' : ''}/>`;
  const txt = (x, y, s, o = {}) => `<text x="${x}" y="${y}" text-anchor="${o.a || 'middle'}" font-size="${o.fs || 8}" fill="${o.c || 'var(--text-dim)'}"${o.bold ? ' font-weight="600"' : ''}>${esc(s)}</text>`;
  const rect = (x, y, w, h, fill, o = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r == null ? 3 : o.r}" fill="${fill}"${o.stroke ? ` stroke="${o.stroke}"` : ''}/>`;
  const wave = (x, y, w, h, seed = 1, color = 'var(--accent)', step = 4) => {
    let s = '', r = seed;
    for (let i = 0; i < w; i += step) { r = (r * 9301 + 49297) % 233280; const a = (0.25 + 0.75 * r / 233280) * h / 2; s += `<line x1="${x + i}" y1="${y + h / 2 - a}" x2="${x + i}" y2="${y + h / 2 + a}" stroke="${color}" stroke-width="1.6" stroke-linecap="round" opacity=".75"/>`; }
    return s;
  };
  const page = (x, y, w, h, title) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${CARD}" stroke="var(--border)" stroke-width="1.2"/>`
    + `<rect x="${x}" y="${y}" width="${w}" height="14" rx="6" fill="var(--accent-soft)"/><rect x="${x}" y="${y + 8}" width="${w}" height="6" fill="var(--accent-soft)"/>`
    + `<circle cx="${x + 8}" cy="${y + 7}" r="2" fill="var(--border)"/><circle cx="${x + 15}" cy="${y + 7}" r="2" fill="var(--border)"/>`
    + (title ? txt(x + w / 2, y + 10, title, { fs: 7 }) : '');
  const block = (x, y, w, h, label, o = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${o.fill || 'var(--accent-soft)'}" stroke="${o.stroke || 'none'}"/>` + (label ? txt(x + (o.left ? 6 : w / 2), y + h / 2 + 3, label, { fs: o.fs || 7.5, c: 'var(--text)', a: o.left ? 'start' : 'middle' }) : '');
  const play = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="6" fill="var(--accent)"/><path d="M${cx - 2} ${cy - 3} L${cx + 3} ${cy} L${cx - 2} ${cy + 3} Z" fill="${CARD}"/>`;
  const svg = (h, body) => `<svg class="tour-map-preview" viewBox="0 0 400 ${h}" role="img"><defs><marker id="lpvArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--text-dim)"/></marker></defs>${body}</svg>`;
  const T = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${CARD}" stroke="${WARM}"/>` + txt(x + w / 2, y + h / 2 + 3, 'T', { c: WARM, fs: 8, bold: true });

  const CITIES = ['Jazz City', 'Rock City', 'Disco City', 'Synth City'];
  // Carte de niveau de « Music City » : Jazz City (départ) → Rock City (carrefour) → Disco City (niveau 2) / Synth City.
  const mapSvg = (t, o) => {
    const P = { jazz: [30, 66], rock: [160, 66], disco: [290, 24], synth: [290, 112] }, W = 84, H = 32;
    const c = (k, side) => [P[k][0] + (side ? W : 0), P[k][1] + H / 2];
    const edge = (a, b, on) => { const [x1, y1] = c(a, 1), [x2, y2] = c(b, 0); return curve(x1, y1, x2, y2, { c: on ? 'var(--accent)' : 'var(--text-dim)', w: on ? 3 : 1.6 }); };
    let b = rect(10, 8, 380, 150, 'var(--accent-soft)', { r: 8 });
    b += edge('jazz', 'rock', o.walk) + edge('rock', 'disco', o.walk) + edge('rock', 'synth', false);
    [['jazz', 'Jazz City'], ['rock', 'Rock City'], ['disco', 'Disco City'], ['synth', 'Synth City']].forEach(([k, n]) => {
      const here = o.walk && k === 'disco';
      b += box(P[k][0], P[k][1], W, H, (o.music ? '♪ ' : '') + n, '', { fs: 8.5, fill: here ? 'var(--accent)' : CARD, tc: here ? CARD : '', bold: here });
    });
    b += txt(P.jazz[0] + W / 2, P.jazz[1] - 6, t('glMapStart'), { c: 'var(--accent)', bold: true });
    if (o.note) b += txt(P.disco[0] + W / 2, P.disco[1] + H + 10, t('glMapLevel2'), { fs: 7 });
    if (o.transition) b += T(232, 90, 22, 14);
    b += txt(200, 172, t(o.walk ? 'glMapWalkLegend' : o.music ? 'glMapMusicLegend' : 'glTransLegendMap'));
    return svg(180, b);
  };
  // Un dessin par leçon ; t = tr() de la page.
  const DRAW = {
    static: t => svg(150,
      rect(20, 40, 360, 56, 'var(--accent-soft)', { r: 5 }) + wave(26, 44, 348, 48, 3)
      + rect(70, 40, 250, 56, 'none', { stroke: 'var(--accent)' })
      + line(70, 28, 70, 104, { c: 'var(--accent)', w: 2 }) + line(320, 28, 320, 104, { c: WARM, w: 2 })
      + txt(70, 22, t('glIn'), { c: 'var(--accent)', bold: true }) + txt(320, 22, t('glOut'), { c: WARM, bold: true })
      + `<path d="M318 112 C 300 136, 90 136, 72 112" fill="none" stroke="var(--accent)" stroke-width="1.5" marker-end="url(#lpvArrow)"/>`
      + txt(195, 146, t('glStaticLoop')) + txt(45, 112, t('glIntroLow')) + txt(350, 112, t('glTail'))),
    embranchement: t => svg(150,
      txt(14, 44, 'Jazz Lo', { a: 'start', c: 'var(--text)', fs: 9 }) + rect(70, 28, 310, 28, 'var(--accent-soft)', { r: 4 }) + wave(74, 30, 302, 24, 5)
      + txt(14, 100, 'Jazz Hi', { a: 'start', c: 'var(--text)', fs: 9 }) + rect(70, 84, 310, 28, 'var(--accent-soft)', { r: 4 }) + wave(74, 86, 302, 24, 11)
      + [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => line(70 + i * 38.75, 22, 70 + i * 38.75, 118, { w: 0.8, dash: true })).join('')
      + `<path d="M186 58 L186 82" stroke="var(--accent)" stroke-width="2" marker-end="url(#lpvArrow)"/><path d="M302 82 L302 58" stroke="var(--accent)" stroke-width="2" marker-end="url(#lpvArrow)"/>`
      + txt(225, 140, t('glEmbrSwitch'))),
    additive: t => svg(160,
      [[t('glBass'), 1, 3], [t('glDrums'), 1, 7], [t('glKeys'), 0, 13]].map(([nm, on, sd], i) => {
        const y = 18 + i * 40;
        return rect(14, y + 4, 64, 22, on ? 'var(--accent)' : OFF, { r: 11 }) + txt(46, y + 18, nm, { c: on ? CARD : 'var(--text)', fs: 8 })
          + rect(90, y, 290, 30, on ? 'var(--accent-soft)' : 'none', { r: 4, stroke: 'var(--border)' }) + wave(94, y + 2, 282, 26, sd, on ? 'var(--accent)' : OFF);
      }).join('')
      + rect(90, 140, 290, 4, OFF, { r: 2 }) + rect(90, 140, 190, 4, 'var(--accent)', { r: 2 }) + `<circle cx="280" cy="142" r="6" fill="var(--accent)"/>` + txt(46, 145, t('glOrSlider'))),
    // Un rectangle gris par variante ; en bleu, celle que le pool a tirée pour ce tour.
    random: t => {
      const pools = [[t('glBass'), 6, 2, false], [t('glDrums'), 3, 0, false], [t('glKeys'), 6, 4, true]];
      let b = box(6, 56, 50, 40, 'Intro', t('glOnce')) + line(56, 76, 70, 76, { arrow: true });
      b += `<rect x="74" y="16" width="320" height="120" rx="6" fill="none" stroke="var(--accent)" stroke-width="1.2"/>` + txt(234, 10, t('glRandLoop'), { c: 'var(--text)' });
      pools.forEach(([nm, n, pick, silence], i) => {
        const y = 28 + i * 36;
        b += txt(84, y + 15, nm, { a: 'start', c: 'var(--text)', fs: 9, bold: true });
        for (let k = 0; k < n; k++) b += rect(140 + k * 36, y + 4, 30, 16, k === pick ? 'var(--accent)' : OFF);
        if (silence) b += `<rect x="${140 + n * 36}" y="${y + 4}" width="30" height="16" rx="3" fill="none" stroke="var(--text-dim)" stroke-dasharray="3 2"/>` + txt(155 + n * 36, y + 31, t('glSilence'), { fs: 7 });
      });
      b += rect(140, 148, 14, 10, OFF, { r: 2 }) + txt(160, 156, t('glOneVariant'), { a: 'start' })
        + rect(232, 148, 14, 10, 'var(--accent)', { r: 2 }) + txt(252, 156, t('glPicked'), { a: 'start' })
        + txt(234, 178, t('glRandEach'));
      return svg(186, b);
    },
    sequential: t => svg(160,
      box(4, 20, 50, 36, 'Intro', t('glTwoBeats'))
      + [1, 2, 3, 4].map(n => box(66 + (n - 1) * 66, 20, 56, 36, t('glSeg', { n }), '', { fs: 8.5 })).join('')
      + box(334, 20, 60, 36, 'Outro', t('glFourBars'))
      + [55, 123, 189, 255, 321].map(x => line(x, 38, x + 9, 38, { arrow: true })).join('')
      + [0, 1].map(i => [0, 1, 2, 3].map(k => block(66 + i * 66, 62 + k * 14, 56, 11, t('glVariantN', { n: `${i + 1}.${k + 1}` }), { fill: OFF, fs: 7 })).join('')).join('')
      + txt(160, 130, t('glSeqVariant')) + txt(200, 152, t('glSeqAdvance'))),
    branching: t => svg(170,
      box(150, 66, 84, 38, 'Rock City', t('glCrossroads'), { fill: 'var(--accent-soft)' })
      + [['Jazz City', 10], ['Disco City', 66], ['Synth City', 122]].map(([v, y]) => box(310, y, 80, 34, v)).join('')
      + box(10, 66, 80, 38, 'Intro', '') + line(90, 85, 148, 85, { arrow: true })
      + [27, 83, 139].map(y => curve(234, 85, 308, y + 17, { arrow: true }) + T(260, (85 + y + 17) / 2 - 7, 22, 14)).join('')
      + txt(200, 164, t('glTransLegend'))),
    sfx: t => svg(190,
      `<circle cx="200" cy="95" r="62" fill="none" stroke="var(--border)" stroke-dasharray="3 4"/><circle cx="200" cy="95" r="16" fill="var(--accent-soft)" stroke="var(--accent)"/>` + txt(200, 98, t('glYou'), { c: 'var(--text)' })
      + box(40, 30, 92, 30, t('glIce'), t('glCopies', { n: 3 }), { fs: 8.5 }) + box(272, 30, 92, 30, t('glGlass'), t('glCopies', { n: 2 }), { fs: 8.5 })
      + box(140, 156, 120, 28, t('glBarAmb'), t('glMoves'), { fs: 8.5 })
      + line(130, 55, 158, 74, { c: 'var(--accent)' }) + line(272, 55, 244, 74, { c: 'var(--accent)' })
      + `<path d="M150 150 C 120 110, 280 110, 252 150" fill="none" stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="4 3" marker-end="url(#lpvArrow)"/>`
      + txt(200, 16, t('glFront')) + txt(110, 100, t('glLeft')) + txt(290, 100, t('glRight'))),
    events: t => svg(160,
      rect(20, 64, 360, 32, 'var(--accent-soft)', { r: 4 }) + wave(24, 66, 352, 28, 17)
      + box(20, 10, 170, 34, t('glEvBand'), '', { fs: 8.5, fill: 'var(--accent-soft)' }) + box(210, 10, 170, 34, t('glEvRadio'), '', { fs: 8.5, fill: 'var(--accent-soft)' })
      + line(105, 44, 105, 62, { arrow: true }) + line(295, 44, 295, 62, { arrow: true })
      + ['Volume −8 dB', t('glPanLeft'), 'Reverb'].map((f, i) => block(20 + i * 58, 110, 54, 20, f, { fs: 7 })).join('')
      + ['CutOff', 'Bitcrusher', 'Volume'].map((f, i) => block(210 + i * 58, 110, 54, 20, f, { fs: 7 })).join('')
      + txt(200, 150, t('glEvSame'))),
    'adreel-intro': t => svg(200, page(110, 4, 180, 192, 'layerpitch.com/daniel')
      + [[t('glBkHeader'), 22], ['Bio', 18], [t('glBkTracks') + ' ▶', 30], [t('glBkVideo'), 24], [t('glBkText'), 16], [t('glBkTesti'), 18], ['Contact', 16]]
        .reduce((acc, [l, h]) => { acc.s += block(120, acc.y, 160, h, l); acc.y += h + 4; return acc; }, { s: '', y: 24 }).s),
    adreel: t => svg(200, page(80, 4, 240, 192, t('glMcPitch'))
      + block(92, 24, 216, 28, t('glFromMain')) + block(92, 58, 216, 26, t('glForJoshua'), { fill: CARD, stroke: 'var(--border)' })
      + ['Rock City', 'Disco City', 'Jazz City', 'Synth City'].map((c, i) => rect(92, 92 + i * 24, 216, 20, 'var(--accent-soft)') + play(104, 102 + i * 24) + txt(116, 105 + i * 24, c, { a: 'start', c: 'var(--text)' }) + wave(200, 94 + i * 24, 100, 16, i + 2, 'var(--accent)', 5)).join('')),
    appearance: t => svg(190, page(14, 10, 160, 170, t('glBefore'))
      + [30, 70, 104, 138].map((y, i) => block(24, y, 140, i ? 28 : 34, [t('glBkHeader'), 'Bio', t('glBkTracks'), 'Contact'][i], { fill: OFF })).join('')
      + line(184, 95, 212, 95, { arrow: true, w: 2 })
      + `<rect x="226" y="10" width="160" height="170" rx="6" fill="#1b2a3a" stroke="var(--border)"/>`
      + `<rect x="236" y="30" width="140" height="34" rx="3" fill="#24425f"/><text x="306" y="51" text-anchor="middle" font-size="9" fill="#5fd6e6" font-weight="600">${esc(t('glBkHeader'))}</text>`
      + `<line x1="246" y1="69" x2="366" y2="69" stroke="#5fd6e6" stroke-width=".8" stroke-dasharray="2 3"/>`
      + `<rect x="236" y="74" width="140" height="26" rx="3" fill="#24425f"/><text x="306" y="91" text-anchor="middle" font-size="8" fill="#5fd6e6">Bio</text>`
      + `<rect x="232" y="106" width="148" height="30" rx="3" fill="#2f80c0" stroke="#5fd6e6"/><text x="306" y="124" text-anchor="middle" font-size="8" fill="#fff">${esc(t('glHighlighted'))}</text>`
      + `<rect x="236" y="142" width="140" height="28" rx="3" fill="#24425f"/><text x="306" y="160" text-anchor="middle" font-size="8" fill="#5fd6e6">Contact</text>`),
    share: t => svg(170,
      `<rect x="40" y="16" width="320" height="34" rx="17" fill="var(--accent-soft)" stroke="var(--accent)"/>` + txt(200, 37, 'layerpitch.com/daniel/music-city', { c: 'var(--text)', fs: 10, bold: true })
      + [['FR · EN', t('glLanguage')], ['Google', t('glIndexed')], [t('glPassword'), t('glPrivate')]].map(([a, b], i) => box(40 + i * 112, 80, 96, 46, a, b, { fs: 9 })).join('')
      + [88, 200, 312].map(x => line(x, 52, x, 78)).join('')
      + txt(200, 152, t('glOldLinks'))),
    tracking: t => svg(180,
      [['12', t('glVisits')], ['4 min', t('glAvgTime')], ['3', t('glTracksN')]].map(([a, b], i) => rect(14 + i * 66, 12, 58, 40, 'var(--accent-soft)', { r: 5 }) + txt(43 + i * 66, 32, a, { c: 'var(--text)', fs: 12, bold: true }) + txt(43 + i * 66, 45, b, { fs: 7 })).join('')
      + `<polyline points="14,150 50,138 86,142 122,110 158,118 194,84" fill="none" stroke="var(--accent)" stroke-width="2"/>` + line(14, 160, 200, 160, { w: 1 }) + `<circle cx="194" cy="84" r="3" fill="var(--accent)"/>`
      + rect(218, 12, 170, 158, 'none', { stroke: 'var(--border)', r: 5 })
      + [[t('glTrkJoshua'), true], ['Rock City · 2:10', false], ['Jazz City · 1:05', false], [t('glTrkSlider'), false], [t('glTrkStudio'), true], ['Synth City · 0:40', false]]
        .map(([l, h], i) => txt(h ? 228 : 238, 32 + i * 24, l, { a: 'start', c: h ? 'var(--text)' : 'var(--text-dim)', bold: h })).join('')),
    pack: t => svg(190, page(70, 6, 260, 178, t('glPack8'))
      + rect(82, 26, 80, 80, 'var(--accent-soft)', { r: 4 }) + [0, 1, 2, 3].map(i => [0, 1, 2, 3].map(j => (i + j) % 2 ? `<rect x="${90 + i * 16}" y="${34 + j * 16}" width="16" height="16" fill="var(--accent)" opacity=".5"/>` : '').join('')).join('')
      + txt(174, 40, t('glPack8'), { a: 'start', c: 'var(--text)', fs: 11, bold: true }) + txt(174, 54, t('glPackSub'), { a: 'start' })
      + rect(174, 80, 64, 24, 'var(--accent)', { r: 12 }) + txt(206, 96, t('glPrice'), { c: CARD, fs: 10, bold: true })
      + ['Level 1', 'Boss', 'Game Over'].map((n, i) => rect(82, 116 + i * 22, 236, 18, 'var(--accent-soft)') + play(94, 125 + i * 22) + txt(106, 128 + i * 22, n, { a: 'start', c: 'var(--text)' })).join('')),
    embed: t => svg(170, page(110, 8, 270, 156, t('glMySite'))
      + block(122, 28, 120, 10, '', { fill: OFF }) + block(122, 44, 240, 6, '', { fill: OFF }) + block(122, 54, 200, 6, '', { fill: OFF })
      + `<rect x="122" y="72" width="246" height="76" rx="5" fill="${CARD}" stroke="var(--accent)" stroke-width="1.6"/>` + play(140, 92) + txt(154, 95, t('glPack8') + ' · Level 1', { a: 'start', c: 'var(--text)' }) + wave(132, 108, 226, 30, 4)
      + rect(10, 62, 76, 40, 'var(--accent-soft)', { r: 5, stroke: 'var(--border)' }) + `<text x="48" y="87" text-anchor="middle" font-size="11" fill="var(--accent)" font-family="monospace">&lt;/&gt;</text>`
      + curve(86, 82, 120, 110, { arrow: true, c: 'var(--accent)' }) + txt(48, 118, t('glCodeCopied'))),
    album: t => svg(190, page(60, 6, 280, 178, 'Music City OST')
      + `<rect x="74" y="26" width="84" height="84" rx="4" fill="var(--accent)" opacity=".85"/>` + txt(116, 72, t('glCover'), { c: CARD })
      + txt(170, 40, 'Music City OST', { a: 'start', c: 'var(--text)', fs: 11, bold: true }) + txt(170, 54, 'Interactive Edition', { a: 'start' })
      + rect(170, 80, 76, 24, 'var(--accent)', { r: 12 }) + txt(208, 96, t('glBuy'), { c: CARD, fs: 9, bold: true })
      + ['Rock City', 'Disco City', 'Jazz City', 'Synth City'].map((c, i) => rect(74, 118 + i * 16, 252, 13, 'var(--accent-soft)') + txt(82, 127 + i * 16, c, { a: 'start', c: 'var(--text)', fs: 7.5 }) + txt(318, 127 + i * 16, t('glFreeze') + ' ◆', { a: 'end', c: 'var(--accent)', fs: 7.5 })).join('')),
    upload: t => svg(160, [[t('glPhoto'), 'AdReel'], [t('glThumb'), t('glSharing')], [t('glVideo'), t('glHosted') + ' ▶'], [t('glIllus'), 'pack'], [t('glCover'), 'album']].map(([a, b], i) => {
      const x = 12 + i * 77;
      return rect(x, 24, 68, 68, 'var(--accent-soft)', { r: 5, stroke: 'var(--border)' })
        + (i === 2 ? play(x + 34, 58) : `<path d="M${x + 10} 82 L${x + 28} 58 L${x + 40} 72 L${x + 48} 64 L${x + 60} 82 Z" fill="var(--accent)" opacity=".55"/><circle cx="${x + 50}" cy="40" r="6" fill="var(--accent)" opacity=".55"/>`)
        + txt(x + 34, 108, a, { c: 'var(--text)', fs: 9, bold: true }) + txt(x + 34, 121, b);
    }).join('') + txt(200, 150, t('glMediaWhere'))),
    // Leçons Projet : le projet d’exemple « Music City » (api/demo-projects.js) — quatre villes en sections, carte Jazz → Rock → Disco / Synth.
    'pj-create': t => svg(170, `<rect x="100" y="10" width="200" height="150" rx="8" fill="${CARD}" stroke="var(--accent)" stroke-width="1.4"/>`
      + txt(200, 32, 'Music City', { c: 'var(--text)', fs: 11, bold: true })
      + ['J', 'L', 'M', 'D'].map((n, i) => `<circle cx="${170 + i * 15}" cy="48" r="7" fill="var(--accent)" opacity="${0.4 + i * 0.18}" stroke="${CARD}"/>` + txt(170 + i * 15, 51, n, { c: CARD, fs: 7, bold: true })).join('') + txt(234, 51, t('glTeam'), { a: 'start' })
      + CITIES.map((s, i) => block(116, 64 + i * 23, 168, 19, s, { left: true })).join('')),
    'pj-chat': t => svg(170, rect(20, 10, 110, 150, 'var(--accent-soft)', { r: 6 })
      + ['# ' + t('glChGeneral')].concat(CITIES.map(c => '# ' + c)).map((c, i) => txt(30, 32 + i * 24, c, { a: 'start', c: i === 1 ? 'var(--accent)' : 'var(--text)', bold: i === 1 })).join('')
      + rect(140, 10, 240, 150, CARD, { r: 6, stroke: 'var(--border)' }) + txt(150, 26, '# Jazz City', { a: 'start', c: 'var(--accent)', bold: true })
      + [[148, t('glMsg1'), OFF], [182, t('glMsg2'), 'var(--accent-soft)'], [148, t('glMsg3'), OFF]].map(([x, m, c], i) => rect(x, 36 + i * 40, 190, 28, c, { r: 10 }) + txt(x + 95, 54 + i * 40, m, { c: 'var(--text)', fs: 7.5 })).join('')),
    'pj-moodboard': t => {
      // Post-it : deux lignes au plus (\n dans le texte).
      const note = (nx, ny, w, h, label) => `<rect x="${nx}" y="${ny}" width="${w}" height="${h}" rx="3" fill="#f3e3a1"/>`
        + String(label).split('\n').map((l, i, all) => txt(nx + w / 2, ny + h / 2 + 3 + (i - (all.length - 1) / 2) * 10, l, { c: '#3a3320', fs: 7.5 })).join('');
      const ref = (nx, ny, label) => rect(nx, ny, 76, 22, CARD, { stroke: 'var(--border)' }) + play(nx + 10, ny + 11) + txt(nx + 20, ny + 14, label, { a: 'start', c: 'var(--text)', fs: 7 });
      return svg(170, [[t('glBoardGeneral'), 'glNoteTempo', 'Banjo-Kazooie', 'glNoteClub'], ['Jazz City', 'glNoteNeon', 'Cuphead', 'glNoteBar']].map(([s, n1, r, n2], k) => {
        const x = 14 + k * 194;
        return rect(x, 10, 180, 150, 'var(--accent-soft)', { r: 6 }) + txt(x + 10, 28, s, { a: 'start', c: 'var(--text)', fs: 9, bold: true })
          + (k ? rect(x + 10, 38, 76, 56, CARD, { stroke: 'var(--border)' }) + `<path d="M${x + 14} 90 L${x + 40} 60 L${x + 56} 76 L${x + 82} 90 Z" fill="var(--accent)" opacity=".5"/>` : note(x + 10, 38, 76, 56, t(n1)))
          + (k ? note(x + 94, 38, 76, 40, t(n1)) : note(x + 94, 38, 76, 40, t(n2)))
          + ref(x + 94, 86, r)
          + (k ? note(x + 10, 102, 76, 46, t(n2)) : '');
      }).join(''));
    },
    'pj-music': t => svg(160, box(10, 20, 110, 40, 'Daniel', t('glComposerShares')) + box(10, 100, 110, 40, t('glYouCap'), t('glYouShare'))
      + curve(120, 40, 200, 72, { arrow: true }) + curve(120, 120, 200, 88, { arrow: true })
      + rect(204, 40, 186, 84, CARD, { r: 6, stroke: 'var(--accent)' }) + txt(214, 58, t('glProjectMusic'), { a: 'start', c: 'var(--text)', fs: 9, bold: true })
      + [[t('glPmDaniel'), 'Daniel'], [t('glPmMine'), t('glYouCap')]].map(([m, who], i) => play(222, 76 + i * 22) + txt(234, 76 + i * 22, m, { a: 'start', c: 'var(--text)' }) + txt(234, 85 + i * 22, t('glSharedBy', { name: who }), { a: 'start', fs: 6.5 })).join('')),
    'pj-map-build': t => mapSvg(t, { transition: true, note: true }),
    'pj-map-music': t => mapSvg(t, { music: true }),
    'pj-map-walk': t => mapSvg(t, { music: true, walk: true }),
  };
  // Clé du texte de la bulle de chaque leçon (layerpitch-i18n.js, zone shared).
  const TEXT_KEY = id => 'glText_' + id.replace(/-/g, '_');

  window.LayerPitchLessonPreviews = {
    has: id => Object.prototype.hasOwnProperty.call(DRAW, id),
    textKey: TEXT_KEY,
    // Dessin d'une leçon ; tr = tr() de la page (clés gl… de la zone shared).
    html: (id, tr) => {
      const draw = DRAW[id];
      if (!draw) return '';
      // Le texte de la bulle sert aussi de description du dessin pour les lecteurs d’écran.
      return draw(tr).replace('role="img"', `role="img" aria-label="${esc(tr(TEXT_KEY(id)))}"`);
    },
    // Étape « Ce qu’on va construire » à glisser juste après l’accueil d’une leçon.
    step: id => ({ titleKey: 'glTitle', textKey: TEXT_KEY(id), preview: id }),
  };
})();
