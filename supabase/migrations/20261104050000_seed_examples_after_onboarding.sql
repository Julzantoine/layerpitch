-- LayerPitch — exemples préchargés : ajout seulement APRÈS l'accueil (4 novembre 2026).
--
-- mark_onboarding_complete() (migration 20261104020000_welcome_messages_refresh) ne dépose le message de bienvenue que si la
-- boîte de réception n'a encore aucun message personnel. seed_my_examples() dépose le message des exemples : s'il passait
-- avant l'accueil (Backstage ouvert avant la fin de bienvenue.html), la bienvenue ne serait jamais déposée. On attend donc
-- profiles.onboarding_completed ; le chargement suivant du Backstage fait l'ajout. Seule différence avec la version de
-- 20261104020000_example_content_and_onboarding_profile.sql : ce test.

create or replace function public.seed_my_examples(p_lang text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.current_composer_id();
  v_seeded timestamptz;
  v_lang text;
  v_track_folder text;
  v_sfx_folder text;
  v_pack text;
  v_adreel text;
  v_sfx_map jsonb := '{}'::jsonb;     -- id source → id copie
  v_slot_map jsonb;
  v_track_ids text[] := '{}';
  v_sfx_ids text[] := '{}';
  v_row record;
  v_slot record;
  v_new_id text;
  v_txt text;
  v_k text;
  v_v text;
  v_pos int;
  v_tpl record;
begin
  if v_owner is null then return jsonb_build_object('skipped', 'no_composer'); end if;
  if not public.feature_released('example_content', auth.uid()) then return jsonb_build_object('skipped', 'flag'); end if;
  -- Après l'accueil seulement (4/11) : mark_onboarding_complete() ne dépose la bienvenue que dans une boîte sans message
  -- personnel ; le message des exemples arrivé avant l'empêcherait. Le chargement suivant du Backstage fera l'ajout.
  if not coalesce((select onboarding_completed from public.profiles where id = auth.uid()), false) then
    return jsonb_build_object('skipped', 'onboarding');
  end if;
  -- Verrou de la ligne : deux onglets ouverts en même temps ne copient pas deux fois.
  select examples_seeded_at into v_seeded from public.composer_profiles where id = v_owner for update;
  if v_seeded is not null then return jsonb_build_object('skipped', 'done'); end if;
  update public.composer_profiles set examples_seeded_at = now() where id = v_owner;

  v_lang := lower(coalesce(nullif(btrim(p_lang), ''), (select lang from public.profiles where id = auth.uid()), 'fr'));

  -- Dossiers « Exemples », en tête de liste.
  v_track_folder := public.example_new_id();
  insert into public.track_folders (id, label, owner_id, position, example_source_id)
    values (v_track_folder, public.example_text('folder', v_lang), v_owner,
            coalesce((select min(position) from public.track_folders where owner_id = v_owner), 0) - 1, 'example-folder');
  v_sfx_folder := public.example_new_id();
  insert into public.sfx_folders (id, label, owner_id, position, example_source_id)
    values (v_sfx_folder, public.example_text('folder', v_lang), v_owner,
            coalesce((select min(position) from public.sfx_folders where owner_id = v_owner), 0) - 1, 'example-folder');

  -- Sfx (avant les morceaux : les morceaux s'y attachent). Même base que la source : aucun fichier copié.
  for v_row in
    select s.*, c.titles from public.example_catalog c join public.sfx_library s on s.id = c.source_id
    where c.kind = 'sfx' and s.retired_at is null order by c.position
  loop
    v_new_id := public.example_new_id();
    v_sfx_map := v_sfx_map || jsonb_build_object(v_row.id, v_new_id);
    v_sfx_ids := v_sfx_ids || v_new_id;
    insert into public.sfx_library
      select (jsonb_populate_record(null::public.sfx_library,
        (to_jsonb(v_row) - 'titles') || jsonb_build_object(
          'id', v_new_id, 'owner_id', v_owner, 'folder_id', v_sfx_folder, 'example_source_id', v_row.id,
          'title', coalesce(v_row.titles->>v_lang, v_row.titles->>'en', v_row.title),
          'protected', false, 'retired_at', null, 'created_at', now(), 'updated_at', now()))).*;
  end loop;

  -- Morceaux : nouvelles fiches, nouveaux emplacements (séquentiel) ; les références internes (emplacements, Sfx) sont
  -- redirigées par remplacement de l'id entre guillemets dans le JSON (ids longs et uniques).
  for v_row in
    select t.*, c.titles, c.position as cat_pos from public.example_catalog c join public.tracks t on t.id = c.source_id
    where c.kind = 'track' and t.retired_at is null order by c.position
  loop
    v_new_id := public.example_new_id();
    v_track_ids := v_track_ids || v_new_id;
    v_slot_map := '{}'::jsonb;
    for v_slot in select id from public.segment_slots where track_id = v_row.id loop
      v_slot_map := v_slot_map || jsonb_build_object(v_slot.id, public.example_new_id());
    end loop;
    v_txt := ((to_jsonb(v_row) - 'titles' - 'cat_pos') || jsonb_build_object(
      'id', v_new_id, 'owner_id', v_owner, 'folder_id', v_track_folder, 'example_source_id', v_row.id,
      'title', coalesce(v_row.titles->>v_lang, v_row.titles->>'en', v_row.title),
      'protected', false, 'retired_at', null, 'created_at', now(), 'updated_at', now()))::text;
    for v_k, v_v in select key, value from jsonb_each_text(v_slot_map || v_sfx_map) loop
      v_txt := replace(v_txt, '"' || v_k || '"', '"' || v_v || '"');
    end loop;
    insert into public.tracks select (jsonb_populate_record(null::public.tracks, v_txt::jsonb)).*;

    for v_slot in select * from public.segment_slots where track_id = v_row.id order by position loop
      v_txt := (to_jsonb(v_slot) || jsonb_build_object('track_id', v_new_id, 'created_at', now()))::text;
      for v_k, v_v in select key, value from jsonb_each_text(v_slot_map || v_sfx_map) loop
        v_txt := replace(v_txt, '"' || v_k || '"', '"' || v_v || '"');
      end loop;
      insert into public.segment_slots select (jsonb_populate_record(null::public.segment_slots, v_txt::jsonb)).*;
    end loop;
    insert into public.segment_slot_transitions (from_slot_id, target_slot_id, label, transition, position, fx_actions)
      select v_slot_map->>x.from_slot_id, v_slot_map->>x.target_slot_id, x.label, x.transition, x.position, x.fx_actions
      from public.segment_slot_transitions x join public.segment_slots s on s.id = x.from_slot_id
      where s.track_id = v_row.id and v_slot_map ? x.target_slot_id;
    -- Sfx attachés : seulement ceux copiés (un Sfx source hors catalogue n'est pas à la personne).
    insert into public.track_sfx (track_id, sfx_id, position)
      select v_new_id, v_sfx_map->>ts.sfx_id, ts.position from public.track_sfx ts
      where ts.track_id = v_row.id and v_sfx_map ? ts.sfx_id;
  end loop;

  -- AdReel « Démo » (privé, à côté de l'AdReel principal, jamais à sa place).
  v_adreel := public.example_new_id();
  insert into public.ad_reels (id, owner_id, label, lang, profile, access_mode, allow_indexing, example_source_id)
    values (v_adreel, v_owner, public.example_text('adreel', v_lang), case when v_lang = 'fr' then 'fr' else 'en' end,
            jsonb_build_object('title', public.example_text('adreel', v_lang), 'bio', public.example_text('bio', v_lang),
                               'effectivePlan', public.composer_real_tier(v_owner)),
            'example', false, 'example-adreel');
  v_pos := 0;
  foreach v_k in array v_track_ids loop
    insert into public.ad_reel_tracks (owner_id, ad_reel_id, track_id, position) values (v_owner, v_adreel, v_k, v_pos);
    v_pos := v_pos + 1;
  end loop;

  -- Pack d'exemple : les 6 morceaux + les 3 Sfx.
  v_pack := public.example_new_id();
  insert into public.packs (id, owner_id, title, catalog_listed, example_source_id)
    values (v_pack, v_owner, public.example_text('pack', v_lang), false, 'example-pack');
  insert into public.pack_tracks (pack_id, track_id, position) select v_pack, t, o - 1 from unnest(v_track_ids) with ordinality u(t, o);
  insert into public.pack_sfx (pack_id, sfx_id, position) select v_pack, s, o - 1 from unnest(v_sfx_ids) with ordinality u(s, o);

  -- Message de la boîte de réception (personnel, sans e-mail).
  select * into v_tpl from public.platform_message_templates where key = 'examples';
  if found then
    insert into public.admin_messages (body, title, recipient_id) values (v_tpl.body, v_tpl.title, auth.uid());
  end if;

  return jsonb_build_object('seeded', true, 'tracks', coalesce(array_length(v_track_ids, 1), 0), 'sfx', coalesce(array_length(v_sfx_ids, 1), 0),
                            'adReelId', v_adreel, 'packId', v_pack);
end;
$$;
revoke execute on function public.seed_my_examples(text) from public, anon;
grant execute on function public.seed_my_examples(text) to authenticated;
