/* ---------------- Blocs ---------------- */
function renderHeaderBlock(container, profile) {
  const el = document.createElement('div');
  el.className = 'header';
  // Rétrocompatibilité : un AdReel publié avant ce changement n'a qu'un tagline (jamais de subtitle),
  // repris ici comme repli. Le titre n'a pas d'équivalent antérieur — repli sur "LayerPitch" seulement
  // si vraiment rien n'a jamais été configuré, comme au tout premier chargement d'un AdReel neuf.
  const subtitle = (profile.subtitle != null && profile.subtitle !== '') ? profile.subtitle : (profile.tagline || '');
  const title = profile.title || (profile.logo ? '' : 'LayerPitch');
  el.innerHTML = `
    ${profile.logo ? `<img class="logo-img" src="${resolveImageUrl(profile.logo)}" alt="${tr('logoAlt')}">` : ''}
    ${title ? `<div class="header-title">${escapeHtml(title)}</div>` : ''}
    ${subtitle ? `<div class="header-subtitle">${escapeHtml(subtitle)}</div>` : ''}
  `;
  container.appendChild(el);
}
function renderBioBlock(container, profile) {
  if (!profile.bio && !profile.photo) return;
  const textHtml = (profile.bio || '').split('\n\n').map(p => `<p>${linkify(p)}</p>`).join('');
  const photoHtml = profile.photo
    ? `<div class="bio-photo"><img src="${resolveImageUrl(profile.photo)}" alt="${tr('photoAlt')}" loading="lazy"></div>`
    : `<div class="bio-photo empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg></div>`;
  const el = section(tr('aboutSection'), `<div class="bio">${photoHtml}<div class="bio-text">${textHtml}</div></div>`);
  container.appendChild(el);
  if (profile.photo) {
    const bioImg = el.querySelector('.bio-photo img');
    const url = resolveImageUrl(profile.photo);
    bioImg.addEventListener('click', () => openLightbox([url], 0));
  }
}
function renderTestimonialsBlock(container, list) {
  if (!list || list.length === 0) return;
  const inner = list.map(t => {
    const avatarHtml = t.avatar ? `<img class="testimonial-avatar" src="${resolveImageUrl(t.avatar)}" alt="" loading="lazy">` : '';
    const roleHtml = t.role ? `<span class="testimonial-role">${escapeHtml(t.role)}</span>` : '';
    return `<div class="testimonial">${avatarHtml}<div class="testimonial-body"><p>« ${linkify(t.text)} »</p><cite>${escapeHtml(t.author)}</cite>${roleHtml}</div></div>`;
  }).join('');
  container.appendChild(section(tr('testimonialsSection'), inner));
}
function renderTextBlockItem(container, block) {
  if (!block.content && !block.title) return;
  const align = ['left', 'center', 'right'].includes(block.align) ? block.align : 'left';
  const html = (block.content || '').split('\n\n').map(p => `<p>${linkify(p)}</p>`).join('');
  const el = document.createElement('div');
  el.className = 'block text-block';
  el.style.textAlign = align;
  el.innerHTML = `${block.title ? `<div class="text-block-title">${escapeHtml(block.title)}</div>` : ''}${html}`;
  container.appendChild(el);
}
function renderPhotoBlockItem(container, block) {
  if (!block.images || block.images.length === 0) return;
  const align = block.align === 'center' ? 'center' : block.align === 'right' ? 'flex-end' : 'flex-start';
  const el = document.createElement('div');
  el.className = 'block';
  const urls = block.images.map(g => resolveImageUrl(g.file));
  const captionHtml = block.caption ? `<div class="photo-block-caption">${escapeHtml(block.caption)}</div>` : '';
  if (block.images.length === 1) {
    el.innerHTML = `<div class="photo-block-single" style="justify-content:${align}"><img src="${urls[0]}" alt="" loading="lazy"></div>${captionHtml}`;
  } else {
    const imgs = urls.map(u => `<img src="${u}" alt="" loading="lazy">`).join('');
    el.innerHTML = `<div class="photo-grid">${imgs}</div>${captionHtml}`;
  }
  container.appendChild(el);
  el.querySelectorAll('img').forEach((img, i) => {
    img.addEventListener('click', () => openLightbox(urls, i));
  });
}
function extractYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
    }
  } catch (e) { /* URL invalide, on ignore */ }
  return null;
}

