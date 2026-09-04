-- LayerPitch — bandeau d'annonce bilingue (retour de Jules-Antoine après premier test réel du
-- panneau admin, 3 septembre) : notice_message unique remplacé par un message par langue, affiché
-- selon la langue choisie par chaque compte dans son backstage (localStorage layerpitch_lang),
-- même principe que layerpitch-i18n.js pour l'habillage du site. Aucun message réel n'a encore été
-- publié en production (champ vidé par le script de test après chaque passage) — migration sûre,
-- pas de backfill nécessaire.

alter table public.platform_settings drop column notice_message;
alter table public.platform_settings add column notice_message_fr text;
alter table public.platform_settings add column notice_message_en text;
comment on column public.platform_settings.notice_message_fr is 'Bandeau d''annonce, version française — affiché aux comptes dont le backstage est en français (repli sur notice_message_en si vide).';
comment on column public.platform_settings.notice_message_en is 'Bandeau d''annonce, version anglaise — affiché aux comptes dont le backstage est en anglais (repli sur notice_message_fr si vide).';

create or replace function public.set_platform_notice(p_message_fr text, p_message_en text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;

  update public.platform_settings
    set notice_message_fr = nullif(p_message_fr, ''), notice_message_en = nullif(p_message_en, ''), notice_updated_at = now()
    where id = true;
end;
$$;
-- L'ancienne signature à un seul paramètre n'a plus d'appelant (admin.html/api/admin.js mis à jour
-- dans le même commit) — supprimée pour éviter une fonction fantôme avec la même autorisation.
drop function if exists public.set_platform_notice(text);
grant execute on function public.set_platform_notice(text, text) to authenticated;
