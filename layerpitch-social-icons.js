// layerpitch-social-icons.js — icônes des réseaux sociaux (28/09, bloc « Réseaux sociaux » des AdReels).
//
// Partagé par la page publique d'un AdReel (index.html) et le Backstage (aperçu dans la carte du bloc) : une seule
// liste d'icônes, pas deux copies. Les icônes sont dessinées ici au trait (currentColor) : aucun script ni image des
// réseaux n'est chargé, donc pas de pistage des visiteurs et la couleur suit l'apparence de l'AdReel.
//
//   LayerPitchSocialIcons.detect(url, platform)  -> clé d'icône ('instagram', 'youtube', ..., 'website', 'link')
//   LayerPitchSocialIcons.svg(key, size)        -> balise <svg> prête à insérer
//   LayerPitchSocialIcons.safeUrl(url)          -> adresse http(s) normalisée, ou '' si inutilisable
//   LayerPitchSocialIcons.label(key)            -> nom du réseau (identique en toutes langues), '' pour site/lien
(function () {
  const PATHS = {
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/>',
    youtube: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9.2l5 2.8-5 2.8z" fill="currentColor"/>',
    tiktok: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.6 2.6 2.4 4.4 5 5"/>',
    twitter: '<path d="M4 4l16 16M20 4L4 20"/>',
    facebook: '<path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V21M6 10.5h8"/>',
    linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 11v6M8 7.5v.01M12 17v-6M12 13.5a2.5 2.5 0 0 1 5 0V17"/>',
    soundcloud: '<path d="M4 12.5v4.5M7 10.5v6.5M10 8.5v8.5M13 7.2V17h5a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 13 7.2z"/>',
    bandcamp: '<path d="M8.5 6H22l-6.5 12H2z"/>',
    spotify: '<circle cx="12" cy="12" r="9.5"/><path d="M7 9.6c3.5-1 7.2-.6 10.2 1M7.6 12.9c2.9-.8 5.8-.5 8.3.9M8.2 16c2.3-.6 4.5-.4 6.4.6"/>',
    twitch: '<path d="M4 3h16v11l-4.5 4.5h-4L8.5 21.5v-3H4z"/><path d="M11 7.5v4M15.5 7.5v4"/>',
    whatsapp: '<path d="M3.5 20.5l1.3-4.3a8.5 8.5 0 1 1 3.2 3.1z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .9a5 5 0 0 1-2.8-2.8l.9-1-1-2z"/>',
    telegram: '<path d="M21 4L2.5 11.2l6.3 2.2L11 20l3.3-4.2 5.2 3.7z"/><path d="M8.8 13.4L21 4"/>',
    website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  };

  // L'adresse collée prime sur le réseau choisi dans la liste : un lien instagram.com rangé en « Site web » garde
  // l'icône Instagram. Site inconnu : l'icône du réseau choisi, sinon un lien générique.
  const HOSTS = [
    [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'], [/(^|\.)tiktok\.com$/, 'tiktok'],
    [/(^|\.)(x\.com|twitter\.com)$/, 'twitter'], [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'facebook'], [/(^|\.)linkedin\.com$/, 'linkedin'],
    [/(^|\.)soundcloud\.com$/, 'soundcloud'], [/(^|\.)bandcamp\.com$/, 'bandcamp'], [/(^|\.)spotify\.com$/, 'spotify'],
    [/(^|\.)twitch\.tv$/, 'twitch'], [/(^|\.)(wa\.me|whatsapp\.com)$/, 'whatsapp'], [/(^|\.)(t\.me|telegram\.me|telegram\.org)$/, 'telegram'],
  ];

  // Noms propres des réseaux, pour les infobulles et les lecteurs d'écran ; un site web est nommé par son adresse.
  const LABELS = { instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', twitter: 'X (Twitter)', facebook: 'Facebook',
    linkedin: 'LinkedIn', soundcloud: 'SoundCloud', bandcamp: 'Bandcamp', spotify: 'Spotify', twitch: 'Twitch', whatsapp: 'WhatsApp', telegram: 'Telegram' };
  const label = key => LABELS[key] || '';

  function safeUrl(url) {
    let s = String(url || '').trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
    try {
      const u = new URL(s);
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? u.href : '';
    } catch (e) { return ''; }
  }
  function detect(url, platform) {
    const href = safeUrl(url);
    if (href) {
      const host = new URL(href).hostname.toLowerCase();
      const hit = HOSTS.find(([re]) => re.test(host));
      if (hit) return hit[1];
    }
    if (platform && PATHS[platform]) return platform;
    return 'link';
  }
  function svg(key, size) {
    const s = size || 20;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[key] || PATHS.link}</svg>`;
  }

  const api = { detect, svg, safeUrl, label, keys: Object.keys(PATHS) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LayerPitchSocialIcons = api;
})();
