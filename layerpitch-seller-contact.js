// layerpitch-seller-contact.js — LayerPitch, « Contacter le vendeur » sur les pages publiques du Shop (29/09 : la promesse
// « prenez contact avec le vendeur pour d'éventuelles adaptations » doit être tenable). Utilisé par la page d'un pack
// (pack.html) et d'un album (album.html). Le message part par l'Edge Function submit-contact-message ({ packId } ou
// { albumId }) : le destinataire est retrouvé côté serveur, l'adresse du vendeur n'est jamais montrée à l'expéditeur.
//
//   LayerPitchSellerContact.mount(élément, { kind: 'pack' | 'album', id })
(function () {
  const FUNCTIONS_URL = 'https://ypygllyjfynrnvapufow.supabase.co/functions/v1';
  const ANON_KEY = 'sb_publishable_bpjR1M-no9BaxD6QjwcNlQ_og_IgcRb';
  const lang = () => {
    const q = new URLSearchParams(location.search).get('lang');
    let stored = null;
    try { stored = localStorage.getItem('layerpitch_lang'); } catch (e) { /* stockage indisponible */ }
    return (q || stored || 'fr') === 'en' ? 'en' : 'fr';
  };
  function tr(key) {
    const I = window.LAYERPITCH_I18N || { fr: {}, en: {} };
    return ((I[lang()] || {}).sellerContact || {})[key] || ((I.fr || {}).sellerContact || {})[key] || key;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mount(host, opts) {
    if (!host || !opts || !opts.id) return;
    host.innerHTML = `<details class="lp-seller-contact" style="margin:22px 0;padding:12px 16px;border:1px solid var(--border,#e2e2e6);border-radius:10px;background:var(--bg-card,#fff)">
      <summary style="cursor:pointer;font-weight:600">${esc(tr('title'))}</summary>
      <p style="font-size:13px;color:var(--text-dim,#5f636b);margin:8px 0">${esc(tr('hint'))}</p>
      <form data-role="sellerContactForm" style="display:flex;flex-direction:column;gap:8px;max-width:520px">
        <input type="text" name="name" required maxlength="200" placeholder="${esc(tr('name'))}" style="padding:8px;border:1px solid var(--border,#e2e2e6);border-radius:6px;font:inherit">
        <input type="email" name="email" required maxlength="200" placeholder="${esc(tr('email'))}" style="padding:8px;border:1px solid var(--border,#e2e2e6);border-radius:6px;font:inherit">
        <textarea name="message" required rows="4" maxlength="5000" placeholder="${esc(tr('message'))}" style="padding:8px;border:1px solid var(--border,#e2e2e6);border-radius:6px;font:inherit"></textarea>
        <button type="submit" style="align-self:flex-start;padding:8px 18px;border:0;border-radius:6px;background:var(--accent,#2f80c0);color:var(--on-accent,#fff);font:inherit;cursor:pointer">${esc(tr('send'))}</button>
        <div data-role="sellerContactStatus" style="font-size:13px"></div>
      </form></details>`;
    const form = host.querySelector('[data-role="sellerContactForm"]');
    const status = host.querySelector('[data-role="sellerContactStatus"]');
    const button = form.querySelector('button');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      button.disabled = true; status.style.color = ''; status.textContent = tr('sending');
      const fd = new FormData(form);
      const body = { name: fd.get('name'), email: fd.get('email'), message: fd.get('message') };
      body[opts.kind === 'album' ? 'albumId' : 'packId'] = opts.id;
      try {
        const res = await fetch(`${FUNCTIONS_URL}/submit-contact-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
          body: JSON.stringify(body),
        });
        if (res.ok) { form.innerHTML = `<div style="color:#2e8b57">${esc(tr('sent'))}</div>`; return; }
        const data = await res.json().catch(() => ({}));
        status.style.color = '#b23'; status.textContent = data.error || tr('error');
      } catch (err) { status.style.color = '#b23'; status.textContent = tr('network'); }
      button.disabled = false;
    });
  }
  window.LayerPitchSellerContact = { mount };
})();
