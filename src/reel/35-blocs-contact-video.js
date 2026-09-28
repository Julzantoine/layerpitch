const LAYERPITCH_FUNCTIONS_URL = 'https://ypygllyjfynrnvapufow.supabase.co/functions/v1';
const LAYERPITCH_ANON_KEY = 'sb_publishable_bpjR1M-no9BaxD6QjwcNlQ_og_IgcRb';

// onSubmit (facultatif, vitrines de Projet, 28/09) : la page fournit elle-même l'envoi ({ name, email, message } ->
// { ok, error }) ; sans lui, comportement de l'AdReel (relais submit-contact-message vers l'e-mail du compositeur).
function renderContactBlockItem(container, profile, onSubmit) {
  const hasContactEmail = profile && profile.contactEmail && profile.contactEmail.trim();
  if (!hasContactEmail && !onSubmit) return; // pas configuré côté backstage : ce bloc ne s'affiche simplement pas
  const el = section(tr('contactSection'), '');
  el.innerHTML += `
    <form data-role="contactForm" class="contact-form">
      <label>${tr('formName')}</label>
      <input type="text" name="name" required>
      <label>${tr('formEmail')}</label>
      <input type="email" name="email" required>
      <label>${tr('formMessage')}</label>
      <textarea name="message" required rows="5"></textarea>
      <button type="submit" data-role="contactSubmit">${tr('send')}</button>
      <div class="contact-form-status" data-role="contactStatus"></div>
    </form>
  `;
  container.appendChild(el);
  const form = el.querySelector('[data-role="contactForm"]');
  const submitBtn = el.querySelector('[data-role="contactSubmit"]');
  const statusEl = el.querySelector('[data-role="contactStatus"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    statusEl.textContent = tr('sending');
    statusEl.className = 'contact-form-status';
    try {
      const adReelId = (window.__lpTrackContext && window.__lpTrackContext.id) || 'main';
      const formData = new FormData(form);
      if (onSubmit) {
        const r = await onSubmit({ name: formData.get('name'), email: formData.get('email'), message: formData.get('message') });
        if (r && r.ok) { trackPublicEvent('contact_submit', {}); form.innerHTML = `<div class="contact-form-status success">${tr('sent')}</div>`; }
        else { statusEl.textContent = (r && r.error) || tr('genericError'); statusEl.className = 'contact-form-status error'; submitBtn.disabled = false; }
        return;
      }
      const res = await fetch(`${LAYERPITCH_FUNCTIONS_URL}/submit-contact-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: LAYERPITCH_ANON_KEY, Authorization: `Bearer ${LAYERPITCH_ANON_KEY}` },
        body: JSON.stringify({
          adReelId,
          name: formData.get('name'),
          email: formData.get('email'),
          message: formData.get('message'),
        }),
      });
      if (res.ok) {
        trackPublicEvent('contact_submit', {});
        form.innerHTML = `<div class="contact-form-status success">${tr('sent')}</div>`;
      } else {
        const data = await res.json().catch(() => ({}));
        statusEl.textContent = data.error || tr('genericError');
        statusEl.className = 'contact-form-status error';
        submitBtn.disabled = false;
      }
    } catch (err) {
      statusEl.textContent = tr('networkError');
      statusEl.className = 'contact-form-status error';
      submitBtn.disabled = false;
    }
  });
}

function renderVideoBlockItem(container, block) {
  if (!block.videos || block.videos.length === 0) return;
  const makeCard = (v) => {
    // Vidéo de la bibliothèque du compositeur (composer_videos, voir layerpitch-backstage.html) :
    // v.url pointe déjà vers un .mp4 hébergé sur R2 (résolu à la sélection côté Backstage, jamais une
    // page YouTube/Vimeo) -- lu directement avec <video>, pas d'iframe externe à charger.
    if (v.source === 'library' && v.url) {
      const wrap = document.createElement('div');
      wrap.className = 'video-card video-card-native';
      const video = document.createElement('video');
      video.className = 'video-embed-native';
      video.src = v.url;
      video.controls = true;
      video.preload = 'metadata';
      if (v.thumbnail) video.poster = resolveImageUrl(v.thumbnail);
      wrap.appendChild(video);
      return wrap;
    }

    const ytId = extractYouTubeId(v.url);
    const thumbUrl = v.thumbnail ? resolveImageUrl(v.thumbnail) : (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null);
    const bg = thumbUrl ? `background-image:url('${thumbUrl}'); background-size:cover; background-position:center;` : '';

    if (ytId) {
      // Vignette cliquable : la vidéo YouTube ne se charge (iframe) qu'au clic — plus rapide et plus respectueux
      // de la vie privée du visiteur que d'intégrer YouTube dès l'affichage de la page.
      const card = document.createElement('div');
      card.className = 'video-card';
      card.style.cssText = bg;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.innerHTML = `<div class="vt">${escapeHtml(v.title || '')}</div><div class="play-dot"></div>`;
      const activate = () => {
        const iframe = document.createElement('iframe');
        iframe.className = 'video-embed-frame';
        iframe.src = `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0`;
        iframe.title = v.title || tr('videoFallbackTitle');
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        card.replaceWith(iframe);
      };
      card.addEventListener('click', activate, { once: true });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }, { once: true });
      return card;
    }

    // Repli : URL non reconnue comme YouTube (Vimeo, autre) -> comportement existant, lien externe.
    const hasUrl = !!v.url;
    const el = document.createElement(hasUrl ? 'a' : 'div');
    el.className = 'video-card' + (hasUrl ? '' : ' disabled');
    el.style.cssText = bg;
    if (hasUrl) { el.href = v.url; el.target = '_blank'; el.rel = 'noopener'; }
    el.innerHTML = `<div class="vt">${escapeHtml(v.title || '')}</div>${hasUrl ? '<div class="play-dot"></div>' : ''}`;
    return el;
  };
  const makeItem = (v) => {
    const wrap = document.createElement('div');
    wrap.className = 'video-item';
    wrap.appendChild(makeCard(v));
    if (v.comment && v.comment.trim()) {
      const p = document.createElement('div');
      p.className = 'video-comment';
      p.textContent = v.comment;
      wrap.appendChild(p);
    }
    return wrap;
  };
  const el = document.createElement('div');
  el.className = 'block';
  if (block.videos.length === 1) {
    el.appendChild(makeItem(block.videos[0]));
  } else {
    const grid = document.createElement('div');
    grid.className = 'video-grid-multi';
    block.videos.forEach(v => grid.appendChild(makeItem(v)));
    el.appendChild(grid);
  }
  container.appendChild(el);
}
// Applique les surcharges de texte propres à cet AdReel (titre/description/labels de couche/labels de
// stinger) par-dessus le morceau tel qu'il vit dans la Bibliothèque — sans jamais modifier ce dernier.
// Absent = le texte de la Bibliothèque reste affiché tel quel.
function applyTrackOverride(track, ov) {
  if (!ov) return track;
  const merged = { ...track };
  if (ov.title !== undefined) merged.title = ov.title;
  if (ov.description !== undefined) merged.description = ov.description;
  if (ov.layers && Object.keys(ov.layers).length) {
    const key = track.mode === 'vertical-random' ? 'fixedLayers' : 'layers';
    merged[key] = (track[key] || []).map((l, i) => (ov.layers[i] !== undefined ? { ...l, label: ov.layers[i] } : l));
  }
  // Contrairement aux couches (propres au morceau), un Sfx est une entrée de bibliothèque partagée —
  // on ne peut pas réécrire son titre directement sans affecter tous les autres morceaux qui le
  // référencent aussi. La surcharge est donc portée à part (sfxLabelOverrides), lue par le rendu du
  // bouton Sfx du morceau (buildTrackRow / initTrackPlayer, player.js) plutôt que d'être fusionnée dans
  // une copie de l'entrée Sfx elle-même.
  if (ov.sfx && Object.keys(ov.sfx).length) merged.sfxLabelOverrides = ov.sfx;
  return merged;
}
