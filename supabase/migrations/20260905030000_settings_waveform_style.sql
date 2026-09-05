-- LayerPitch — Chantier Apparence, palier Pro : style de forme d'onde (Barres/Miroir plein/Pointillé/
-- Vagues superposées), réglage global par compositeur.
--
-- Réglage global (pas par bloc, pas par AdReel) -- au même niveau que custom_fonts/implementation_skills
-- (settings, PK owner_id, une ligne par compositeur -- voir 20260901170000_settings_socials_per_composer.sql),
-- pas dans le profile jsonb d'un ad_reels précis, qui lui est par-AdReel.
alter table public.settings
  add column waveform_style text not null default 'bars'
  constraint settings_waveform_style_check check (waveform_style in ('bars', 'mirror', 'dots', 'layers'));

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

  insert into public.settings (owner_id, published_at, implementation_skills, no_ai_certified_global, custom_fonts, waveform_style)
  values (
    v_owner_id, (payload->>'publishedAt')::bigint,
    coalesce(payload->'implementationSkills', '{}'::jsonb),
    coalesce((payload->>'noAiCertifiedGlobal')::boolean, false),
    coalesce(payload->'customFonts', '[]'::jsonb),
    coalesce(payload->>'waveformStyle', 'bars')
  )
  on conflict (owner_id) do update set
    published_at = excluded.published_at, implementation_skills = excluded.implementation_skills,
    no_ai_certified_global = excluded.no_ai_certified_global, custom_fonts = excluded.custom_fonts,
    waveform_style = excluded.waveform_style;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.upsert_settings(jsonb) to authenticated;
