/* ---------------- Cmd+K : insertion de lien ---------------- */
let linkTarget = null;
document.addEventListener('keydown', (e) => {
  const isK = e.key.toLowerCase() === 'k';
  if ((e.metaKey || e.ctrlKey) && isK && document.activeElement && document.activeElement.classList.contains('linkable')) {
    e.preventDefault();
    const ta = document.activeElement;
    linkTarget = { el: ta, start: ta.selectionStart, end: ta.selectionEnd };
    document.getElementById('linkModalUrl').value = '';
    document.getElementById('linkModalOverlay').style.display = 'flex';
    document.getElementById('linkModalUrl').focus();
  }
});
document.getElementById('linkModalCancel').addEventListener('click', () => {
  document.getElementById('linkModalOverlay').style.display = 'none';
  linkTarget = null;
});
document.getElementById('linkModalUrl').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('linkModalOk').click();
  if (e.key === 'Escape') document.getElementById('linkModalCancel').click();
});
document.getElementById('linkModalOk').addEventListener('click', () => {
  const url = document.getElementById('linkModalUrl').value.trim();
  if (!url || !linkTarget) { document.getElementById('linkModalOverlay').style.display = 'none'; return; }
  const { el, start, end } = linkTarget;
  const value = el.value;
  const selected = value.slice(start, end) || 'lien';
  const inserted = `[${selected}](${url})`;
  el.value = value.slice(0, start) + inserted + value.slice(end);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('linkModalOverlay').style.display = 'none';
  el.focus();
  linkTarget = null;
});

