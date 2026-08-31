#!/usr/bin/env node
/**
 * LayerPitch — peuple Postgres (schéma supabase/migrations/) depuis data.json.
 * (Décision 5, étape 3 — "le script de migration peuple Postgres depuis data.json... sans faire
 * dépendre le site public de cette base tant qu'un AdReel de test n'a pas été vérifié identique".)
 *
 * Idempotent : TRUNCATE ... CASCADE des tables de contenu avant réinsertion (pas des tables de
 * comptes/achats, non concernées par cette migration — aucune donnée de compte dans data.json).
 *
 * Usage : node scripts/migrate-data-to-postgres.js
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

const j = v => (v === undefined ? null : JSON.stringify(v)); // pour les colonnes jsonb (cast ::jsonb côté SQL)
// Préserve les valeurs "fausses" mais réelles (chaîne vide, 0, false) — contrairement à `x || null`,
// ne substitue null que si x est réellement absent (undefined) ou déjà null. Utilisé pour toute
// colonne nullable où '' a un sens distinct de null (ex. implementationNote).
const nn = v => (v === undefined || v === null ? null : v);

async function migrate() {
  const dataPath = path.join(__dirname, '..', 'data.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const counts = {};
  try {
    await client.query('BEGIN');

    // Ordre de troncature : tables sans dépendants d'abord évité — CASCADE s'en charge, mais on
    // liste les tables "parentes" de contenu ; les tables de liaison/enfants sont vidées avec.
    await client.query(`truncate table
      tracks, sfx_library, packs, collections, ad_reels, socials,
      track_folders, sfx_folders, ad_reel_folders, settings, albums
      restart identity cascade`);

    // ---- track_folders ----
    for (const f of data.libraryFolders || []) {
      await client.query('insert into track_folders (id, label) values ($1, $2)', [f.id, f.label]);
    }
    counts.track_folders = (data.libraryFolders || []).length;

    // ---- tracks ----
    for (const t of data.library || []) {
      await client.query(
        `insert into tracks (id, folder_id, title, description, mode, loopable, implementation_note,
          no_ai_override, loop_engine, bpm, beats_per_bar, loop_grid_unit, loop_in_beat, loop_out_beat,
          start_track_beat, max_loops, max_chain_loops, normalize_volume, duration, base,
          randomize_sections, layers, intro, outro, loops, sections)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb,$26::jsonb)`,
        [
          t.id, t.folderId || null, t.title || '', t.description || '', t.mode,
          t.loopable != null ? t.loopable : null, nn(t.implementationNote),
          t.noAiOverride != null ? t.noAiOverride : null, nn(t.loopEngine),
          t.bpm != null ? t.bpm : null, t.beatsPerBar != null ? t.beatsPerBar : null,
          nn(t.loopGridUnit), t.loopInBeat != null ? t.loopInBeat : null,
          t.loopOutBeat != null ? t.loopOutBeat : null, t.startTrackBeat != null ? t.startTrackBeat : null,
          t.maxLoops != null ? t.maxLoops : null, t.maxChainLoops != null ? t.maxChainLoops : null,
          t.normalizeVolume || false, t.duration || 0, t.base || '',
          t.randomizeSections != null ? t.randomizeSections : null,
          j(t.layers || []), j(t.intro || null), j(t.outro || null), j(t.loops || []), j(t.sections || []),
        ]
      );
      // segment_slots + segment_slot_transitions (mode sequential uniquement, Décision 1)
      const slots = t.segmentSlots || [];
      for (let idx = 0; idx < slots.length; idx++) {
        const s = slots[idx];
        await client.query(
          `insert into segment_slots (id, track_id, label, avoid_immediate_repeat, references_slot_id,
            repeat_count, quantization, cut_style, description_fr, description_en, alternatives, position,
            bpm, beats_per_bar, custom_cut_fade_sec)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)`,
          [
            s.id, t.id, s.label || '', s.avoidImmediateRepeat || false, s.referencesSlotId || null,
            s.repeatCount || 1, s.quantization || 'bar', nn(s.cutStyle),
            s.descriptionFr || '', s.descriptionEn || '', j(s.alternatives || []), idx,
            s.bpm != null ? s.bpm : null, s.beatsPerBar != null ? s.beatsPerBar : null,
            s.customCutFadeSec != null ? s.customCutFadeSec : null,
          ]
        );
      }
      // Deuxième passe : les transitions référencent des slots qui doivent TOUS déjà exister (une
      // option peut cibler n'importe quel slot du morceau, pas seulement les précédents).
      for (let idx = 0; idx < slots.length; idx++) {
        const s = slots[idx];
        const opts = s.nextOptions || [];
        for (let oi = 0; oi < opts.length; oi++) {
          const opt = opts[oi];
          await client.query(
            `insert into segment_slot_transitions (from_slot_id, target_slot_id, label, transition, position)
            values ($1,$2,$3,$4::jsonb,$5)`,
            [s.id, opt.targetId, opt.label || '', j(opt.transition || null), oi]
          );
        }
      }
    }
    counts.tracks = (data.library || []).length;

    // ---- sfx_folders, sfx_library ----
    for (const f of data.sfxFolders || []) {
      await client.query('insert into sfx_folders (id, label) values ($1, $2)', [f.id, f.label]);
    }
    counts.sfx_folders = (data.sfxFolders || []).length;
    for (const s of data.sfxLibrary || []) {
      await client.query(
        `insert into sfx_library (id, folder_id, title, description_fr, description_en, rr_mode,
          duck_main_track, base, alternatives)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [s.id, s.folderId || null, s.title || '', s.descriptionFr || '', s.descriptionEn || '',
          nn(s.rrMode), s.duckMainTrack || false, s.base || '', j(s.alternatives || [])]
      );
    }
    counts.sfx_library = (data.sfxLibrary || []).length;

    // ---- track_sfx (table de liaison, remplace track.sfxIds[]) ----
    let trackSfxCount = 0;
    for (const t of data.library || []) {
      const ids = t.sfxIds || [];
      for (let i = 0; i < ids.length; i++) {
        await client.query('insert into track_sfx (track_id, sfx_id, position) values ($1,$2,$3)', [t.id, ids[i], i]);
        trackSfxCount++;
      }
    }
    counts.track_sfx = trackSfxCount;

    // ---- ad_reel_folders, ad_reels ----
    for (const f of data.adReelFolders || []) {
      await client.query('insert into ad_reel_folders (id, label) values ($1, $2)', [f.id, f.label]);
    }
    counts.ad_reel_folders = (data.adReelFolders || []).length;
    for (const a of data.adReels || []) {
      await client.query(
        `insert into ad_reels (id, folder_id, label, lang, profile, testimonials, blocks, track_overrides)
        values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb)`,
        [a.id, a.folderId || null, a.label || '', a.lang || 'fr',
          j(a.profile || {}), j(a.testimonials || []), j(a.blocks || []), j(a.trackOverrides || {})]
      );
    }
    counts.ad_reels = (data.adReels || []).length;

    // ---- packs (référence ad_reels via linked_ad_reel_id, doit venir après) ----
    for (const p of data.packs || []) {
      await client.query(
        `insert into packs (id, title, illustration, illustration_original_name, watermark,
          watermark_original_name, presentation_fr, presentation_en, buyable, buy_url,
          free_download_enabled, video_test_mode_enabled, bg_color, text_color, font, linked_ad_reel_id, tags)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          p.id, p.title || '', nn(p.illustration), nn(p.illustrationOriginalName),
          nn(p.watermark), nn(p.watermarkOriginalName), p.presentationFr || '', p.presentationEn || '',
          p.buyable || false, p.buyUrl || '', p.freeDownloadEnabled || false, p.videoTestModeEnabled || false,
          nn(p.bgColor), nn(p.textColor), nn(p.font), p.linkedAdReelId || null, p.tags || [],
        ]
      );
      const trackIds = p.trackIds || [];
      for (let i = 0; i < trackIds.length; i++) {
        await client.query('insert into pack_tracks (pack_id, track_id, position) values ($1,$2,$3)', [p.id, trackIds[i], i]);
      }
      const sfxIds = p.sfxIds || [];
      for (let i = 0; i < sfxIds.length; i++) {
        await client.query('insert into pack_sfx (pack_id, sfx_id, position) values ($1,$2,$3)', [p.id, sfxIds[i], i]);
      }
    }
    counts.packs = (data.packs || []).length;

    // ---- collections ----
    for (const c of data.collections || []) {
      await client.query(
        `insert into collections (id, title, illustration, illustration_original_name, presentation_fr,
          presentation_en, bg_color, text_color, font, buyable, buy_url, free_download_enabled)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [c.id, c.title || '', nn(c.illustration), nn(c.illustrationOriginalName),
          c.presentationFr || '', c.presentationEn || '', nn(c.bgColor), nn(c.textColor),
          nn(c.font), c.buyable || false, c.buyUrl || '', c.freeDownloadEnabled || false]
      );
      const packIds = c.packIds || [];
      for (let i = 0; i < packIds.length; i++) {
        await client.query('insert into collection_packs (collection_id, pack_id, position) values ($1,$2,$3)', [c.id, packIds[i], i]);
      }
    }
    counts.collections = (data.collections || []).length;

    // ---- ad_reel_tracks (table de liaison, remplace adReel.trackIds[]) ----
    let adReelTracksCount = 0;
    for (const a of data.adReels || []) {
      const ids = a.trackIds || [];
      for (let i = 0; i < ids.length; i++) {
        await client.query('insert into ad_reel_tracks (ad_reel_id, track_id, position) values ($1,$2,$3)', [a.id, ids[i], i]);
        adReelTracksCount++;
      }
    }
    counts.ad_reel_tracks = adReelTracksCount;

    // ---- socials ----
    for (let i = 0; i < (data.socials || []).length; i++) {
      const s = data.socials[i];
      await client.query('insert into socials (id, platform, url, position) values ($1,$2,$3,$4)', [s.id, s.platform, s.url || '', i]);
    }
    counts.socials = (data.socials || []).length;

    // ---- settings (une seule ligne) ----
    await client.query(
      `insert into settings (id, published_at, implementation_skills, no_ai_certified_global, custom_fonts)
      values (true, $1, $2::jsonb, $3, $4::jsonb)`,
      [nn(data.publishedAt), j(data.implementationSkills || {}), data.noAiCertifiedGlobal || false, j(data.customFonts || [])]
    );

    await client.query('COMMIT');
    console.log('✓ Migration terminée :');
    Object.entries(counts).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✗ Échec, rollback complet :', e.message);
    throw e;
  } finally {
    await client.end();
  }
}

migrate().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
