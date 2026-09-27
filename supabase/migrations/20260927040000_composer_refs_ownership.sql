-- LayerPitch — cloison entre compositeurs sur les liens entre contenus (27 septembre).
--
-- Relecture demandée par Jules-Antoine après la photo de bio écrasée (voir create-media-signed-url) : les
-- fonctions d'écriture vérifiaient que le pack/morceau/AdReel écrit appartenait bien à l'appelant, mais PAS
-- les éléments qu'il cite. Un compositeur pouvait donc mettre les morceaux ou Sfx d'un autre dans son pack
-- (téléchargement gratuit compris), les packs d'un autre dans sa collection, les morceaux d'un autre dans son
-- AdReel, ou ranger son contenu dans le dossier d'un autre. upsert_album faisait déjà cette vérification
-- (20260921080000) : même règle appliquée partout ici. Vérifié avant d'écrire : aucune donnée existante ne cite
-- un élément d'un autre compositeur (lecture publique des 9 tables de liens, 0 écart) -- aucune publication
-- normale ne sera refusée. Les clés étrangères exigeaient déjà que l'élément cité existe ; seule la propriété
-- s'ajoute.
--
-- Statistiques : sans indice de compositeur (lien sans handle), un id d'AdReel ambigu ('main' existe chez tous)
-- était attribué à un compositeur pris au hasard. Désormais ignoré s'il est ambigu.

