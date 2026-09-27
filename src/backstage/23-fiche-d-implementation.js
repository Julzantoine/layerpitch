/* ---------------- Fiche d'implémentation (générée à partir des données, jamais éditée à la main) ----------------
   Une fonction de description dédiée par mode de lecture, volontairement séparées les unes des autres :
   si une fonctionnalité est ajoutée au lecteur plus tard (ex. une intro pour le mode vertical), seule la
   fonction du mode concerné a besoin d'être mise à jour ici, en même temps que le code du lecteur lui-même.
   Description neutre / trans-middleware voulue : jamais de vocabulaire propre à un moteur donné (Wwise,
   FMOD...) — ça reste au compositeur d'en parler, via le champ "Note d'implémentation" libre par morceau,
   repris tel quel plus bas. */

function describeTimingBlock(track) {
  const lines = [];
  const isQuantized = track.mode === 'sequential' || track.mode === 'embranchement-vertical' || track.loopEngine === 'quantized';
  if (!isQuantized) return lines;
  const bpm = track.bpm || 120;
  const bpb = track.beatsPerBar || 4;
  lines.push(`Tempo : ${bpm} BPM, ${bpb} temps par mesure.`);
  if (track.startTrackBeat) lines.push(`Point de démarrage : temps ${track.startTrackBeat} depuis le début du fichier.`);
  if (track.mode !== 'sequential' && track.loopInBeat !== undefined && track.loopOutBeat !== undefined) {
    lines.push(`Boucle entre le temps ${track.loopInBeat} et le temps ${track.loopOutBeat}.`);
  }
  if (track.maxLoops) lines.push(`Nombre de boucles par défaut : ${track.maxLoops} (réglable par le visiteur jusqu'à ce nombre côté page publique ; illimité si non précisé).`);
  return lines;
}
function describeStatic(track) {
  return [track.loopable ? 'Piste unique, en boucle continue.' : 'Piste unique, joue une fois puis s\'arrête.', ...describeTimingBlock(track)];
}
function describeVertical(track) {
  const layers = track.layers || [];
  const lines = [
    `${layers.length} couche(s) empilée(s), activées de façon cumulative selon un seuil d'intensité.`,
    'Seuil 0 = première couche seule. Seuil i = couches 1 à i+1 actives simultanément (chaque seuil ajoute une couche, aucune n\'est retirée en montant).'
  ];
  layers.forEach((l, i) => lines.push(`  - Seuil ${i} : couche "${l.label || `Couche ${i + 1}`}".`));
  return [...lines, ...describeTimingBlock(track)];
}
function describeVerticalRandom(track) {
  const lines = [];
  if (track.intro && (track.intro.remoteFile || track.intro.pendingFile)) {
    lines.push(`Intro ("${track.intro.label || 'Intro'}", ${track.intro.bars || 8} mesures) : jouée une fois au tout début, avec chevauchement sur le début de la première section si le fichier dépasse cette durée nominale.`);
  }
  const allSections = track.sections || [];
  const playableSections = allSections.filter(sec => sec.referencesSectionId
    ? (allSections.find(s2 => s2.id === sec.referencesSectionId) || {}).pools?.some(p => (p.alternatives || []).some(a => a.remoteFile || a.pendingFile))
    : (sec.pools || []).some(p => (p.alternatives || []).some(a => a.remoteFile || a.pendingFile)));
  if (playableSections.length > 1) {
    lines.push(track.randomizeSections
      ? `${playableSections.length} section(s), jouées à chaque cycle dans un ordre mélangé (brassage complet — chacune joue exactement une fois par cycle) :`
      : `${playableSections.length} section(s), enchaînées dans cet ordre, en boucle sur elles-mêmes :`);
  } else if (playableSections.length === 1) {
    lines.push('1 section, en boucle continue sur elle-même :');
  }
  playableSections.forEach((sec, sci) => {
    const secLabel = sec.label || `Section ${sci + 1}`;
    if (sec.referencesSectionId) {
      const src = allSections.find(s2 => s2.id === sec.referencesSectionId);
      lines.push(`  ${sci + 1}. "${secLabel}" : duplique tous les pools de la section "${(src && src.label) || 'sans nom'}" (mêmes fichiers, mêmes probabilités, anti-répétition partagée par pool).`);
      return;
    }
    const pools = (sec.pools || []).filter(p => (p.alternatives || []).some(a => a.remoteFile || a.pendingFile));
    const poolDescs = pools.map(p => {
      const alts = (p.alternatives || []).filter(a => a.remoteFile || a.pendingFile);
      return `${p.label || 'sans nom'} (${alts.length} variante(s)${p.avoidImmediateRepeat ? ', anti-répétition immédiate' : ''})`;
    });
    const bpm = sec.bpm || 120, bpb = sec.beatsPerBar || 4;
    lines.push(`  ${sci + 1}. "${secLabel}" (${bpm} BPM, ${bpb} temps/mesure, boucle entre le temps ${sec.loopInBeat || 0} et le temps ${sec.loopOutBeat || 16}) : ${pools.length} pool(s) simultané(s) — ${poolDescs.join(', ')}.`);
  });
  if (track.maxChainLoops) lines.push(`Nombre de cycles complets (toutes les sections une fois chacune) avant transition automatique : ${track.maxChainLoops} (réglable par le visiteur côté page publique ; illimité si non précisé).`);
  if (track.outro && (track.outro.remoteFile || track.outro.pendingFile)) {
    lines.push(`Outro ("${track.outro.label || 'Outro'}") : jouée après la section en cours, via "Aller vers la fin".`);
  } else if (playableSections.length) {
    lines.push('Pas d\'outro définie : "Aller vers la fin" laisse simplement la section en cours filer jusqu\'à sa fin naturelle.');
  }
  return lines;
}
function describeSequential(track) {
  const lines = [];
  if (track.intro && (track.intro.remoteFile || track.intro.pendingFile)) {
    lines.push(`Intro ("${track.intro.label || 'Intro'}", ${track.intro.bars || 8} mesures) : jouée une fois au tout début.`);
  }
  const allSlots = track.segmentSlots || [];
  const playableSlots = allSlots.filter(sl => sl.referencesSlotId
    ? (allSlots.find(s2 => s2.id === sl.referencesSlotId) || {}).alternatives?.some(a => a.remoteFile || a.pendingFile)
    : (sl.alternatives || []).some(a => a.remoteFile || a.pendingFile));
  if (playableSlots.length) {
    lines.push(track.randomizeSections
      ? `${playableSlots.length} emplacement(s), joués à chaque tour dans un ordre mélangé (brassage complet — chacun joue exactement une fois par tour, jamais deux fois de suite à la jonction de deux tours) :`
      : `${playableSlots.length} emplacement(s), enchaînés dans cet ordre, en boucle sur eux-mêmes :`);
    playableSlots.forEach((sl, si) => {
      const slotLabel = sl.label || `Emplacement ${si + 1}`;
      const repeatNote = (sl.repeatCount && sl.repeatCount > 1) ? ` Rejoue ${sl.repeatCount} fois (nouvelle alternative tirée à chaque fois) avant de passer au suivant.` : '';
      if (sl.referencesSlotId) {
        const src = allSlots.find(s2 => s2.id === sl.referencesSlotId);
        lines.push(`  ${si + 1}. "${slotLabel}" : duplique le pool de l'emplacement "${(src && src.label) || 'sans nom'}" (mêmes fichiers, mêmes probabilités, anti-répétition partagée).${repeatNote}`);
        return;
      }
      const alts = (sl.alternatives || []).filter(a => a.remoteFile || a.pendingFile);
      const quantLabel = { immediate: 'tout de suite', beat: 'au prochain temps', bar: 'à la prochaine mesure' }[sl.quantization || 'bar'];
      const cutLabel = (sl.cutStyle || 'fade') === 'hard' ? 'coupure nette' : (sl.cutStyle === 'custom' ? `fondu de ${sl.customCutFadeSec != null ? sl.customCutFadeSec : 0.15}s` : 'fondu de 0.15s');
      const branchNote = (sl.nextOptions && sl.nextOptions.length)
        ? ` Le visiteur choisit la suite parmi : ${sl.nextOptions.map(opt => {
            const t2 = allSlots.find(s2 => s2.id === opt.targetId);
            const hasTrans = opt.transition && (opt.transition.remoteFile || opt.transition.pendingFile);
            return `"${opt.label || (t2 && t2.label) || 'sans nom'}"${hasTrans ? ` (via transition "${opt.transition.label || 'sans nom'}", ${opt.transition.bars || 4} mesures)` : ''}`;
          }).join(', ')} — bascule ${quantLabel}, ${cutLabel} (sans choix, cet emplacement se rejoue).`
        : '';
      if (alts.length > 1) {
        lines.push(`  ${si + 1}. "${slotLabel}" : une alternative tirée au hasard parmi ${alts.length} (${alts.map(a => `"${a.label || 'sans nom'}" (${a.bars || 8} mesures)`).join(', ')}).${sl.avoidImmediateRepeat ? ' La même alternative ne peut pas être tirée deux fois de suite.' : ''}${branchNote || repeatNote}`);
      } else {
        lines.push(`  ${si + 1}. "${slotLabel}" (${alts[0].bars || 8} mesures).${branchNote || repeatNote}`);
      }
    });
  }
  if (track.maxChainLoops) lines.push(`Nombre de cycles complets de la chaîne avant transition automatique : ${track.maxChainLoops} (réglable par le visiteur côté page publique ; illimité si non précisé).`);
  if (track.outro && (track.outro.remoteFile || track.outro.pendingFile)) {
    lines.push(`Outro ("${track.outro.label || 'Outro'}") : jouée après l'emplacement en cours, une fois le nombre de boucles atteint.`);
  } else {
    lines.push('Pas d\'outro définie : une fois le nombre de boucles atteint, l\'emplacement en cours va simplement jusqu\'à sa fin naturelle.');
  }
  return [...lines, ...describeTimingBlock(track)];
}
function describeEmbrVert(track) {
  const loopsArr = (track.loops || []).filter(l => l.remoteFile || l.pendingFile);
  if (!loopsArr.length) return describeTimingBlock(track);
  const ref = loopsArr.find(l => l.isInitial) || loopsArr[0];
  const lines = [`${loopsArr.length} boucle(s) nommée(s), autonomes, jouant simultanément en arrière-plan — le visiteur bascule entre elles par clic (fondu court, sans attente).`];
  loopsArr.forEach(l => {
    if (l === ref) { lines.push(`  "${l.label || 'sans nom'}" (${l.bars || 8} mesures) : boucle de référence, active par défaut.`); return; }
    if (l.bars === ref.bars) { lines.push(`  "${l.label || 'sans nom'}" (${l.bars || 8} mesures) : tourne en continu en arrière-plan comme la référence, peut être gardée indéfiniment.`); }
    else { lines.push(`  "${l.label || 'sans nom'}" (${l.bars || 8} mesures, plus courte que la référence) : jouée une fois puis retour automatique à la référence.`); }
  });
  return [...lines, ...describeTimingBlock(track)];
}
function describeTrackBehavior(track) {
  switch (track.mode) {
    case 'static': return describeStatic(track);
    case 'vertical': return describeVertical(track);
    case 'vertical-random': return describeVerticalRandom(track);
    case 'sequential': return describeSequential(track);
    case 'embranchement-vertical': return describeEmbrVert(track);
    default: return [`Mode "${track.mode}" non pris en charge par le générateur de fiche pour l'instant.`];
  }
}
function describeStingers(track) {
  const attached = (track.sfxIds || []).map(id => sfxLibrary.find(s => s.id === id)).filter(Boolean);
  if (!attached.length) return [];
  const desc = attached.map(sfx => {
    const n = (sfx.alternatives || []).filter(a => a.remoteFile || a.pendingFile).length;
    const variationNote = n > 1 ? ` (${n} variations round robin, ${sfx.rrMode === 'sequential' ? 'à la suite' : 'aléatoires'})` : '';
    return `${sfx.title || 'sans nom'}${variationNote}`;
  });
  return [`Sfx (clips courts déclenchables manuellement, superposables au reste) : ${desc.join(', ')}.`];
}
function buildTrackSheetText(track) {
  const lines = [`### ${track.title || 'Morceau sans titre'}`, ...describeTrackBehavior(track), ...describeStingers(track)];
  if (track.implementationNote && track.implementationNote.trim()) {
    lines.push('', `Note du compositeur : ${track.implementationNote.trim()}`);
  }
  return lines.join('\n');
}
function buildTrackSheetJson(track) {
  const json = { title: track.title || '', mode: track.mode };
  const isQuantized = track.mode === 'sequential' || track.loopEngine === 'quantized';
  if (isQuantized) {
    json.timing = {
      bpm: track.bpm || 120, beatsPerBar: track.beatsPerBar || 4, startTrackBeat: track.startTrackBeat || 0,
      loopInBeat: track.mode !== 'sequential' ? (track.loopInBeat || 0) : undefined,
      loopOutBeat: track.mode !== 'sequential' ? (track.loopOutBeat || null) : undefined,
      defaultMaxLoops: track.maxLoops || null
    };
  }
  if (track.mode === 'sequential' || track.mode === 'vertical-random') {
    json.defaultMaxChainLoops = track.maxChainLoops || null;
  }
  if (track.mode === 'static') {
    json.loopable = !!track.loopable;
  } else if (track.mode === 'vertical') {
    json.layers = (track.layers || []).map((l, i) => ({ threshold: i, label: l.label || `Couche ${i + 1}` }));
  } else if (track.mode === 'vertical-random') {
    json.randomizeSections = !!track.randomizeSections;
    json.sections = (track.sections || []).map((sec, sci) => {
      const base = { order: sci, label: sec.label || '' };
      if (sec.referencesSectionId) {
        const src = (track.sections || []).find(s2 => s2.id === sec.referencesSectionId);
        return { ...base, duplicatesSection: (src && src.label) || '' };
      }
      return {
        ...base,
        timing: { bpm: sec.bpm || 120, beatsPerBar: sec.beatsPerBar || 4, loopInBeat: sec.loopInBeat || 0, loopOutBeat: sec.loopOutBeat || 16, defaultMaxLoops: sec.maxLoops || null },
        pools: (sec.pools || []).map(p => ({
          label: p.label || '', avoidImmediateRepeat: !!p.avoidImmediateRepeat,
          alternatives: (p.alternatives || []).filter(a => a.label || a.remoteFile || a.pendingFile).map(a => ({ label: a.label || '' }))
        }))
      };
    });
  } else if (track.mode === 'sequential') {
    json.randomizeSlots = !!track.randomizeSections;
    json.intro = (track.intro && (track.intro.remoteFile || track.intro.pendingFile)) ? { label: track.intro.label || '', bars: track.intro.bars || 8 } : null;
    json.segmentSlots = (track.segmentSlots || []).map((sl, si) => {
      const base = { order: si, label: sl.label || '', repeatCount: sl.repeatCount || 1 };
      if (sl.referencesSlotId) {
        const src = (track.segmentSlots || []).find(s2 => s2.id === sl.referencesSlotId);
        return { ...base, duplicatesSlot: (src && src.label) || '' };
      }
      return {
        ...base, avoidImmediateRepeat: !!sl.avoidImmediateRepeat,
        alternatives: (sl.alternatives || []).filter(a => a.label || a.remoteFile || a.pendingFile).map(a => ({ label: a.label || '', bars: a.bars || 8 }))
      };
    });
    json.outro = (track.outro && (track.outro.remoteFile || track.outro.pendingFile)) ? { label: track.outro.label || '' } : null;
  }
  const attachedSfx = (track.sfxIds || []).map(id => sfxLibrary.find(s => s.id === id)).filter(Boolean);
  if (attachedSfx.length) {
    json.sfx = attachedSfx.map(sfx => ({
      label: sfx.title || '',
      rrMode: sfx.rrMode,
      variations: (sfx.alternatives || []).filter(a => a.remoteFile || a.pendingFile).length
    }));
  }
  if (track.implementationNote && track.implementationNote.trim()) json.composerNote = track.implementationNote.trim();
  return json;
}
function buildImplementationSheet(pack) {
  const tracks = (pack.trackIds || []).map(id => library.find(t => t.id === id)).filter(Boolean);
  const dateStr = new Date().toLocaleDateString(currentLang() === 'en' ? 'en-US' : 'fr-FR');
  const textParts = [`# Fiche d'implémentation — ${pack.title || 'Pack sans titre'}`, '', `Générée depuis LayerPitch le ${dateStr}.`, ''];
  tracks.forEach(t => { textParts.push(buildTrackSheetText(t), ''); });
  return {
    text: textParts.join('\n'),
    json: { pack: pack.title || '', generatedAt: new Date().toISOString(), tracks: tracks.map(buildTrackSheetJson) }
  };
}

