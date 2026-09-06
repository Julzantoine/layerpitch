-- LayerPitch — Chantier Apparence, palier Pro : thème (Clair/Sombre) de la carte des chemins, réglage
-- global par compositeur, même principe que waveform_style (20260905030000_settings_waveform_style.sql).
--
-- Réglage global (pas par bloc, pas par AdReel) -- au même niveau que custom_fonts/implementation_skills/
-- waveform_style (settings, PK owner_id, une ligne par compositeur), pas dans le profile jsonb d'un
-- ad_reels précis, qui lui est par-AdReel.
alter table public.settings
  add column seq_map_theme text not null default 'light'
  constraint settings_seq_map_theme_check check (seq_map_theme in ('light', 'dark'));

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

  insert into public.settings (owner_id, published_at, implementation_skills, no_ai_certified_global, custom_fonts, waveform_style, seq_map_theme)
  values (
    v_owner_id, (payload->>'publishedAt')::bigint,
    coalesce(payload->'implementationSkills', '{}'::jsonb),
    coalesce((payload->>'noAiCertifiedGlobal')::boolean, false),
    coalesce(payload->'customFonts', '[]'::jsonb),
    coalesce(payload->>'waveformStyle', 'bars'),
    coalesce(payload->>'seqMapTheme', 'light')
  )
  on conflict (owner_id) do update set
    published_at = excluded.published_at, implementation_skills = excluded.implementation_skills,
    no_ai_certified_global = excluded.no_ai_certified_global, custom_fonts = excluded.custom_fonts,
    waveform_style = excluded.waveform_style, seq_map_theme = excluded.seq_map_theme;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.upsert_settings(jsonb) to authenticated;
