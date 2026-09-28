function genId() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ---------------- Migration (anciens formats de data.json) ---------------- */
function migrateBlocks(data) {
  let blocks = data.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0 || typeof blocks[0] !== 'object') {
    const legacy = Array.isArray(blocks) ? blocks : ['header', 'testimonials', 'videos', 'gallery', 'bio', 'tracks'];
    const out = [];
    legacy.forEach(type => {
      const t = type === 'photo' ? 'gallery' : type;
      if (t === 'gallery') out.push({ id: genId(), type: 'photo', align: 'left', images: (data.gallery || []).map(g => ({ file: g.file })) });
      else if (t === 'videos') out.push({ id: genId(), type: 'video', videos: (data.videos || []).map(v => ({ title: v.title, url: v.url })) });
      else if (['header', 'bio', 'testimonials', 'tracks'].includes(t)) out.push({ id: genId(), type: t });
    });
    blocks = out;
  }
  blocks.forEach(b => {
    if (b.type === 'photo' && !b.images) b.images = b.file ? [{ file: b.file }] : [];
    if (b.type === 'video' && !b.videos) b.videos = (b.title || b.url) ? [{ title: b.title || '', url: b.url || '' }] : [];
  });
  ['header', 'testimonials', 'tracks'].forEach(t => {
    if (!blocks.some(b => b.type === t)) blocks.push({ id: genId(), type: t });
  });
  return blocks;
}