function openImplementationSheetModal(pack) {
  const { text, json } = buildImplementationSheet(pack);
  document.getElementById('implSheetModalSub').textContent = pack.title || tr('defaultPackTitle');
  document.getElementById('implSheetTextArea').value = text;
  document.getElementById('implSheetJsonArea').value = JSON.stringify(json, null, 2);
  document.getElementById('implSheetModalOverlay').dataset.packTitle = pack.title || 'pack';
  document.getElementById('implSheetModalOverlay').style.display = 'flex';
  document.getElementById('implSheetModalOverlay').querySelectorAll('.impl-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.implTab === 'text'));
  document.getElementById('implSheetModalOverlay').querySelectorAll('.impl-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.implPanel === 'text'));
}
document.getElementById('implSheetCloseBtn').addEventListener('click', () => {
  document.getElementById('implSheetModalOverlay').style.display = 'none';
});
document.querySelectorAll('.impl-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.implTab;
    document.querySelectorAll('.impl-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.impl-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.implPanel === tabName));
  });
});
document.getElementById('implSheetCopyBtn').addEventListener('click', async () => {
  const activePanel = document.querySelector('.impl-tab-panel.active textarea');
  try {
    await navigator.clipboard.writeText(activePanel.value);
  } catch (e) {
    activePanel.select();
    document.execCommand('copy');
  }
  const statusEl = document.getElementById('implSheetCopyStatus');
  statusEl.classList.add('visible');
  setTimeout(() => statusEl.classList.remove('visible'), 1500);
});
document.getElementById('implSheetDownloadBtn').addEventListener('click', () => {
  const activeTab = document.querySelector('.impl-tab-btn.active').dataset.implTab;
  const content = document.getElementById(activeTab === 'json' ? 'implSheetJsonArea' : 'implSheetTextArea').value;
  const ext = activeTab === 'json' ? 'json' : 'md';
  const mime = activeTab === 'json' ? 'application/json' : 'text/markdown';
  const slugTitle = slug(document.getElementById('implSheetModalOverlay').dataset.packTitle || 'pack');
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fiche-implementation-${slugTitle}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

