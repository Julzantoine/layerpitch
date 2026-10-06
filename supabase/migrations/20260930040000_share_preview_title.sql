-- LayerPitch — aperçu des liens partagés : titre de repli d'un AdReel sans titre (1er/10, suite de 20260930030000).
-- L'AdReel principal n'a souvent pas de titre dans son profil : l'aperçu affichait son étiquette interne « Principal ».
-- Désormais : titre du profil, sinon « étiquette · nom du compositeur » pour un AdReel secondaire, sinon le nom du
-- compositeur. Seul changement par rapport à 20260930030000 ; reste de la fonction identique.

create or replace function public.get_share_preview(p_kind text, p_handle text, p_ref text default null, p_alt text default null)
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

  if p_kind = 'adreel' then
    v_ar := coalesce(nullif(p_alt, ''), v_link ->> 'adReelId', 'main');
    select id, label, lang, profile into r from public.ad_reels where owner_id = v_owner and id = v_ar;
    if not found then return null; end if;
    v_profile := coalesce(r.profile, '{}'::jsonb);
    v_sub := nullif(trim(coalesce(v_profile ->> 'subtitle', '')), '');
    v_bio := nullif(left(trim(coalesce(v_profile ->> 'bio', '')), 300), '');
    return jsonb_build_object('kind', 'adreel',
      'title', coalesce(nullif(trim(coalesce(v_profile ->> 'title', '')), ''),
                        case when r.id <> 'main' then nullif(trim(coalesce(r.label, '')), '') || ' · ' || v_handle end, v_handle),
      'descriptionFr', coalesce(v_sub, v_bio), 'descriptionEn', coalesce(v_sub, v_bio),
      'image', coalesce(nullif(v_profile ->> 'photo', ''), nullif(v_profile ->> 'logo', '')), 'lang', coalesce(r.lang, 'fr'));
  elsif p_kind = 'pack' then
    select title, presentation_fr, presentation_en, illustration into r from public.packs where owner_id = v_owner and id = p_ref;
    if not found then return null; end if;
    return jsonb_build_object('kind', 'pack', 'title', nullif(trim(r.title), ''), 'descriptionFr', nullif(trim(coalesce(r.presentation_fr, '')), ''),
      'descriptionEn', nullif(trim(coalesce(r.presentation_en, '')), ''), 'image', nullif(r.illustration, ''), 'lang', 'fr');
  elsif p_kind = 'collection' then
    select title, presentation_fr, presentation_en, illustration into r from public.collections where owner_id = v_owner and id = p_ref;
    if not found then return null; end if;
    return jsonb_build_object('kind', 'collection', 'title', nullif(trim(r.title), ''), 'descriptionFr', nullif(trim(coalesce(r.presentation_fr, '')), ''),
      'descriptionEn', nullif(trim(coalesce(r.presentation_en, '')), ''), 'image', nullif(r.illustration, ''), 'lang', 'fr');
  end if;
  return null;
end;
$$;
grant execute on function public.get_share_preview(text, text, text, text) to anon, authenticated;
