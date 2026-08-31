-- LayerPitch — RPC de logique métier (Décision 2, docs/infrastructure.md) : validation du graphe
-- segment_slots/nextOptions et écriture atomique multi-tables, appelées depuis api/tracks.js,
-- api/packs.js, api/adreels.js (jamais d'écriture directe sur les tables depuis le front — la
-- validation de graphe ne peut pas s'exprimer par une simple FK Postgres, voir upsert_track).
--
-- Autorisation : pas de table profiles/rôle exploitable pour l'instant (étape 4/5 — modèle
-- composer_profiles pas encore conçu en détail). Même interim que invite-tester (étape 2) :
-- is_admin() vérifie l'email de l'appelant authentifié contre une adresse en dur. À remplacer par
-- une vraie vérification de rôle une fois profiles/composer_profiles réellement utilisés.

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'julzantoine@yahoo.com';
$$;

-- ============================================================================
-- upsert_track : écriture atomique d'UN morceau (table dure + segment_slots/transitions/sfx).
-- Remplace entièrement les listes enfants (segment_slots, transitions, sfx) à chaque appel —
-- plus simple et plus sûr qu'un diff fin, le payload complet du morceau est de toute façon
-- disponible côté appelant (même logique que le "Sauvegarder/publier" actuel du backstage).
-- ============================================================================
create or replace function public.upsert_track(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_track_id text := payload->>'id';
  v_slot jsonb;
  v_opt jsonb;
  v_valid_slot_ids text[];
  v_target text;
  v_idx int;
  v_oidx int;
  v_sfx_id text;
begin
  if not public.is_admin() then
    raise exception 'Non autorisé';
  end if;
  if v_track_id is null or v_track_id = '' then
    raise exception 'payload.id manquant';
  end if;

  -- Validation du graphe AVANT toute écriture (Décision 2) : chaque nextOptions[].targetId doit
  -- désigner un slot présent dans CE payload — une FK seule ne peut pas exprimer "dans le même
  -- morceau" (segment_slot_transitions.target_slot_id référence segment_slots globalement).
  select array_agg(s->>'id') into v_valid_slot_ids
  from jsonb_array_elements(coalesce(payload->'segmentSlots', '[]'::jsonb)) s;

  for v_slot in select * from jsonb_array_elements(coalesce(payload->'segmentSlots', '[]'::jsonb))
  loop
    for v_opt in select * from jsonb_array_elements(coalesce(v_slot->'nextOptions', '[]'::jsonb))
    loop
      v_target := v_opt->>'targetId';
      if v_target is null or v_valid_slot_ids is null or not (v_target = any(v_valid_slot_ids)) then
        raise exception 'segmentSlots invalide : le slot % cible % (branchement), introuvable parmi les emplacements de ce morceau', v_slot->>'id', v_target;
      end if;
    end loop;
  end loop;

  insert into public.tracks (id, folder_id, title, description, mode, loopable, implementation_note,
    no_ai_override, loop_engine, bpm, beats_per_bar, loop_grid_unit, loop_in_beat, loop_out_beat,
    start_track_beat, max_loops, max_chain_loops, normalize_volume, duration, base,
    randomize_sections, layers, intro, outro, loops, sections, updated_at)
  values (
    v_track_id, nullif(payload->>'folderId',''), coalesce(payload->>'title',''), coalesce(payload->>'description',''),
    payload->>'mode', (payload->>'loopable')::boolean, payload->>'implementationNote',
    (payload->>'noAiOverride')::boolean, payload->>'loopEngine',
    (payload->>'bpm')::numeric, (payload->>'beatsPerBar')::int,
    payload->>'loopGridUnit', (payload->>'loopInBeat')::numeric, (payload->>'loopOutBeat')::numeric,
    (payload->>'startTrackBeat')::numeric, (payload->>'maxLoops')::int, (payload->>'maxChainLoops')::int,
    coalesce((payload->>'normalizeVolume')::boolean, false), coalesce((payload->>'duration')::numeric, 0),
    coalesce(payload->>'base',''), (payload->>'randomizeSections')::boolean,
    coalesce(payload->'layers', '[]'::jsonb), payload->'intro', payload->'outro',
    coalesce(payload->'loops', '[]'::jsonb), coalesce(payload->'sections', '[]'::jsonb), now()
  )
  on conflict (id) do update set
    folder_id = excluded.folder_id, title = excluded.title, description = excluded.description,
    mode = excluded.mode, loopable = excluded.loopable, implementation_note = excluded.implementation_note,
    no_ai_override = excluded.no_ai_override, loop_engine = excluded.loop_engine, bpm = excluded.bpm,
    beats_per_bar = excluded.beats_per_bar, loop_grid_unit = excluded.loop_grid_unit,
    loop_in_beat = excluded.loop_in_beat, loop_out_beat = excluded.loop_out_beat,
    start_track_beat = excluded.start_track_beat, max_loops = excluded.max_loops,
    max_chain_loops = excluded.max_chain_loops, normalize_volume = excluded.normalize_volume,
    duration = excluded.duration, base = excluded.base, randomize_sections = excluded.randomize_sections,
    layers = excluded.layers, intro = excluded.intro, outro = excluded.outro, loops = excluded.loops,
    sections = excluded.sections, updated_at = now();

  delete from public.segment_slot_transitions where from_slot_id in (select id from public.segment_slots where track_id = v_track_id);
  delete from public.segment_slots where track_id = v_track_id;
  delete from public.track_sfx where track_id = v_track_id;

  v_idx := 0;
  for v_slot in select * from jsonb_array_elements(coalesce(payload->'segmentSlots', '[]'::jsonb))
  loop
    insert into public.segment_slots (id, track_id, label, avoid_immediate_repeat, references_slot_id,
      repeat_count, quantization, cut_style, description_fr, description_en, alternatives, position,
      bpm, beats_per_bar, custom_cut_fade_sec)
    values (
      v_slot->>'id', v_track_id, coalesce(v_slot->>'label',''),
      coalesce((v_slot->>'avoidImmediateRepeat')::boolean,false), nullif(v_slot->>'referencesSlotId',''),
      coalesce((v_slot->>'repeatCount')::int,1), coalesce(v_slot->>'quantization','bar'),
      v_slot->>'cutStyle', coalesce(v_slot->>'descriptionFr',''), coalesce(v_slot->>'descriptionEn',''),
      coalesce(v_slot->'alternatives','[]'::jsonb), v_idx,
      (v_slot->>'bpm')::numeric, (v_slot->>'beatsPerBar')::int, (v_slot->>'customCutFadeSec')::numeric
    );
    v_idx := v_idx + 1;
  end loop;

  for v_slot in select * from jsonb_array_elements(coalesce(payload->'segmentSlots', '[]'::jsonb))
  loop
    v_oidx := 0;
    for v_opt in select * from jsonb_array_elements(coalesce(v_slot->'nextOptions', '[]'::jsonb))
    loop
      insert into public.segment_slot_transitions (from_slot_id, target_slot_id, label, transition, position)
      values (v_slot->>'id', v_opt->>'targetId', coalesce(v_opt->>'label',''), v_opt->'transition', v_oidx);
      v_oidx := v_oidx + 1;
    end loop;
  end loop;

  v_idx := 0;
  for v_sfx_id in select jsonb_array_elements_text(coalesce(payload->'sfxIds', '[]'::jsonb))
  loop
    insert into public.track_sfx (track_id, sfx_id, position) values (v_track_id, v_sfx_id, v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_track_id);
end;
$$;

-- ============================================================================
-- upsert_pack / upsert_ad_reel : pas de graphe à valider, mais écriture multi-tables (junctions)
-- toujours faite atomiquement — mêmes garanties que upsert_track pour cette raison.
-- ============================================================================
create or replace function public.upsert_pack(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack_id text := payload->>'id';
  v_idx int;
  v_id text;
begin
  if not public.is_admin() then raise exception 'Non autorisé'; end if;
  if v_pack_id is null or v_pack_id = '' then raise exception 'payload.id manquant'; end if;

  insert into public.packs (id, title, illustration, illustration_original_name, watermark,
    watermark_original_name, presentation_fr, presentation_en, buyable, buy_url,
    free_download_enabled, video_test_mode_enabled, bg_color, text_color, font, linked_ad_reel_id, tags, updated_at)
  values (
    v_pack_id, coalesce(payload->>'title',''), payload->>'illustration', payload->>'illustrationOriginalName',
    payload->>'watermark', payload->>'watermarkOriginalName', coalesce(payload->>'presentationFr',''),
    coalesce(payload->>'presentationEn',''), coalesce((payload->>'buyable')::boolean,false),
    coalesce(payload->>'buyUrl',''), coalesce((payload->>'freeDownloadEnabled')::boolean,false),
    coalesce((payload->>'videoTestModeEnabled')::boolean,false), payload->>'bgColor', payload->>'textColor',
    payload->>'font', nullif(payload->>'linkedAdReelId',''),
    coalesce((select array_agg(t) from jsonb_array_elements_text(coalesce(payload->'tags','[]'::jsonb)) t), '{}'),
    now()
  )
  on conflict (id) do update set
    title = excluded.title, illustration = excluded.illustration,
    illustration_original_name = excluded.illustration_original_name, watermark = excluded.watermark,
    watermark_original_name = excluded.watermark_original_name, presentation_fr = excluded.presentation_fr,
    presentation_en = excluded.presentation_en, buyable = excluded.buyable, buy_url = excluded.buy_url,
    free_download_enabled = excluded.free_download_enabled, video_test_mode_enabled = excluded.video_test_mode_enabled,
    bg_color = excluded.bg_color, text_color = excluded.text_color, font = excluded.font,
    linked_ad_reel_id = excluded.linked_ad_reel_id, tags = excluded.tags, updated_at = now();

  delete from public.pack_tracks where pack_id = v_pack_id;
  delete from public.pack_sfx where pack_id = v_pack_id;

  v_idx := 0;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb))
  loop
    insert into public.pack_tracks (pack_id, track_id, position) values (v_pack_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;
  v_idx := 0;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'sfxIds', '[]'::jsonb))
  loop
    insert into public.pack_sfx (pack_id, sfx_id, position) values (v_pack_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_pack_id);
