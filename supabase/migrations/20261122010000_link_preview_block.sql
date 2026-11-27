-- LayerPitch — bloc invisible « Aperçu du lien » des AdReels (22/11).
--
-- Un AdReel peut porter un bloc { type: 'linkpreview', title, description, image, ... } (dans ad_reels.blocks, aucune nouvelle
-- colonne) : il n'apparaît pas sur la page publique, il règle seulement la carte qu'affichent les messageries quand on colle le lien
-- de CET AdReel. Priorité de get_share_preview pour un AdReel : bloc, puis réglage du compte (settings.share_preview, rubrique
-- Réseaux sociaux), puis profil (titre/sous-titre/bio, photo/logo). L'image du bloc n'est reprise que si elle est rangée dans le
-- dossier du compositeur (<son id>/...), comme toutes les images envoyées par le Backstage.
-- get_share_preview_unfiltered est recopiée de 20260930050000 (avant le renommage de 20261006010000) avec ce seul ajout ;
-- get_share_preview (le contrôle d'accès) est inchangée. Seul l'ajout d'un bloc est réservé à l'admin jusqu'au feu vert :
--   select public.set_feature_released('adreel_link_preview_block', true);
insert into public.feature_flags (key, description) values
  ('adreel_link_preview_block', 'Bloc invisible « Aperçu du lien » des AdReels (22/11) — bouton d''ajout du Backstage, admin seulement jusqu''au feu vert.')
on conflict (key) do nothing;

create or replace function public.get_share_preview_unfiltered(p_kind text, p_handle text, p_ref text default null, p_alt text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link jsonb;
  v_owner uuid;
  v_handle text;
  v_ar text;
  r record;
  v_profile jsonb;
  v_sub text;
  v_bio text;
  v_sp jsonb;
  v_sp_title text;
  v_sp_desc text;
  v_sp_image text;
  v_blk jsonb;
  v_blk_image text;
begin
  if p_kind = 'album' then
    select title, presentation_fr, presentation_en, illustration into r
      from public.albums where id = p_ref and buyable;
    if not found then return null; end if;
    return jsonb_build_object('kind', 'album', 'title', nullif(trim(r.title), ''), 'descriptionFr', nullif(trim(coalesce(r.presentation_fr, '')), ''),
      'descriptionEn', nullif(trim(coalesce(r.presentation_en, '')), ''), 'image', nullif(r.illustration, ''), 'lang', 'fr');
  end if;

  v_link := public.resolve_public_link(p_handle, case when p_kind = 'adreel' then p_ref else '' end);
  if v_link is null then return null; end if;
  v_owner := (v_link ->> 'ownerId')::uuid;
  v_handle := v_link ->> 'handle';
  -- Champs « Aperçu des liens partagés » du Backstage (réseaux sociaux) : titre, description, image choisis par le compositeur.
  select coalesce(share_preview, '{}'::jsonb) into v_sp from public.settings where owner_id = v_owner;
  v_sp := coalesce(v_sp, '{}'::jsonb);
  v_sp_title := nullif(trim(coalesce(v_sp ->> 'title', '')), '');
  v_sp_desc := nullif(trim(coalesce(v_sp ->> 'description', '')), '');
  v_sp_image := nullif(v_sp ->> 'image', '');

  if p_kind = 'adreel' then
    v_ar := coalesce(nullif(p_alt, ''), v_link ->> 'adReelId', 'main');
    select id, label, lang, profile, blocks into r from public.ad_reels where owner_id = v_owner and id = v_ar;
    if not found then return null; end if;
    v_profile := coalesce(r.profile, '{}'::jsonb);
    v_sub := nullif(trim(coalesce(v_profile ->> 'subtitle', '')), '');
    v_bio := nullif(left(trim(coalesce(v_profile ->> 'bio', '')), 300), '');
    -- Bloc « Aperçu du lien » de cet AdReel (le premier, s'il y en avait plusieurs) : passe avant le réglage du compte.
    select b into v_blk from jsonb_array_elements(case when jsonb_typeof(r.blocks) = 'array' then r.blocks else '[]'::jsonb end) b
      where b ->> 'type' = 'linkpreview' limit 1;
    if v_blk is not null then
      v_sp_title := coalesce(nullif(trim(coalesce(v_blk ->> 'title', '')), ''), v_sp_title);
      v_sp_desc := coalesce(nullif(trim(coalesce(v_blk ->> 'description', '')), ''), v_sp_desc);
      v_blk_image := nullif(v_blk ->> 'image', '');
      if v_blk_image is not null and v_blk_image like (v_owner::text || '/%') and v_blk_image not like '%..%' then
        v_sp_image := v_blk_image;
      end if;
    end if;
    return jsonb_build_object('kind', 'adreel',
      'title', coalesce(v_sp_title, nullif(trim(coalesce(v_profile ->> 'title', '')), ''),
                        case when r.id <> 'main' then nullif(trim(coalesce(r.label, '')), '') || ' · ' || v_handle end, v_handle),
      'descriptionFr', coalesce(v_sp_desc, v_sub, v_bio), 'descriptionEn', coalesce(v_sp_desc, v_sub, v_bio),
      'image', coalesce(v_sp_image, nullif(v_profile ->> 'photo', ''), nullif(v_profile ->> 'logo', '')), 'lang', coalesce(r.lang, 'fr'));
  elsif p_kind = 'pack' then
    select title, presentation_fr, presentation_en, illustration into r from public.packs where owner_id = v_owner and id = p_ref;
    if not found then return null; end if;
    return jsonb_build_object('kind', 'pack', 'title', nullif(trim(r.title), ''), 'descriptionFr', nullif(trim(coalesce(r.presentation_fr, '')), ''),
      'descriptionEn', nullif(trim(coalesce(r.presentation_en, '')), ''), 'image', coalesce(nullif(r.illustration, ''), v_sp_image), 'lang', 'fr');
  elsif p_kind = 'collection' then
    select title, presentation_fr, presentation_en, illustration into r from public.collections where owner_id = v_owner and id = p_ref;
    if not found then return null; end if;
    return jsonb_build_object('kind', 'collection', 'title', nullif(trim(r.title), ''), 'descriptionFr', nullif(trim(coalesce(r.presentation_fr, '')), ''),
      'descriptionEn', nullif(trim(coalesce(r.presentation_en, '')), ''), 'image', coalesce(nullif(r.illustration, ''), v_sp_image), 'lang', 'fr');
  end if;
  return null;
end;
$$;
-- Comme à 20261006010000 : la fonction non filtrée n'est appelable que par l'autre (get_share_preview).
revoke execute on function public.get_share_preview_unfiltered(text, text, text, text) from public, anon, authenticated;
