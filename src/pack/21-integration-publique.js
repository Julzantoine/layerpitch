function showPublicEmbedButton(url) {
  const btn = document.getElementById('embedPublicBtn');
  btn.hidden = false;
  btn.setAttribute('aria-label', tr('embedBtn'));
  btn.title = tr('embedBtn');
  btn.addEventListener('click', () => {
    document.getElementById('publicEmbedCodeArea').value = `<iframe src="${url}" width="100%" height="700" style="border:0;border-radius:8px;max-width:640px;" allow="autoplay" loading="lazy" title="${escapeHtml(document.title)}"></iframe>`;
    document.getElementById('publicEmbedModalOverlay').style.display = 'flex';
  });
}
document.getElementById('publicEmbedCloseBtn').addEventListener('click', () => {
  document.getElementById('publicEmbedModalOverlay').style.display = 'none';
});
document.getElementById('publicEmbedCopyBtn').addEventListener('click', async () => {
  const area = document.getElementById('publicEmbedCodeArea');
  try {
    await navigator.clipboard.writeText(area.value);
  } catch (e) {
    area.select();
    document.execCommand('copy');
  }
  const statusEl = document.getElementById('publicEmbedCopyStatus');
  statusEl.classList.add('visible');
  setTimeout(() => statusEl.classList.remove('visible'), 1500);
});
(function setupShareButton() {
  const btn = document.getElementById('shareBtn');
  if (!btn) return;
  btn.setAttribute('aria-label', tr('shareBtn'));
  btn.title = tr('shareBtn');
  btn.addEventListener('click', async () => {
    const result = await window.LayerPlayerCore.shareOrCopy(location.href, document.title);
    if (result === 'copied') {
      btn.classList.add('copied');
      btn.title = tr('linkCopiedToast');
      setTimeout(() => { btn.classList.remove('copied'); btn.title = tr('shareBtn'); }, 1500);
    }
  });
})();
window.addEventListener('load', init);
