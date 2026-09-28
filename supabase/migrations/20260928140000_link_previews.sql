-- LayerPitch — espace Projet, étape 2 (cadrage du 28/09 §5) : aperçus des liens et sites fréquents sans aperçu.
--
--   * project_assets.preview (colonne créée à l'étape 1) est rempli par l'Edge Function link-preview, qui n'interroge
--     QUE les services connus (YouTube, Vimeo, SoundCloud, Spotify, Deezer, Bandcamp) : jamais une adresse quelconque
--     (sinon on pourrait faire visiter au serveur des adresses internes). La fonction écrit avec la clé de service.
--   * project_link_domains : chaque lien collé vers un site SANS aperçu est compté par site (nom de domaine seul, jamais
--     l'adresse complète) et par Projet. Le tableau de bord admin liste les sites qui reviennent le plus (« artstation.com :
--     14 liens dans 5 Projets ») ; les ajouter à la liste reste une décision manuelle (code de link-preview + la fonction
--     project_link_has_preview ci-dessous, à tenir identiques).

-- Sites dont link-preview sait faire un aperçu (même liste que supabase/functions/link-preview/index.ts).
create or replace function public.project_link_has_preview(p_domain text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_domain, '') ~ '(^|\.)(youtube\.com|youtu\.be|vimeo\.com|soundcloud\.com|spotify\.com|deezer\.com|deezer\.page\.link|bandcamp\.com)$'
$$;

-- Nom de domaine d'un lien, sans « www. » (NULL si l'adresse n'en a pas).
create or replace function public.link_domain(p_url text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(substring(coalesce(p_url, '') from '^https?://([^/?#:@]+)')), '^www\.', ''), '')
$$;

create table public.project_link_domains (
  domain text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  links int not null default 0,
  last_seen_at timestamptz not null default now(),
  primary key (domain, project_id)
);
alter table public.project_link_domains enable row level security;

create or replace function public.count_project_link_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_domain text := public.link_domain(new.url);
begin
  if new.kind = 'link' and v_domain is not null and not public.project_link_has_preview(v_domain) then
    insert into public.project_link_domains (domain, project_id, links) values (v_domain, new.project_id, 1)
    on conflict (domain, project_id) do update set links = public.project_link_domains.links + 1, last_seen_at = now();
  end if;
  return new;
end;
$$;
create trigger project_assets_count_link_domain after insert on public.project_assets
  for each row execute function public.count_project_link_domain();

-- Liens déjà présents (étape 1) : comptés une fois.
insert into public.project_link_domains (domain, project_id, links)
select public.link_domain(url), project_id, count(*) from public.project_assets
where kind = 'link' and public.link_domain(url) is not null and not public.project_link_has_preview(public.link_domain(url))
group by 1, 2;

-- Tableau de bord admin : sites sans aperçu les plus fréquents.
create or replace function public.admin_link_domains_without_preview(p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Non autorisé : réservé aux admins'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('domain', domain, 'links', links, 'projects', projects, 'lastSeenAt', last_seen) order by links desc, domain), '[]'::jsonb)
    from (select domain, sum(links)::int as links, count(*)::int as projects, max(last_seen_at) as last_seen
          from public.project_link_domains group by domain order by 2 desc, 1 limit greatest(1, least(coalesce(p_limit, 20), 100))) d);
end;
$$;
revoke execute on function public.admin_link_domains_without_preview(int) from public, anon;
grant execute on function public.admin_link_domains_without_preview(int) to authenticated;
revoke execute on function public.count_project_link_domain() from public, anon, authenticated;
