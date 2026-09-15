-- LayerPitch — réglage "Indexable par les moteurs de recherche", par AdReel (pas par compositeur,
-- pas sur packs/collections -- décision du 15/09, voir layerpitch-backstage.html "section Partage" :
-- le vrai cas d'usage est un AdReel de démo envoyé à un seul prospect qui ne doit pas apparaître à
-- côté de l'AdReel principal public dans une recherche Google, pas un interrupteur global. Un pack
-- peut être rattaché à plusieurs AdReels (voir upsert_ad_reel/reshapeAdReel) -- ne dépend donc pas de
-- ce réglage : l'indexation d'un pack ne doit pas se désactiver juste parce qu'UN des AdReels qui le
-- montre est en démo privée.
--
-- Défaut : true (indexé) -- ne rien changer au comportement actuel de tout AdReel déjà publié tant
-- que le compositeur n'a pas explicitement décoché ce réglage sur un AdReel précis.
alter table public.ad_reels
  add column allow_indexing boolean not null default true;

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
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_ad_reel_id is null or v_ad_reel_id = '' then raise exception 'payload.id manquant'; end if;

  insert into public.ad_reels (id, owner_id, folder_id, label, lang, profile, testimonials, blocks, track_overrides, allow_indexing, updated_at)
  values (
    v_ad_reel_id, v_owner_id, nullif(payload->>'folderId',''), coalesce(payload->>'label',''), coalesce(payload->>'lang','fr'),
    coalesce(payload->'profile','{}'::jsonb), coalesce(payload->'testimonials','[]'::jsonb),
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

grant execute on function public.upsert_ad_reel(jsonb) to authenticated;