end;
$$;

create or replace function public.upsert_ad_reel(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ad_reel_id text := payload->>'id';
  v_idx int := 0;
  v_id text;
begin
  if not public.is_admin() then raise exception 'Non autorisé'; end if;
  if v_ad_reel_id is null or v_ad_reel_id = '' then raise exception 'payload.id manquant'; end if;

  insert into public.ad_reels (id, folder_id, label, lang, profile, testimonials, blocks, track_overrides, updated_at)
  values (
    v_ad_reel_id, nullif(payload->>'folderId',''), coalesce(payload->>'label',''), coalesce(payload->>'lang','fr'),
    coalesce(payload->'profile','{}'::jsonb), coalesce(payload->'testimonials','[]'::jsonb),
    coalesce(payload->'blocks','[]'::jsonb), coalesce(payload->'trackOverrides','{}'::jsonb), now()
  )
  on conflict (id) do update set
    folder_id = excluded.folder_id, label = excluded.label, lang = excluded.lang, profile = excluded.profile,
    testimonials = excluded.testimonials, blocks = excluded.blocks, track_overrides = excluded.track_overrides,
    updated_at = now();

  delete from public.ad_reel_tracks where ad_reel_id = v_ad_reel_id;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb))
  loop
    insert into public.ad_reel_tracks (ad_reel_id, track_id, position) values (v_ad_reel_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_ad_reel_id);
end;
$$;

-- Exécution réservée aux clients authentifiés (is_admin() filtre le reste à l'intérieur de chaque
-- fonction) — un visiteur anonyme peut techniquement appeler la fonction mais reçoit l'exception
-- "Non autorisé" avant toute écriture.
grant execute on function public.upsert_track(jsonb) to authenticated;
grant execute on function public.upsert_pack(jsonb) to authenticated;
grant execute on function public.upsert_ad_reel(jsonb) to authenticated;
