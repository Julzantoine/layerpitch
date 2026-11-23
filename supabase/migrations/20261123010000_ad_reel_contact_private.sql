-- Sécurité (audit du 16/11, I1) : l'e-mail de contact d'un AdReel n'est plus public.
--
-- Avant : profile.contactEmail vivait dans ad_reels.profile, lisible par n'importe qui (règle « public read » + select *),
-- et affiché en clair en bas de chaque AdReel. Une seule requête suffisait à récupérer l'adresse de tous les
-- compositeurs. Décision de Jules-Antoine (17/11) : la cacher. Le formulaire de contact continue de fonctionner
-- (submit-contact-message retrouve l'adresse côté serveur).
--
-- Après :
--  - l'adresse vit dans ad_reel_contacts, lisible seulement par le compositeur propriétaire (Backstage) ;
--  - profile ne garde qu'un drapeau public « hasContact » (le bloc Contact sait s'il doit s'afficher) ;
--  - TOUS les chemins d'écriture restent inchangés : un déclencheur sort contactEmail du profil à chaque enregistrement
--    (upsert_ad_reel, import par assistant, copies d'exemples…) et le range dans la table privée. Profil sans la clé
--    contactEmail = adresse existante conservée.

create table if not exists public.ad_reel_contacts (
  owner_id uuid not null references public.composer_profiles(id) on delete cascade,
  ad_reel_id text not null,
  email text not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, ad_reel_id)
);
alter table public.ad_reel_contacts enable row level security;
drop policy if exists "owner read" on public.ad_reel_contacts;
create policy "owner read" on public.ad_reel_contacts for select using (owner_id = public.current_composer_id());
-- Aucune règle d'écriture : seul le déclencheur ci-dessous (droits du propriétaire de la base) écrit.
revoke all on public.ad_reel_contacts from anon;
grant select on public.ad_reel_contacts to authenticated;

create or replace function public.ad_reels_contact_private()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_has boolean;
begin
  if new.profile is null or jsonb_typeof(new.profile) <> 'object' then
    return new;
  end if;
  if new.profile ? 'contactEmail' then
    v_email := btrim(coalesce(new.profile ->> 'contactEmail', ''));
    if v_email <> '' then
      insert into public.ad_reel_contacts (owner_id, ad_reel_id, email, updated_at)
      values (new.owner_id, new.id, left(v_email, 320), now())
      on conflict (owner_id, ad_reel_id) do update set email = excluded.email, updated_at = now();
    else
      delete from public.ad_reel_contacts where owner_id = new.owner_id and ad_reel_id = new.id;
    end if;
  end if;
  -- AdReel renommé (id changé) : l'adresse suit.
  if tg_op = 'UPDATE' and (old.id <> new.id or old.owner_id <> new.owner_id) and not (new.profile ? 'contactEmail') then
    update public.ad_reel_contacts set owner_id = new.owner_id, ad_reel_id = new.id
      where owner_id = old.owner_id and ad_reel_id = old.id;
  end if;
  select exists (select 1 from public.ad_reel_contacts where owner_id = new.owner_id and ad_reel_id = new.id) into v_has;
  new.profile := (new.profile - 'contactEmail') || jsonb_build_object('hasContact', v_has);
  return new;
end;
$$;
revoke all on function public.ad_reels_contact_private() from public, anon, authenticated;

create or replace function public.ad_reels_contact_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.ad_reel_contacts where owner_id = old.owner_id and ad_reel_id = old.id;
  return old;
end;
$$;
revoke all on function public.ad_reels_contact_cleanup() from public, anon, authenticated;

-- Reprise de l'existant AVANT le déclencheur : adresses déplacées, profils nettoyés.
insert into public.ad_reel_contacts (owner_id, ad_reel_id, email)
select owner_id, id, left(btrim(profile ->> 'contactEmail'), 320)
from public.ad_reels
where jsonb_typeof(profile) = 'object' and btrim(coalesce(profile ->> 'contactEmail', '')) <> ''
on conflict (owner_id, ad_reel_id) do update set email = excluded.email;

update public.ad_reels a
set profile = (a.profile - 'contactEmail') || jsonb_build_object('hasContact',
  exists (select 1 from public.ad_reel_contacts c where c.owner_id = a.owner_id and c.ad_reel_id = a.id))
where jsonb_typeof(a.profile) = 'object' and (a.profile ? 'contactEmail' or not (a.profile ? 'hasContact'));

drop trigger if exists ad_reels_contact_private on public.ad_reels;
create trigger ad_reels_contact_private
  before insert or update on public.ad_reels
  for each row execute function public.ad_reels_contact_private();

drop trigger if exists ad_reels_contact_cleanup on public.ad_reels;
create trigger ad_reels_contact_cleanup
  after delete on public.ad_reels
  for each row execute function public.ad_reels_contact_cleanup();
