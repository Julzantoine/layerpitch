-- LayerPitch — revue de code du 24/09 : tags de morceau persistés + fonctions sensibles fermées au public.
--
-- 1. tracks.tags (perte de données) : le Backstage saisit des tags par morceau et le lecteur public les affiche, mais
--    la table n'avait pas de colonne -- ils disparaissaient à chaque publication vers Postgres (même piège que le tag
--    des Sfx, corrigé par 20260923030000). Liste text[], comme packs.tags. upsert_track est recréée à l'identique de
--    20260924010000 ; seul ajout : v_tags.
--
-- 2. Droits d'exécution : Postgres accorde EXECUTE à PUBLIC par défaut, donc aux visiteurs anonymes via l'API.
--    Ces fonctions SECURITY DEFINER n'ont aucune raison d'être appelées depuis un navigateur :
--    - next_invoice_number : n'importe qui pouvait « consommer » des numéros de facture d'un compositeur et créer des
--      trous dans une numérotation qui doit légalement être continue. Seul le webhook Stripe (service_role) l'appelle ;
--    - purge_old_analytics_events : tâche planifiée (pg_cron) ;
--    - composer_real_tier, composer_effective_tier, effective_plan_quotas, beta_full_access : révèlent le palier de
--      n'importe quel compositeur ; appelées uniquement par d'autres fonctions SECURITY DEFINER (qui s'exécutent avec
--      les droits du propriétaire, donc non concernées) et par le service_role (create-checkout-session).
--    service_role reçoit un droit explicite, pour ne plus dépendre de celui de PUBLIC.

alter table public.tracks add column if not exists tags text[] not null default '{}';

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
  v_tags text[];
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

  -- Tags : le Backstage les saisit en texte libre séparé par des virgules ("ambient, boss, 8-bit") ; stockés en
  -- liste nettoyée (espaces retirés, vides ignorés), même type que packs.tags. Une liste JSON est aussi acceptée.
  if jsonb_typeof(payload->'tags') = 'array' then
    select coalesce(array_agg(btrim(t)) filter (where btrim(t) <> ''), '{}') into v_tags
    from jsonb_array_elements_text(payload->'tags') t;
  else
    select coalesce(array_agg(btrim(t)) filter (where btrim(t) <> ''), '{}') into v_tags
    from unnest(string_to_array(coalesce(payload->>'tags', ''), ',')) t;
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
    randomize_sections, layers, intro, outro, loops, sections, fx, fx_triggers, fx_sliders, tags, updated_at)
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
    nullif(payload->'fx', 'null'::jsonb), coalesce(nullif(payload->'fxTriggers', 'null'::jsonb), '[]'::jsonb),
    coalesce(nullif(payload->'fxSliders', 'null'::jsonb), '[]'::jsonb), v_tags, now()
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
    sections = excluded.sections, fx = excluded.fx, fx_triggers = excluded.fx_triggers, fx_sliders = excluded.fx_sliders,
    tags = excluded.tags, updated_at = now();

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

revoke execute on function public.next_invoice_number(uuid) from public, anon, authenticated;
revoke execute on function public.purge_old_analytics_events() from public, anon, authenticated;
revoke execute on function public.composer_real_tier(uuid) from public, anon, authenticated;
revoke execute on function public.composer_effective_tier(uuid) from public, anon, authenticated;
revoke execute on function public.effective_plan_quotas(uuid) from public, anon, authenticated;
revoke execute on function public.beta_full_access() from public, anon, authenticated;

grant execute on function public.next_invoice_number(uuid) to service_role;
grant execute on function public.purge_old_analytics_events() to service_role;
grant execute on function public.composer_real_tier(uuid) to service_role;
grant execute on function public.composer_effective_tier(uuid) to service_role;
grant execute on function public.effective_plan_quotas(uuid) to service_role;
grant execute on function public.beta_full_access() to service_role;