-- Refuse si un des ids cités n'existe pas dans p_table avec owner_id = p_owner. p_table est toujours un nom
-- écrit en dur par les fonctions ci-dessous (jamais une entrée utilisateur), protégé par %I de toute façon.
create or replace function public.assert_refs_owned(p_table text, p_ids text[], p_owner uuid, p_what text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bad text;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  execute format(
    'select x from unnest($1) x where not exists (select 1 from public.%I t where t.id = x and t.owner_id = $2) limit 1',
    p_table
  ) into v_bad using p_ids, p_owner;
  if v_bad is not null then
    raise exception 'Non autorisé : % « % » introuvable ou appartenant à un autre compositeur', p_what, v_bad;
  end if;
end;
$$;
revoke all on function public.assert_refs_owned(text, text[], uuid, text) from public, anon, authenticated;

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
  perform public.assert_refs_owned('sfx_library', (select coalesce(array_agg(x), array[]::text[]) from jsonb_array_elements_text(coalesce(payload->'sfxIds', '[]'::jsonb)) x), v_owner_id, 'Sfx');
  perform public.assert_refs_owned('track_folders', array_remove(array[nullif(payload->>'folderId', '')], null), v_owner_id, 'dossier');

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

create or replace function public.upsert_sfx(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sfx_id text := payload->>'id';
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_sfx_id is null or v_sfx_id = '' then raise exception 'payload.id manquant'; end if;

  select owner_id into v_existing_owner from public.sfx_library where id = v_sfx_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : ce Sfx appartient à un autre compositeur';
  end if;
  perform public.assert_refs_owned('sfx_folders', array_remove(array[nullif(payload->>'folderId', '')], null), v_owner_id, 'dossier');

  insert into public.sfx_library (id, owner_id, folder_id, title, description_fr, description_en, tag,
    rr_mode, duck_main_track, base, alternatives, spatial, updated_at)
  values (
    v_sfx_id, v_owner_id, nullif(payload->>'folderId',''), coalesce(payload->>'title',''),
    coalesce(payload->>'descriptionFr',''), coalesce(payload->>'descriptionEn',''), coalesce(payload->>'tag',''),
    payload->>'rrMode', coalesce((payload->>'duckMainTrack')::boolean,false),
    coalesce(payload->>'base',''), coalesce(payload->'alternatives','[]'::jsonb),
    nullif(payload->'spatial', 'null'::jsonb), now()
  )
  on conflict (id) do update set
    folder_id = excluded.folder_id, title = excluded.title, description_fr = excluded.description_fr,
    description_en = excluded.description_en, tag = excluded.tag, rr_mode = excluded.rr_mode,
    duck_main_track = excluded.duck_main_track, base = excluded.base, alternatives = excluded.alternatives,
    spatial = excluded.spatial, updated_at = now();

  return jsonb_build_object('ok', true, 'id', v_sfx_id);
end;
$$;

create or replace function public.upsert_pack(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack_id text := payload->>'id';
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
  v_is_admin boolean := exists (select 1 from public.admins where profile_id = auth.uid());
  v_idx int;
  v_id text;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_pack_id is null or v_pack_id = '' then raise exception 'payload.id manquant'; end if;

  select owner_id into v_existing_owner from public.packs where id = v_pack_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : ce pack appartient à un autre compositeur';
  end if;
  perform public.assert_refs_owned('tracks', (select coalesce(array_agg(x), array[]::text[]) from jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb)) x), v_owner_id, 'morceau');
  perform public.assert_refs_owned('sfx_library', (select coalesce(array_agg(x), array[]::text[]) from jsonb_array_elements_text(coalesce(payload->'sfxIds', '[]'::jsonb)) x), v_owner_id, 'Sfx');

  insert into public.packs (id, owner_id, title, illustration, illustration_original_name, watermark,
    watermark_original_name, presentation_fr, presentation_en, buyable, buy_url,
    free_download_enabled, video_test_mode_enabled, bg_color, text_color, font, linked_ad_reel_id, tags, updated_at)
  values (
    v_pack_id, v_owner_id, coalesce(payload->>'title',''), payload->>'illustration', payload->>'illustrationOriginalName',
    payload->>'watermark', payload->>'watermarkOriginalName', coalesce(payload->>'presentationFr',''),
    coalesce(payload->>'presentationEn',''),
    case when v_is_admin then coalesce((payload->>'buyable')::boolean,false) else false end,
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
    presentation_en = excluded.presentation_en,
    buyable = case when v_is_admin then excluded.buyable else public.packs.buyable end,
    buy_url = excluded.buy_url,
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

create or replace function public.upsert_collection(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_collection_id text := payload->>'id';
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
  v_idx int := 0;
  v_id text;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_collection_id is null or v_collection_id = '' then raise exception 'payload.id manquant'; end if;

  select owner_id into v_existing_owner from public.collections where id = v_collection_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : cette collection appartient à un autre compositeur';
  end if;
  perform public.assert_refs_owned('packs', (select coalesce(array_agg(x), array[]::text[]) from jsonb_array_elements_text(coalesce(payload->'packIds', '[]'::jsonb)) x), v_owner_id, 'pack');

  insert into public.collections (id, owner_id, title, illustration, illustration_original_name,
    presentation_fr, presentation_en, bg_color, text_color, font, buyable, buy_url,
    free_download_enabled, updated_at)
  values (
    v_collection_id, v_owner_id, coalesce(payload->>'title',''), payload->>'illustration',
    payload->>'illustrationOriginalName', coalesce(payload->>'presentationFr',''),
    coalesce(payload->>'presentationEn',''), payload->>'bgColor', payload->>'textColor', payload->>'font',
    coalesce((payload->>'buyable')::boolean,false), coalesce(payload->>'buyUrl',''),
    coalesce((payload->>'freeDownloadEnabled')::boolean,false), now()
  )
  on conflict (id) do update set
    title = excluded.title, illustration = excluded.illustration,
    illustration_original_name = excluded.illustration_original_name, presentation_fr = excluded.presentation_fr,
    presentation_en = excluded.presentation_en, bg_color = excluded.bg_color, text_color = excluded.text_color,
    font = excluded.font, buyable = excluded.buyable, buy_url = excluded.buy_url,
    free_download_enabled = excluded.free_download_enabled, updated_at = now();

  delete from public.collection_packs where collection_id = v_collection_id;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'packIds', '[]'::jsonb))
  loop
    insert into public.collection_packs (collection_id, pack_id, position) values (v_collection_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_collection_id);
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
  v_owner_id uuid := public.current_composer_id();
  v_idx int := 0;
  v_id text;
  v_profile jsonb := coalesce(payload->'profile', '{}'::jsonb);
  v_tier text;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_ad_reel_id is null or v_ad_reel_id = '' then raise exception 'payload.id manquant'; end if;
  perform public.assert_refs_owned('tracks', (select coalesce(array_agg(x), array[]::text[]) from jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb)) x), v_owner_id, 'morceau');
  perform public.assert_refs_owned('ad_reel_folders', array_remove(array[nullif(payload->>'folderId', '')], null), v_owner_id, 'dossier');

  -- Palier figé dans le contenu publié : décidé ICI, par le serveur, jamais lu tel quel dans le payload
  -- (avant le 23 septembre, la page l'envoyait dans profile.effectivePlan et rien ne le vérifiait : un
  -- compte Free pouvait s'attribuer "pro"). Palier RÉEL (composer_real_tier : bêta, admin, essai, plan),
  -- jamais l'aperçu admin. Seul un admin peut forcer le palier d'un AdReel (profile.adminTierOverride,
  -- vérifier son rendu public sous un autre palier) ; pour tout autre compte ce champ est retiré.
  v_tier := public.composer_real_tier(v_owner_id);
  if public.is_admin() and (v_profile->>'adminTierOverride') in ('free', 'starter', 'pro') then
    v_tier := v_profile->>'adminTierOverride';
  else
    v_profile := v_profile - 'adminTierOverride';
  end if;
  v_profile := jsonb_set(v_profile, '{effectivePlan}', to_jsonb(v_tier));

  insert into public.ad_reels (id, owner_id, folder_id, label, lang, profile, testimonials, blocks, track_overrides, allow_indexing, updated_at)
  values (
    v_ad_reel_id, v_owner_id, nullif(payload->>'folderId',''), coalesce(payload->>'label',''), coalesce(payload->>'lang','fr'),
    v_profile, coalesce(payload->'testimonials','[]'::jsonb),
    coalesce(payload->'blocks','[]'::jsonb), coalesce(payload->'trackOverrides','{}'::jsonb),
    coalesce((payload->>'allowIndexing')::boolean, true), now()
  )
  on conflict (owner_id, id) do update set
    folder_id = excluded.folder_id, label = excluded.label, lang = excluded.lang, profile = excluded.profile,
    testimonials = excluded.testimonials, blocks = excluded.blocks, track_overrides = excluded.track_overrides,
    allow_indexing = excluded.allow_indexing, updated_at = now();

  delete from public.ad_reel_tracks where owner_id = v_owner_id and ad_reel_id = v_ad_reel_id;
  for v_id in select jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb))
  loop
    insert into public.ad_reel_tracks (owner_id, ad_reel_id, track_id, position) values (v_owner_id, v_ad_reel_id, v_id, v_idx);
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_ad_reel_id);
end;
$$;

