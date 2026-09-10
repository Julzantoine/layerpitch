-- LayerPitch — upsert_album : première RPC d'écriture pour les albums (Adaptive OST), absente
-- depuis leur provisionnement le 31 juillet — aucune UI n'existait jusqu'ici pour en créer un
-- (docs/extensions-roadmap.md 5.5, "Playlists et Figer restent à finir"). Ajoutée maintenant comme
-- prérequis minimal à la page de réglages/test par défaut côté studio (backstage-adaptive-ost.html)
-- : sans ça, cette page n'aurait aucun album à afficher. Pas un vrai chantier "gestion d'album"
-- (pas d'illustration à uploader ici, pas de presentation soignée) -- le strict nécessaire pour que
-- la boucle créer -> régler les défauts -> tester soit complète.
--
-- Même convention que upsert_track/upsert_pack/upsert_ad_reel (20260831231500) : create -> le
-- compte appelant doit avoir un composer_profile, devient propriétaire ; update -> l'owner_id
-- existant doit correspondre à l'appelant ; owner_id ne change jamais après création.
create or replace function public.upsert_album(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_album_id text := payload->>'id';
  v_owner_id uuid := public.current_composer_id();
  v_existing_owner uuid;
  -- has_trackIds distingue "le payload ne parle pas des pistes" (ex. un futur appel qui ne
  -- renomme que le titre) de "le payload dit explicitement qu'il n'y en a plus" ([]) -- sans
  -- cette distinction, un appelant partiel viderait silencieusement toutes les pistes de l'album
  -- (et leurs default_settings) au lieu de ne toucher qu'au titre.
  v_has_track_ids boolean := payload ? 'trackIds';
  v_track_ids text[];
  v_idx int := 0;
  v_id text;
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;
  if v_album_id is null or v_album_id = '' then raise exception 'payload.id manquant'; end if;

  select owner_id into v_existing_owner from public.albums where id = v_album_id;
  if v_existing_owner is not null and v_existing_owner <> v_owner_id then
    raise exception 'Non autorisé : cet album appartient à un autre compositeur';
  end if;

  if v_has_track_ids then
    select coalesce(array_agg(t), array[]::text[]) into v_track_ids
    from jsonb_array_elements_text(coalesce(payload->'trackIds', '[]'::jsonb)) t;

    -- Un album ne peut contenir que des pistes de ce même compositeur -- même principe que le
    -- reste du backstage (owner_id sur tracks/packs/collections/ad_reels, 20260831231400).
    if array_length(v_track_ids, 1) > 0 then
      if exists (
        select 1 from unnest(v_track_ids) tid
        where not exists (select 1 from public.tracks tr where tr.id = tid and tr.owner_id = v_owner_id)
      ) then
        raise exception 'Non autorisé : une ou plusieurs pistes n''appartiennent pas à ce compositeur';
      end if;
    end if;
  end if;

  -- illustration/presentationFr/presentationEn : coalesce contre la valeur déjà en base
  -- (albums.<col> = valeur AVANT cette mise à jour -- qualifié explicitement, "ambiguous column
  -- reference" sinon : excluded et la table cible sont toutes deux en portée dans cette clause)
  -- plutôt qu'un écrasement systématique -- sans ça, le jour où un upload d'illustration existera
  -- (hors périmètre ici), toute sauvegarde depuis ce formulaire minimal (titre + pistes seulement)
  -- effacerait silencieusement l'illustration/la présentation déjà réglées par ailleurs. `title`
  -- reste toujours écrasé : c'est le seul champ que ce formulaire édite réellement, une absence
  -- voudrait dire un titre vide, pas "ne pas toucher".
  insert into public.albums (id, owner_id, title, illustration, illustration_original_name, presentation_fr, presentation_en, updated_at)
  values (
    v_album_id, v_owner_id, coalesce(payload->>'title',''), payload->>'illustration', payload->>'illustrationOriginalName',
    coalesce(payload->>'presentationFr',''), coalesce(payload->>'presentationEn',''), now()
  )
  on conflict (id) do update set
    title = excluded.title,
    illustration = coalesce(excluded.illustration, albums.illustration),
    illustration_original_name = coalesce(excluded.illustration_original_name, albums.illustration_original_name),
    presentation_fr = case when payload ? 'presentationFr' then excluded.presentation_fr else albums.presentation_fr end,
    presentation_en = case when payload ? 'presentationEn' then excluded.presentation_en else albums.presentation_en end,
    updated_at = now();

  if v_has_track_ids then
    -- Retire seulement les pistes qui ne font plus partie de l'album -- pas un delete-all suivi
    -- d'un reinsert complet (le pattern des autres upsert_*) : ça effacerait
    -- album_tracks.default_settings (20260910130000) même pour une piste qui reste dans l'album
    -- entre deux sauvegardes.
    delete from public.album_tracks
    where album_id = v_album_id and track_id <> all(v_track_ids);

    v_idx := 0;
    for v_id in select unnest(v_track_ids)
    loop
      insert into public.album_tracks (album_id, track_id, position) values (v_album_id, v_id, v_idx)
      on conflict (album_id, track_id) do update set position = excluded.position;
      v_idx := v_idx + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'id', v_album_id);
end;
$$;

grant execute on function public.upsert_album(jsonb) to authenticated;
