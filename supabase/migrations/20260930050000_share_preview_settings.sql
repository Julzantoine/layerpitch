-- LayerPitch — champs « Aperçu des liens partagés » (1er/10). Beaucoup de compositeurs mettent leur image dans le bloc Header et
-- n'ont ni photo ni titre dans le profil : l'aperçu LinkedIn/Facebook/WhatsApp tombait sur le nom du compositeur et une image
-- LayerPitch. Le Backstage (rubrique Réseaux sociaux) propose maintenant un titre, une description et une image dédiés, rangés
-- dans settings.share_preview = { title, description, image, imageOriginalName } (image = chemin sous images/).
--   * AdReels : ces champs passent avant le profil (titre, sous-titre/bio, photo/logo) ;
--   * packs et collections : leur propre titre et description, et cette image seulement en repli s'ils n'ont pas d'illustration.
-- upsert_settings est recopiée de 20260907110000 avec ce seul ajout ; get_share_preview de 20260930040000 avec les repères v_sp_*.

alter table public.settings add column if not exists share_preview jsonb not null default '{}'::jsonb;

create or replace function public.upsert_settings(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public.current_composer_id();
begin
  if v_owner_id is null then
    raise exception 'Non autorisé : aucun profil compositeur associé à ce compte';
  end if;

  insert into public.settings (owner_id, published_at, implementation_skills, no_ai_certified_global, custom_fonts, waveform_style, seq_map_theme, allow_embedding, share_preview)
  values (
    v_owner_id, (payload->>'publishedAt')::bigint,
    coalesce(payload->'implementationSkills', '{}'::jsonb),
    coalesce((payload->>'noAiCertifiedGlobal')::boolean, false),
    coalesce(payload->'customFonts', '[]'::jsonb),
    coalesce(payload->>'waveformStyle', 'bars'),
    coalesce(payload->>'seqMapTheme', 'light'),
    coalesce((payload->>'allowEmbedding')::boolean, false),
    coalesce(payload->'sharePreview', '{}'::jsonb)
  )
  on conflict (owner_id) do update set
    published_at = excluded.published_at, implementation_skills = excluded.implementation_skills,
    no_ai_certified_global = excluded.no_ai_certified_global, custom_fonts = excluded.custom_fonts,
    waveform_style = excluded.waveform_style, seq_map_theme = excluded.seq_map_theme,
    allow_embedding = excluded.allow_embedding, share_preview = excluded.share_preview;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.upsert_settings(jsonb) to authenticated;

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
  v_sp jsonb;
  v_sp_title text;
  v_sp_desc text;
  v_sp_image text;
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
    select id, label, lang, profile into r from public.ad_reels where owner_id = v_owner and id = v_ar;
    if not found then return null; end if;
    v_profile := coalesce(r.profile, '{}'::jsonb);
    v_sub := nullif(trim(coalesce(v_profile ->> 'subtitle', '')), '');
    v_bio := nullif(left(trim(coalesce(v_profile ->> 'bio', '')), 300), '');
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
grant execute on function public.get_share_preview(text, text, text, text) to anon, authenticated;
