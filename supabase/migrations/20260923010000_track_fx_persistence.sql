-- LayerPitch — persistance des effets audio (fx) et des triggers d'effets.
--
-- Trou trouvé le 23 septembre en relisant le travail du 22 : upsert_track ne stockait que des colonnes
-- explicites. `layers`/`loops`/`sections` sont des colonnes JSONB, donc `fx` porté par une couche, une
-- boucle ou un pool y survivait tel quel — MAIS trois endroits le perdaient en silence à chaque
-- publication Postgres (source de vérité du site public depuis le 7 septembre) :
--   1. `fx` de niveau MORCEAU (pitch "vitesse") : aucune colonne dans `tracks` ;
--   2. `fx` d'un EMPLACEMENT séquentiel : `segment_slots` est une vraie table à colonnes fixes, pas du JSONB ;
--   3. (nouveau, triggers) `fxTriggers` du morceau et `fxActions` d'une option de branchement séquentiel
--      (`segment_slot_transitions`, même raison qu'en 2).
-- Purement additif : colonnes nullables (ou défaut '[]'), aucune donnée existante touchée, lecture par
-- api/tracks.js adaptée dans le même changement. Les morceaux déjà publiés n'ont simplement pas ces champs.

alter table public.tracks add column if not exists fx jsonb;
alter table public.tracks add column if not exists fx_triggers jsonb not null default '[]'::jsonb;
alter table public.segment_slots add column if not exists fx jsonb;
alter table public.segment_slot_transitions add column if not exists fx_actions jsonb;

create or replace function public.upsert_track(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_track_id text := payload->>'id';
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
  v_slot jsonb;
  v_opt jsonb;
  v_valid_slot_ids text[];
  v_target text;
  v_idx int;
  v_oidx int;
  v_sfx_id text;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_track_id is null or v_track_id = '' then
    raise exception 'payload.id manquant';
  end if;

  select owner_id into v_existing_owner from public.tracks where id = v_track_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : ce morceau appartient à un autre compositeur';
  end if;

  select array_agg(s->>'id') into v_valid_slot_ids
  from jsonb_array_elements(coalesce(payload->'segmentSlots', '[]'::jsonb)) s;

  for v_slot in select * from jsonb_array_elements(coalesce(payload->'segmentSlots', '[]'::jsonb))
  loop
    for v_opt in select * from jsonb_array_elements(coalesce(nullif(v_slot->'nextOptions', 'null'::jsonb), '[]'::jsonb))
    loop
      v_target := v_opt->>'targetId';
      if v_target is null or v_valid_slot_ids is null or not (v_target = any(v_valid_slot_ids)) then
        raise exception 'segmentSlots invalide : le slot % cible % (branchement), introuvable parmi les emplacements de ce morceau', v_slot->>'id', v_target;
      end if;
    end loop;
  end loop;

  insert into public.tracks (id, owner_id, folder_id, title, description, mode, loopable, implementation_note,
    no_ai_override, loop_engine, bpm, beats_per_bar, loop_grid_unit, loop_in_beat, loop_out_beat,
    start_track_beat, max_loops, max_chain_loops, normalize_volume, duration, base,
    randomize_sections, layers, intro, outro, loops, sections, fx, fx_triggers, updated_at)
  values (
    v_track_id, v_owner_id, nullif(payload->>'folderId',''), coalesce(payload->>'title',''), coalesce(payload->>'description',''),
    payload->>'mode', (payload->>'loopable')::boolean, payload->>'implementationNote',
    (payload->>'noAiOverride')::boolean, payload->>'loopEngine',
    (payload->>'bpm')::numeric, (payload->>'beatsPerBar')::int,
    payload->>'loopGridUnit', (payload->>'loopInBeat')::numeric, (payload->>'loopOutBeat')::numeric,
    (payload->>'startTrackBeat')::numeric, (payload->>'maxLoops')::int, (payload->>'maxChainLoops')::int,
    coalesce((payload->>'normalizeVolume')::boolean, false), coalesce((payload->>'duration')::numeric, 0),
    coalesce(payload->>'base',''), (payload->>'randomizeSections')::boolean,
    coalesce(payload->'layers', '[]'::jsonb), payload->'intro', payload->'outro',
    coalesce(payload->'loops', '[]'::jsonb), coalesce(payload->'sections', '[]'::jsonb),
    nullif(payload->'fx', 'null'::jsonb), coalesce(nullif(payload->'fxTriggers', 'null'::jsonb), '[]'::jsonb), now()
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
    sections = excluded.sections, fx = excluded.fx, fx_triggers = excluded.fx_triggers, updated_at = now();

  delete from public.segment_slot_transitions where from_slot_id in (select id from public.segment_slots where track_id = v_track_id);
  delete from public.segment_slots where track_id = v_track_id;
  delete from public.track_sfx where track_id = v_track_id;

  v_idx := 0;
  for v_slot in select * from jsonb_array_elements(coalesce(payload->'segmentSlots', '[]'::jsonb))
  loop
    insert into public.segment_slots (id, track_id, label, avoid_immediate_repeat, references_slot_id,
      repeat_count, quantization, cut_style, description_fr, description_en, alternatives, position,
      bpm, beats_per_bar, custom_cut_fade_sec, fx)
    values (
      v_slot->>'id', v_track_id, coalesce(v_slot->>'label',''),
      coalesce((v_slot->>'avoidImmediateRepeat')::boolean,false), nullif(v_slot->>'referencesSlotId',''),
      coalesce((v_slot->>'repeatCount')::int,1), coalesce(v_slot->>'quantization','bar'),
      v_slot->>'cutStyle', coalesce(v_slot->>'descriptionFr',''), coalesce(v_slot->>'descriptionEn',''),
      coalesce(v_slot->'alternatives','[]'::jsonb), v_idx,
      (v_slot->>'bpm')::numeric, (v_slot->>'beatsPerBar')::int, (v_slot->>'customCutFadeSec')::numeric,
      nullif(v_slot->'fx', 'null'::jsonb)
    );
    v_idx := v_idx + 1;
  end loop;

  for v_slot in select * from jsonb_array_elements(coalesce(payload->'segmentSlots', '[]'::jsonb))
  loop
    v_oidx := 0;
    for v_opt in select * from jsonb_array_elements(coalesce(nullif(v_slot->'nextOptions', 'null'::jsonb), '[]'::jsonb))
    loop
      insert into public.segment_slot_transitions (from_slot_id, target_slot_id, label, transition, position, fx_actions)
      values (v_slot->>'id', v_opt->>'targetId', coalesce(v_opt->>'label',''), v_opt->'transition', v_oidx,
        nullif(v_opt->'fxActions', 'null'::jsonb));
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