function renderPacksBlockItem(container, block, packsById) {
  const selected = (block.packIds || []).map(id => packsById[id]).filter(Boolean);
  if (!selected.length) return;
  const titleHtml = `${tr('packsSection')} <span class="info-badge" title="${tr('packsSectionHelp')}">${window.LayerPlayerCore.infoBadgeSvg()}</span>`;
  const presentationHtml = block.presentation ? `<div class="block-presentation">${linkify(block.presentation)}</div>` : '';
  const el = section(titleHtml, presentationHtml);
  const list = document.createElement('div');
  list.className = 'packs-list';
  selected.forEach(p => {
    const a = document.createElement('a');
    a.className = 'packs-list-item';
    a.href = `./pack.html?id=${encodeURIComponent(p.id)}&lang=${pageLang}${window.LayerPlayerCore.adReelFromParam()}`;
    a.innerHTML = `${p.illustration ? `<img class="packs-list-item-thumb" src="${IMAGES_BASE}${p.illustration}" alt="" loading="lazy">` : `<div class="packs-list-item-thumb empty"></div>`}<span class="packs-list-item-title">${escapeHtml(p.title)}</span><span class="packs-list-item-arrow">→</span>`;
    list.appendChild(a);
  });
  el.appendChild(list);
  container.appendChild(el);
}

function renderCollectionsBlockItem(container, block, collectionsById) {
  const selected = (block.collectionIds || []).map(id => collectionsById[id]).filter(Boolean);
  if (!selected.length) return;
  const presentationHtml = block.presentation ? `<div class="block-presentation">${linkify(block.presentation)}</div>` : '';
  const el = section(tr('collectionsSection'), presentationHtml);
  const list = document.createElement('div');
  list.className = 'packs-list';
  selected.forEach(c => {
    const a = document.createElement('a');
    a.className = 'packs-list-item';
    // adReelFromParam() (déjà utilisée pour les packs juste au-dessus) : trouvée manquante ici le
    // 4 septembre en étendant le correctif "← Retour" aux collections -- sans elle, collection.html
    // ne savait jamais depuis quel AdReel elle avait été ouverte.
    a.href = `./collection.html?id=${encodeURIComponent(c.id)}&lang=${pageLang}${window.LayerPlayerCore.adReelFromParam()}`;
    a.innerHTML = `${c.illustration ? `<img class="packs-list-item-thumb" src="${IMAGES_BASE}${c.illustration}" alt="" loading="lazy">` : `<div class="packs-list-item-thumb empty"></div>`}<span class="packs-list-item-title">${escapeHtml(c.title)}</span><span class="packs-list-item-arrow">→</span>`;
    list.appendChild(a);
  });
  el.appendChild(list);
  container.appendChild(el);
}

// Bloc « Réseaux sociaux » (28/09) : les liens viennent de la rubrique Réseaux sociaux du Backstage (data.socials,
// une seule saisie pour tous les AdReels) ; le bloc ne garde que les identifiants cochés, dans l'ordre de la rubrique.
// Un lien vide ou inutilisable n'est pas affiché ; aucun lien affichable = pas de bloc.
function renderSocialsBlockItem(container, block, socials) {
  const Icons = window.LayerPitchSocialIcons;
  if (!Icons) return;
  const chosen = new Set(block.socialIds || []);
  const links = (socials || []).filter(s => chosen.has(s.id)).map(s => ({ s, href: Icons.safeUrl(s.url) })).filter(x => x.href);
  if (!links.length) return;
  const el = section(tr('socialsSection'), '');
  const row = document.createElement('div');
  row.className = 'social-links';
  row.innerHTML = links.map(({ s, href }) => {
    const key = Icons.detect(href, s.platform);
    const label = Icons.label(key) || new URL(href).hostname.replace(/^www\./, '');
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${Icons.svg(key, 20)}</a>`;
  }).join('');
  row.querySelectorAll('a').forEach(a => a.addEventListener('click', () => trackPublicEvent('social_click', { platform: a.getAttribute('aria-label') })));
  el.appendChild(row);
  container.appendChild(el);
}

function renderSfxBlockItem(container, block, sfxById) {
  const selected = (block.sfxIds || []).map(id => sfxById[id]).filter(Boolean);
  if (!selected.length) return;
  const el = section(tr('sfxSection'), '');
  selected.forEach(s => { el.appendChild(window.LayerPlayerCore.buildSfxPlayer(s)); });
  container.appendChild(el);
}

