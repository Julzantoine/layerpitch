#!/usr/bin/env node
// scripts/landing-structured-data.js — données structurées (schema.org, JSON-LD) de la nouvelle landing (27/10, chantier SEO/GEO).
// Elles disent à Google et aux IA, dans un format qu'ils lisent sans deviner : qui est LayerPitch (accueil) et quelles sont les
// questions-réponses de la FAQ. Le bloc est écrit entre <!-- ld:start --> et <!-- ld:end --> juste avant </head>.
// La FAQ est relue dans la page elle-même (<details><summary>) : une question modifiée dans faq.html ne demande que de relancer
//   node scripts/landing-structured-data.js
// --check : ne réécrit rien, échoue si une page n'est pas à jour (utilisé par test_landing_structured_data.js).
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'nouvelle-landing');
const SITE = 'https://www.layerpitch.com';

const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'");
const text = html => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function faqLd(html, lang) {
  const items = [...html.matchAll(/<details><summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)]
    .map(m => ({ '@type': 'Question', name: text(m[1]), acceptedAnswer: { '@type': 'Answer', text: text(m[2]) } }));
  return { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: lang, mainEntity: items };
}

function homeLd(lang) {
  const en = lang === 'en';
  const url = en ? SITE + '/en/' : SITE + '/';
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': SITE + '/#organization', name: 'LayerPitch', url: SITE + '/',
        founder: { '@type': 'Person', name: 'Jules-Antoine Escande' } },
      { '@type': 'WebSite', '@id': url + '#website', name: 'LayerPitch', url, inLanguage: lang, publisher: { '@id': SITE + '/#organization' } },
      { '@type': 'SoftwareApplication', name: 'LayerPitch', url, applicationCategory: 'MultimediaApplication', operatingSystem: 'Web',
        description: en
          ? 'A workspace and tools to compose, present, test and validate video game music and sound design, between composers, sound designers and studios. Adaptive music is shared as an AdReel (Adaptive Reel), playable live in the browser.'
          : 'Un espace de travail et des outils pour composer, présenter, tester et valider la musique et le sound design de jeu vidéo, entre compositeurs, sound designers et studios. La musique adaptative se partage sous forme d\'AdReel (Adaptive Reel), manipulable en direct dans le navigateur.',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
        publisher: { '@id': SITE + '/#organization' } },
    ],
  };
}

const PAGES = [
  ['index.html', html => homeLd('fr')],
  ['en/index.html', html => homeLd('en')],
  ['faq.html', html => faqLd(html, 'fr')],
  ['en/faq.html', html => faqLd(html, 'en')],
];

function render(html, ld) {
  const json = JSON.stringify(ld, null, 1).replace(/</g, '\\u003c');
  const block = `<!-- ld:start (généré par scripts/landing-structured-data.js, ne pas modifier à la main) -->\n<script type="application/ld+json">\n${json}\n</script>\n<!-- ld:end -->\n`;
  const cleaned = html.replace(/<!-- ld:start[\s\S]*?<!-- ld:end -->\n?/, '');
  return cleaned.replace('</head>', block + '</head>');
}

const check = process.argv.includes('--check');
let stale = 0;
for (const [file, build] of PAGES) {
  const p = path.join(dir, file);
  const html = fs.readFileSync(p, 'utf8');
  const next = render(html, build(html));
  if (next === html) continue;
  if (check) { console.log('pas à jour : nouvelle-landing/' + file); stale++; continue; }
  fs.writeFileSync(p, next);
  console.log('écrit : nouvelle-landing/' + file);
}
if (stale) process.exit(1);
