-- LayerPitch — bandeau d'annonce, structure ouverte au nombre de langues (retour de Jules-Antoine,
-- 3 septembre, après la migration bilingue précédente 20260903230000) : "on aurait dû y réfléchir
-- plus tôt et créer des colonnes/fichiers capables d'accueillir de prochaines langues" — le
-- backstage n'est aujourd'hui qu'en FR/EN, mais rien ne garantit que ça reste vrai indéfiniment
-- (espagnol, allemand, etc., mentionné comme piste future, pas de décision ni calendrier).
--
-- notice_message_fr/notice_message_en (deux colonnes fixes) remplacés par notice_messages (jsonb,
-- une clé par code langue, ex. {"fr": "...", "en": "..."}) — ajouter une langue au bandeau devient
-- un ajout de clé, plus jamais une migration de schéma. Aucun message réel encore publié en
-- production (vidé par le script de test) — migration sûre, pas de backfill nécessaire.
--
-- Pas étendu au reste du site (layerpitch-i18n.js, structure { fr: {...}, en: {...} } utilisée par
-- index.html/pack.html/player.js/layerpitch-backstage.html/video-test.html/admin.html) : chantier
-- bien plus large (6 fichiers, sélecteur de langue, zones de traduction), volontairement pas repris
-- ici tant qu'une vraie troisième langue n'est pas décidée. Documenté pour le jour où ce chantier
-- sera lancé : reprendre le même principe (carte extensible plutôt que colonnes/zones figées) —
-- voir docs/infrastructure.md.

alter table public.platform_settings drop column notice_message_fr;
alter table public.platform_settings drop column notice_message_en;
alter table public.platform_settings add column notice_messages jsonb not null default '{}'::jsonb;
comment on column public.platform_settings.notice_messages is 'Bandeau d''annonce, une clé par code langue (ex. {"fr": "...", "en": "..."}) — ajouter une langue = ajouter une clé, jamais une migration. Repli sur la clé "fr" côté lecture (layerpitch-backstage.html) si la langue du compte n''a pas de message, même convention que layerpitch-i18n.js.';

create or replace function public.set_platform_notice(p_messages jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  if jsonb_typeof(p_messages) is distinct from 'object' then
    raise exception 'p_messages doit être un objet JSON (une clé par code langue)';
  end if;

  update public.platform_settings
    set notice_messages = p_messages, notice_updated_at = now()
    where id = true;
end;
$$;
-- L'ancienne signature à deux paramètres fixes (fr, en) n'a plus d'appelant (admin.html/api/admin.js
-- mis à jour dans le même commit) — supprimée pour éviter une fonction fantôme avec la même autorisation.
drop function if exists public.set_platform_notice(text, text);
grant execute on function public.set_platform_notice(jsonb) to authenticated;