create or replace function public.log_analytics_event(
  p_entity_type text,
  p_entity_id text,
  p_session_id text,
  p_event_name text,
  p_detail jsonb default '{}'::jsonb,
  p_device text default null,
  p_owner_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_tier text;
  v_ip text;
  v_bucket text;
  v_count int;
begin
  if p_entity_type is null or p_entity_type not in ('adreel', 'pack', 'collection') then return; end if;
  if p_entity_id is null or length(p_entity_id) = 0 or length(p_entity_id) > 200 then return; end if;
  if p_session_id is null or length(p_session_id) = 0 or length(p_session_id) > 200 then return; end if;
  if p_event_name is null or length(p_event_name) = 0 or length(p_event_name) > 100 then return; end if;
  if p_device is not null and p_device not in ('mobile', 'desktop') then p_device := null; end if;

  -- p_owner_id : indice de désambiguïsation, jamais pris seul -- la ligne doit exister réellement
  -- avec CETTE combinaison (id, owner_id) quand l'indice est fourni.
  if p_entity_type = 'adreel' then
    -- id d'AdReel unique seulement par compositeur : sans indice, compté uniquement s'il n'existe que chez un
    -- seul (27/09 -- avant, `limit 1` l'attribuait à un compositeur au hasard).
    select case when count(distinct owner_id) = 1 then min(owner_id::text)::uuid end into v_owner_id
      from public.ad_reels
      where id = p_entity_id and (p_owner_id is null or owner_id = p_owner_id);
  elsif p_entity_type = 'pack' then
    select owner_id into v_owner_id from public.packs
      where id = p_entity_id and (p_owner_id is null or owner_id = p_owner_id) limit 1;
  else
    select owner_id into v_owner_id from public.collections
      where id = p_entity_id and (p_owner_id is null or owner_id = p_owner_id) limit 1;
  end if;
  if v_owner_id is null then return; end if;

  -- Les visites du compositeur lui-même ne comptent pas (23 septembre, demande de Jules-Antoine) :
  -- quand il ouvre son propre AdReel/pack connecté dans ce navigateur, la session Supabase du
  -- backstage est partagée avec les pages publiques (même origine) et l'appel arrive ici avec son
  -- identité. Exclusion côté serveur (pas côté page) : impossible à contourner par une page en cache.
  -- Limite assumée : depuis un navigateur où il n'est pas connecté, sa visite est indiscernable de
  -- celle d'un visiteur.
  if auth.uid() is not null and exists (
    select 1 from public.composer_profiles cp where cp.id = v_owner_id and cp.profile_id = auth.uid()
  ) then return; end if;

  -- Le palier est enregistré avec l'événement (colonne tier) pour que le nettoyage
  -- applique à CHAQUE événement la rétention du palier sous lequel il a été collecté.
  v_tier := public.composer_effective_tier(v_owner_id);
  if v_tier is null then return; end if;

  v_ip := coalesce(
    nullif(split_part(current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1), ''),
    p_session_id
  );
  v_bucket := v_ip || ':' || floor(extract(epoch from now()) / 60)::text;
  insert into public.analytics_write_rate_limit (bucket_key, event_count)
    values (v_bucket, 1)
    on conflict (bucket_key) do update set event_count = analytics_write_rate_limit.event_count + 1
    returning event_count into v_count;
  if v_count > 60 then return; end if;

  insert into public.analytics_events (owner_id, entity_type, entity_id, session_id, event_name, detail, device, tier)
    values (v_owner_id, p_entity_type, p_entity_id, p_session_id, p_event_name, coalesce(p_detail, '{}'::jsonb), p_device, v_tier);
end;
$$;
