#!/usr/bin/env node
/**
 * LayerPitch — vérifie que CHAQUE AdReel (et ses morceaux/Sfx référencés) reconstruit depuis
 * Postgres est identique à l'original de data.json. Condition explicite avant de faire dépendre
 * le site public de cette base (Décision 5, étape 3).
 *
 * N'écrit rien. Usage : node scripts/verify-postgres-migration.js
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

// Normalise les équivalences non sémantiques introduites par la migration (null vs [] pour une
// liste vide, undefined vs null pour un champ absent, clé absente vs clé présente valant null —
// Postgres matérialise toujours la colonne, même quand data.json omettait simplement la clé).
function normalize(v) {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.length === 0 ? null : v.map(normalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      const nv = normalize(v[k]);
      if (nv !== null) out[k] = nv; // clé absente == clé valant null, pour cette comparaison
    }
    return out;
  }
  return v;
}
function deepEqual(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

async function reconstructTrack(client, id) {
  const { rows } = await client.query('select * from tracks where id = $1', [id]);
  const t = rows[0];
  if (!t) return null;
  const slotsRes = await client.query('select * from segment_slots where track_id = $1 order by position', [id]);
  const segmentSlots = [];
  for (const s of slotsRes.rows) {
    const transRes = await client.query('select * from segment_slot_transitions where from_slot_id = $1 order by position', [s.id]);
    const nextOptions = transRes.rows.map(tr => ({ targetId: tr.target_slot_id, label: tr.label, transition: tr.transition }));
    segmentSlots.push({
      id: s.id, label: s.label, avoidImmediateRepeat: s.avoid_immediate_repeat, referencesSlotId: s.references_slot_id,
      repeatCount: s.repeat_count, quantization: s.quantization, cutStyle: s.cut_style,
      descriptionFr: s.description_fr, descriptionEn: s.description_en,
      nextOptions: nextOptions.length ? nextOptions : null, alternatives: s.alternatives,
      bpm: s.bpm != null ? Number(s.bpm) : null, beatsPerBar: s.beats_per_bar,
      customCutFadeSec: s.custom_cut_fade_sec != null ? Number(s.custom_cut_fade_sec) : null,
    });
  }
  const sfxRes = await client.query('select sfx_id from track_sfx where track_id = $1 order by position', [id]);
  return {
    id: t.id, title: t.title, description: t.description, mode: t.mode, loopable: t.loopable,
    implementationNote: t.implementation_note, noAiOverride: t.no_ai_override, loopEngine: t.loop_engine,
    bpm: t.bpm != null ? Number(t.bpm) : null, beatsPerBar: t.beats_per_bar,
    loopGridUnit: t.loop_grid_unit, loopInBeat: t.loop_in_beat != null ? Number(t.loop_in_beat) : null,
    loopOutBeat: t.loop_out_beat != null ? Number(t.loop_out_beat) : null,
    startTrackBeat: t.start_track_beat != null ? Number(t.start_track_beat) : null,
    maxLoops: t.max_loops, maxChainLoops: t.max_chain_loops, normalizeVolume: t.normalize_volume,
    duration: Number(t.duration), base: t.base, layers: t.layers, intro: t.intro, outro: t.outro,
    segmentSlots, loops: t.loops, randomizeSections: t.randomize_sections, sections: t.sections,
    sfxIds: sfxRes.rows.map(r => r.sfx_id), folderId: t.folder_id,
  };
}

async function reconstructAdReel(client, id) {
  const { rows } = await client.query('select * from ad_reels where id = $1', [id]);
  const a = rows[0];
  if (!a) return null;
  const tracksRes = await client.query('select track_id from ad_reel_tracks where ad_reel_id = $1 order by position', [id]);
  return {
    id: a.id, label: a.label, lang: a.lang, blocks: a.blocks, profile: a.profile,
    testimonials: a.testimonials, trackIds: tracksRes.rows.map(r => r.track_id),
    trackOverrides: a.track_overrides, folderId: a.folder_id,
  };
}

async function reconstructSfx(client, id) {
  const { rows } = await client.query('select * from sfx_library where id = $1', [id]);
  const s = rows[0];
  if (!s) return null;
  return {
    id: s.id, title: s.title, descriptionFr: s.description_fr, descriptionEn: s.description_en,
    rrMode: s.rr_mode, duckMainTrack: s.duck_main_track, base: s.base, alternatives: s.alternatives,
    folderId: s.folder_id,
  };
}

async function reconstructPack(client, id) {
  const { rows } = await client.query('select * from packs where id = $1', [id]);
  const p = rows[0];
  if (!p) return null;
  const trackIds = await client.query('select track_id from pack_tracks where pack_id = $1 order by position', [id]);
  const sfxIds = await client.query('select sfx_id from pack_sfx where pack_id = $1 order by position', [id]);
  return {
    id: p.id, title: p.title, illustration: p.illustration, illustrationOriginalName: p.illustration_original_name,
    watermark: p.watermark, watermarkOriginalName: p.watermark_original_name,
    presentationFr: p.presentation_fr, presentationEn: p.presentation_en, buyable: p.buyable, buyUrl: p.buy_url,
    freeDownloadEnabled: p.free_download_enabled, videoTestModeEnabled: p.video_test_mode_enabled,
    bgColor: p.bg_color, textColor: p.text_color, font: p.font, trackIds: trackIds.rows.map(r => r.track_id),
    sfxIds: sfxIds.rows.map(r => r.sfx_id), linkedAdReelId: p.linked_ad_reel_id,
  };
}

async function reconstructCollection(client, id) {
  const { rows } = await client.query('select * from collections where id = $1', [id]);
  const c = rows[0];
  if (!c) return null;
  const packIds = await client.query('select pack_id from collection_packs where collection_id = $1 order by position', [id]);
  return {
    id: c.id, title: c.title, illustration: c.illustration, illustrationOriginalName: c.illustration_original_name,
    presentationFr: c.presentation_fr, presentationEn: c.presentation_en, bgColor: c.bg_color, textColor: c.text_color,
    font: c.font, buyable: c.buyable, buyUrl: c.buy_url, freeDownloadEnabled: c.free_download_enabled,
    packIds: packIds.rows.map(r => r.pack_id),
  };
}

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  let ok = 0, mismatched = 0;
  const checkedTrackIds = new Set();

  for (const originalAdReel of data.adReels || []) {
    const rebuilt = await reconstructAdReel(client, originalAdReel.id);
    const { blocks, profile, testimonials, trackIds, trackOverrides, folderId, ...originalRest } = originalAdReel;
    const original = { ...originalRest, blocks, profile, testimonials, trackIds: trackIds || [], trackOverrides, folderId: folderId || null };
    if (deepEqual(original, rebuilt)) { console.log(`✓ AdReel identique : ${originalAdReel.id} (${originalAdReel.label})`); ok++; }
    else { console.log(`✗ AdReel DIFFÉRENT : ${originalAdReel.id} (${originalAdReel.label})`); mismatched++; }

    for (const trackId of originalAdReel.trackIds || []) {
      if (checkedTrackIds.has(trackId)) continue;
      checkedTrackIds.add(trackId);
      const originalTrack = (data.library || []).find(t => t.id === trackId);
      if (!originalTrack) continue;
      const rebuiltTrack = await reconstructTrack(client, trackId);
      const normalizedOriginal = {
        ...originalTrack,
        sfxIds: originalTrack.sfxIds || [],
        folderId: originalTrack.folderId || null,
        segmentSlots: (originalTrack.segmentSlots || []).map(s => ({ ...s, nextOptions: s.nextOptions || null })),
      };
      if (deepEqual(normalizedOriginal, rebuiltTrack)) { console.log(`  ✓ Track identique : ${trackId} (${originalTrack.title})`); ok++; }
      else {
        console.log(`  ✗ Track DIFFÉRENT : ${trackId} (${originalTrack.title})`);
        mismatched++;
        const a = normalize(normalizedOriginal), b = normalize(rebuiltTrack);
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
            console.log(`      champ "${k}" diffère :`);
            console.log(`        original : ${JSON.stringify(a[k]).slice(0, 200)}`);
            console.log(`        postgres : ${JSON.stringify(b[k]).slice(0, 200)}`);
          }
        }
      }
    }
  }

  // Morceaux jamais référencés par un AdReel (au moins dans la bibliothèque, pas forcément publiés)
  for (const originalTrack of data.library || []) {
    if (checkedTrackIds.has(originalTrack.id)) continue;
    const rebuiltTrack = await reconstructTrack(client, originalTrack.id);
    const normalizedOriginal = {
      ...originalTrack, sfxIds: originalTrack.sfxIds || [], folderId: originalTrack.folderId || null,
      segmentSlots: (originalTrack.segmentSlots || []).map(s => ({ ...s, nextOptions: s.nextOptions || null })),
    };
    if (deepEqual(normalizedOriginal, rebuiltTrack)) { console.log(`✓ Track (hors AdReel) identique : ${originalTrack.id} (${originalTrack.title})`); ok++; }
    else { console.log(`✗ Track (hors AdReel) DIFFÉRENT : ${originalTrack.id} (${originalTrack.title})`); mismatched++; }
  }

  for (const s of data.sfxLibrary || []) {
    const rebuilt = await reconstructSfx(client, s.id);
    const original = { ...s, folderId: s.folderId || null };
    if (deepEqual(original, rebuilt)) { console.log(`✓ Sfx identique : ${s.id} (${s.title})`); ok++; }
    else { console.log(`✗ Sfx DIFFÉRENT : ${s.id} (${s.title})`); mismatched++; }
  }

  for (const p of data.packs || []) {
    const rebuilt = await reconstructPack(client, p.id);
    const original = { ...p, trackIds: p.trackIds || [], sfxIds: p.sfxIds || [], linkedAdReelId: p.linkedAdReelId || null };
    if (deepEqual(original, rebuilt)) { console.log(`✓ Pack identique : ${p.id} (${p.title})`); ok++; }
    else { console.log(`✗ Pack DIFFÉRENT : ${p.id} (${p.title})`); mismatched++; }
  }

  for (const c of data.collections || []) {
    const rebuilt = await reconstructCollection(client, c.id);
    const original = { ...c, packIds: c.packIds || [] };
    if (deepEqual(original, rebuilt)) { console.log(`✓ Collection identique : ${c.id} (${c.title})`); ok++; }
    else { console.log(`✗ Collection DIFFÉRENTE : ${c.id} (${c.title})`); mismatched++; }
  }

  await client.end();
  console.log(`\nRésultat : ${ok} identique(s), ${mismatched} différent(s).`);
  if (mismatched) process.exit(1);
  console.log('✓ Tout data.json (AdReels, morceaux, Sfx, packs, collections) est identique entre l\'original et Postgres.');
})().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
