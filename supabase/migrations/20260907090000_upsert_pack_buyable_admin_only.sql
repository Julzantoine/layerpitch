-- Corrige upsert_pack (dernière version : 20260831231500_composer_ownership_rpc.sql) : "buyable"
-- ne doit pouvoir être activé/désactivé que par un compte admin, jamais par le compositeur
-- propriétaire du pack lui-même -- demandé le 7 septembre pour qu'un bêta testeur ne puisse pas
-- mettre son propre pack en vente. La case à cocher du backstage n'était qu'une barrière côté
-- interface (facile à contourner en appelant la RPC directement) -- la vraie barrière doit être ici,
-- même principe que is_admin()/RLS pour tout le reste de ce projet (jamais une vérification client
-- seule, docs/infrastructure.md).
--
-- RESTRICTION DE BÊTA UNIQUEMENT, PAS UNE RÈGLE DÉFINITIVE (confirmé le 7 septembre) : à l'ouverture
-- officielle, chaque compositeur doit pouvoir choisir lui-même de vendre ou non ses packs -- il
-- faudra alors une nouvelle migration qui retire la condition `v_is_admin` ci-dessous (retour au
-- comportement d'origine, buyable piloté par le payload du compositeur) et retirer le `disabled`
-- correspondant + le message "bêta" dans layerpitch-backstage.html/layerpitch-i18n.js
-- (buyableAdminOnlyHint). Ne pas traiter ce verrou comme une décision produit permanente.
--
-- Comportement : un appelant non-admin qui republie son pack garde la valeur `buyable` déjà en
-- base (aucun changement, même si son payload local en contient une différente) ; une création de
-- pack par un non-admin part toujours à `false`. Un admin garde l'usage actuel (valeur du payload
-- appliquée telle quelle) -- aucun panneau construit pour lui à ce stade, seule une mise à jour SQL
-- directe permet aujourd'hui de vraiment mettre un pack en vente, comme c'est déjà le cas.
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
