-- LayerPitch — Annuaire orienté studios, étape 1 (30/10, décisions de Jules-Antoine après les retours de bêta).
--
--   * Tags façon « compétences LinkedIn » : une liste commune aux compositeurs (Mon compte) et aux studios (filtre de l'annuaire).
--     Un tag inconnu est créé à la saisie et devient disponible pour tous. Plus de limite à 12 : 100 par compositeur (anti-abus).
--     Un seul tag pour « RPG », « rpg » et « R.P.G » (directory_tag_key : casse, accents, ponctuation). Les variantes et traductions
--     sont des alias (merged_into) : « Électronique » donne « Electronic ». Un admin peut retirer ou fusionner un tag.
--   * ORDRE : TOTALEMENT ALÉATOIRE POUR L'INSTANT, SANS PALIERS PAYANTS EN TÊTE (remplace la décision du 23/10). À REDISCUTER AU
--     LANCEMENT : la colonne « tier » reste renvoyée pour pouvoir y revenir sans changer la page.
--   * Fiche visible seulement si l'AdReel principal est public ET a au moins un morceau à écouter (directory_hidden_reason).
--     Le compositeur caché lit la raison dans Mon compte.
--   * Tout reste derrière le feu vert composer_directory : tant qu'il est fermé, seul un admin voit la liste, les suggestions et
--     peut modifier ses tags. Signatures de composer_directory et set_my_directory inchangées : le site en ligne continue de marcher.

-- ---- Clé de dédoublonnage (reproduite à l'identique dans layerpitch-tag-picker.js, comparée par test_directory_tags.js) ----
create function public.directory_tag_key(p_label text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(regexp_replace(
    normalize(replace(replace(replace(replace(coalesce(p_label, ''), 'œ', 'oe'), 'Œ', 'oe'), 'æ', 'ae'), 'Æ', 'ae'), NFD),
    '[̀-ͯ]', '', 'g'),
    E'[[:space:]!"$%&''()*,\\-./:;<=>?@\\[\\\\\\]^_`{|}~’‘“”«»–—…·•]', '', 'g'));
$$;
revoke execute on function public.directory_tag_key(text) from public, anon, authenticated;

create table public.directory_tags (
  id bigint generated always as identity primary key,
  key text not null unique check (key <> ''),
  label text not null,
  seed boolean not null default false,        -- liste de départ : proposée même si personne ne l'utilise encore
  merged_into bigint references public.directory_tags(id), -- alias : ce nom mène à un autre tag
  retired_at timestamptz,                     -- retiré par un admin : la clé reste connue pour qu'il ne soit pas recréé
  created_at timestamptz not null default now()
);
comment on table public.directory_tags is 'Tags communs de l''annuaire. Lecture et écriture uniquement par les fonctions ci-dessous.';

create table public.composer_directory_tags (
  composer_id uuid not null references public.composer_profiles(id) on delete cascade,
  tag_id bigint not null references public.directory_tags(id) on delete cascade,
  position int not null default 0,
  primary key (composer_id, tag_id)
);
create index composer_directory_tags_tag_idx on public.composer_directory_tags (tag_id);

alter table public.directory_tags enable row level security;          -- aucune politique : tout passe par les fonctions
alter table public.composer_directory_tags enable row level security;
revoke all on public.directory_tags from anon, authenticated;
revoke all on public.composer_directory_tags from anon, authenticated;

alter table public.composer_profiles add column directory_tags_saved boolean not null default false;
comment on column public.composer_profiles.directory_tags_saved is 'A déjà enregistré ses tags : on ne lui propose plus de pré-cocher ses logiciels (implementation_skills).';

-- ---- Trouve le tag d'un nom saisi, le crée s'il est inconnu. null : nom vide ou tag retiré. ----
create function public.directory_tag_resolve(p_label text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text := left(trim(regexp_replace(coalesce(p_label, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 30);
  v_key text := public.directory_tag_key(v_label);
  t public.directory_tags;
begin
  if v_key = '' then return null; end if;
  select * into t from public.directory_tags where key = v_key;
  if not found then
    insert into public.directory_tags (key, label) values (v_key, v_label) on conflict (key) do nothing;
    select * into t from public.directory_tags where key = v_key;
  end if;
  if t.retired_at is not null then return null; end if;
  return coalesce(t.merged_into, t.id);
end;
$$;
revoke execute on function public.directory_tag_resolve(text) from public, anon, authenticated;

-- ---- Liste de départ (validée par Jules-Antoine) : nom affiché en anglais, noms français et variantes en alias ----
do $seed$
declare
  s record;
  a text;
  v_id bigint;
begin
  for s in select * from (values
    ('RPG', array['Jeu de rôle']), ('Action', '{}'), ('Adventure', array['Aventure']), ('Platformer', array['Plateforme', 'Jeu de plateforme']),
    ('Strategy', array['Stratégie']), ('Puzzle', array['Réflexion']), ('Horror', array['Horreur']), ('Simulation', '{}'),
    ('Roguelike', array['Roguelite']), ('Visual Novel', '{}'), ('Open World', array['Monde ouvert']), ('Indie', array['Indé', 'Indépendant']),
    ('Mobile', '{}'), ('FPS', '{}'),
    ('Sci-Fi', array['Science-fiction', 'SF']), ('Fantasy', array['Fantaisie']), ('Medieval', '{}'), ('Retro', '{}'),
    ('Orchestral', array['Orchestre', 'Orchestrale']), ('Cinematic', array['Cinématique']), ('Epic', array['Épique']), ('Ambient', array['Ambiant', 'Ambiance']),
    ('Electronic', array['Électronique', 'Electro']), ('Synthwave', '{}'), ('Chiptune', array['8-bit']), ('Rock', '{}'), ('Metal', '{}'), ('Jazz', '{}'),
    ('Folk', '{}'), ('World Music', array['Musiques du monde']), ('Piano', '{}'), ('Choir', array['Chœur', 'Chœurs', 'Choral']), ('Hip-Hop', array['Rap']), ('Lo-Fi', '{}'),
    ('Wwise', '{}'), ('FMOD', '{}'), ('Unity', '{}'), ('Unreal', array['Unreal Engine']), ('Godot', '{}'),
    ('Adaptive Music', array['Musique adaptative', 'Musique interactive']), ('Sound Design', array['Design sonore'])
  ) as v(label, aliases) loop
    insert into public.directory_tags (key, label, seed) values (public.directory_tag_key(s.label), s.label, true) returning id into v_id;
    foreach a in array s.aliases::text[] loop
      insert into public.directory_tags (key, label, merged_into) values (public.directory_tag_key(a), a, v_id);
    end loop;
  end loop;
end;
$seed$;

-- ---- Reprise des mots-clés existants, puis des logiciels cochés (Wwise, FMOD, Unity, Unreal) ----
insert into public.composer_directory_tags (composer_id, tag_id, position)
select c.id, r.tag_id, min(r.ord)
from public.composer_profiles c
cross join lateral (
  select public.directory_tag_resolve(x.k) as tag_id, x.ord::int as ord
  from unnest(c.directory_keywords) with ordinality as x(k, ord)
) r
where r.tag_id is not null
group by c.id, r.tag_id;

insert into public.composer_directory_tags (composer_id, tag_id, position)
select s.owner_id, t.id, 1000
from public.settings s
cross join lateral (values ('wwise'), ('fmod'), ('unity'), ('unreal')) as sk(k)
join public.directory_tags t on t.key = sk.k
where coalesce((s.implementation_skills ->> sk.k)::boolean, false)
on conflict do nothing;

alter table public.composer_profiles drop column directory_keywords;

-- Compte anonymisé : ses tags ne comptent plus (sa ligne composer_profiles reste, sans identifiant).
create function public.directory_tags_clear_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.composer_directory_tags t using public.composer_profiles c where t.composer_id = c.id and c.profile_id = new.id;
  return new;
end;
$$;
revoke execute on function public.directory_tags_clear_on_delete() from public, anon, authenticated;
create trigger directory_tags_clear_on_delete after update of deleted_at on public.profiles
  for each row when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.directory_tags_clear_on_delete();

-- ---- Pourquoi une fiche est cachée (null = visible). Un AdReel principal privé n'apparaît jamais. ----
create function public.directory_hidden_reason(p_composer uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not c.directory_opt_in then 'opted_out'
    when c.handle is null then 'no_handle'
    when r.id is null then 'no_adreel'
    when r.access_mode <> 'public' then 'private'
    when not exists (select 1 from public.ad_reel_tracks a where a.owner_id = c.id and a.ad_reel_id = 'main')
      -- Liste de blocs vide ou ancienne : la page publique y remet un bloc « Morceaux » (migrateBlocks).
      or not (jsonb_typeof(r.blocks) <> 'array' or jsonb_array_length(r.blocks) = 0 or r.blocks @> '["tracks"]'::jsonb or r.blocks @> '[{"type":"tracks"}]'::jsonb)
      then 'no_tracks'
    end
  from public.composer_profiles c
  left join public.ad_reels r on r.owner_id = c.id and r.id = 'main'
  where c.id = p_composer;
$$;
revoke execute on function public.directory_hidden_reason(uuid) from public, anon, authenticated;

-- ---- Annuaire public : mêmes colonnes qu'avant ; ordre tiré au sort à chaque chargement (voir l'en-tête) ----
create or replace function public.composer_directory()
returns table (handle text, name text, bio text, photo text, photo_frame jsonb, keywords text[], tier text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce((public.directory_status()->>'open')::boolean, false) then return; end if;
  return query
    select c.handle,
           coalesce(nullif(trim(r.profile->>'title'), ''), c.handle) as name,
           nullif(left(trim(coalesce(r.profile->>'bio', '')), 400), '') as bio,
           nullif(r.profile->>'photo', '') as photo,
           c.directory_photo_frame,
           coalesce((select array_agg(t.label order by l.position, t.label) from public.composer_directory_tags l
                     join public.directory_tags t on t.id = l.tag_id where l.composer_id = c.id), '{}'::text[]),
           coalesce((select pp.plan from public.profile_plan(c.profile_id, 'composer', false) pp limit 1), 'free') as tier
    from public.composer_profiles c
    join public.profiles p on p.id = c.profile_id
    join public.ad_reels r on r.owner_id = c.id and r.id = 'main'
    where public.directory_hidden_reason(c.id) is null
      and not p.suspended and p.deletion_requested_at is null and p.deleted_at is null
    order by random();
end;
$$;
grant execute on function public.composer_directory() to anon, authenticated;

-- ---- Suggestions communes : liste de départ + tags portés par au moins un compositeur. uses = compositeurs qui l'ont. ----
create function public.directory_tag_list()
returns table (id bigint, label text, aliases text[], uses int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce((public.directory_status()->>'open')::boolean, false) then return; end if;
  return query
    select t.id, t.label,
           coalesce((select array_agg(al.label order by al.label) from public.directory_tags al where al.merged_into = t.id and al.retired_at is null), '{}'::text[]),
           (select count(*)::int from public.composer_directory_tags l where l.tag_id = t.id) as uses
    from public.directory_tags t
    where t.merged_into is null and t.retired_at is null
      and (t.seed or exists (select 1 from public.composer_directory_tags l where l.tag_id = t.id))
    order by uses desc, t.label;
end;
$$;
grant execute on function public.directory_tag_list() to anon, authenticated;

-- ---- Réglages du compositeur connecté ----
-- hiddenReason : pourquoi sa fiche n'apparaît pas. skillTags : logiciels à pré-cocher tant qu'il n'a jamais enregistré ses tags.
create or replace function public.get_my_directory()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'optIn', c.directory_opt_in,
    'keywords', coalesce((select jsonb_agg(t.label order by l.position, t.label) from public.composer_directory_tags l
                          join public.directory_tags t on t.id = l.tag_id where l.composer_id = c.id), '[]'::jsonb),
    'skillTags', case when c.directory_tags_saved then '[]'::jsonb else coalesce((
      select jsonb_agg(t.label order by t.label) from public.settings s
      cross join lateral (values ('wwise'), ('fmod'), ('unity'), ('unreal')) as sk(k)
      join public.directory_tags t on t.key = sk.k
      where s.owner_id = c.id and coalesce((s.implementation_skills ->> sk.k)::boolean, false)), '[]'::jsonb) end,
    'hiddenReason', public.directory_hidden_reason(c.id),
    'photoFrame', c.directory_photo_frame,
    'photo', (select nullif(r.profile->>'photo', '') from public.ad_reels r where r.owner_id = c.id and r.id = 'main'))
  from public.composer_profiles c where c.profile_id = auth.uid();
$$;
revoke execute on function public.get_my_directory() from public, anon;
grant execute on function public.get_my_directory() to authenticated;

-- p_keywords : noms des tags, dans l'ordre ; 100 au plus ; les inconnus sont créés. Ignoré tant que l'annuaire est fermé pour
-- l'appelant (feu vert) : la carte en ligne des autres comptes n'y touche donc pas. p_photo_frame : voir 20261025010000.
create or replace function public.set_my_directory(p_opt_in boolean, p_keywords text[], p_photo_frame jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_frame jsonb;
  v_set_frame boolean := p_photo_frame is not null;
  v_label text;
  v_tag bigint;
  v_tags bigint[] := '{}';
begin
  select id into v_id from public.composer_profiles where profile_id = auth.uid();
  if v_id is null then raise exception 'Aucun profil compositeur pour ce compte'; end if;
  if v_set_frame then
    if jsonb_typeof(p_photo_frame) <> 'object' or p_photo_frame = '{}'::jsonb then v_frame := null;
    else
      v_frame := jsonb_build_object(
        'x', round(least(100, greatest(0, coalesce((p_photo_frame->>'x')::numeric, 50))), 1),
        'y', round(least(100, greatest(0, coalesce((p_photo_frame->>'y')::numeric, 50))), 1),
        'zoom', round(least(3, greatest(1, coalesce((p_photo_frame->>'zoom')::numeric, 1))), 2));
    end if;
  end if;
  update public.composer_profiles
     set directory_opt_in = coalesce(p_opt_in, true),
         directory_photo_frame = case when v_set_frame then v_frame else directory_photo_frame end
   where id = v_id;
  if p_keywords is not null and coalesce((public.directory_status()->>'open')::boolean, false) then
    foreach v_label in array p_keywords loop
      exit when cardinality(v_tags) >= 100;
      v_tag := public.directory_tag_resolve(v_label);
      if v_tag is not null and not v_tag = any(v_tags) then v_tags := v_tags || v_tag; end if;
    end loop;
    delete from public.composer_directory_tags where composer_id = v_id;
    insert into public.composer_directory_tags (composer_id, tag_id, position)
      select v_id, x.t, x.ord::int from unnest(v_tags) with ordinality as x(t, ord);
    update public.composer_profiles set directory_tags_saved = true where id = v_id;
  end if;
  return public.get_my_directory();
end;
$$;
revoke execute on function public.set_my_directory(boolean, text[], jsonb) from public, anon;
grant execute on function public.set_my_directory(boolean, text[], jsonb) to authenticated;

-- ---- Administration (admin.html → Annuaire) ----
create function public.admin_directory_tags()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'seed', t.seed, 'retired', t.retired_at is not null,
      'uses', (select count(*) from public.composer_directory_tags l where l.tag_id = t.id)) order by t.retired_at is not null, t.label)
    from public.directory_tags t where t.merged_into is null), '[]'::jsonb);
end;
$$;
-- Retirer : disparaît de toutes les fiches et des suggestions, et ne peut pas être recréé à la saisie.
create function public.admin_retire_directory_tag(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  delete from public.composer_directory_tags where tag_id = p_id;
  update public.directory_tags set retired_at = now() where (id = p_id or merged_into = p_id) and retired_at is null;
end;
$$;
create function public.admin_restore_directory_tag(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  update public.directory_tags set retired_at = null where id = p_id or merged_into = p_id;
end;
$$;
-- Fusionner : les fiches de p_from passent à p_into, et le nom de p_from mènera désormais à p_into.
create function public.admin_merge_directory_tags(p_from bigint, p_into bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs'; end if;
  if p_from = p_into then raise exception 'Un tag ne peut pas être fusionné avec lui-même'; end if;
  if not exists (select 1 from public.directory_tags where id = p_from and merged_into is null and retired_at is null)
     or not exists (select 1 from public.directory_tags where id = p_into and merged_into is null and retired_at is null) then
    raise exception 'Tag introuvable';
  end if;
  insert into public.composer_directory_tags (composer_id, tag_id, position)
    select composer_id, p_into, position from public.composer_directory_tags where tag_id = p_from
    on conflict do nothing;
  delete from public.composer_directory_tags where tag_id = p_from;
  update public.directory_tags set merged_into = p_into where id = p_from or merged_into = p_from;
end;
$$;
revoke execute on function public.admin_directory_tags() from public, anon;
revoke execute on function public.admin_retire_directory_tag(bigint) from public, anon;
revoke execute on function public.admin_restore_directory_tag(bigint) from public, anon;
revoke execute on function public.admin_merge_directory_tags(bigint, bigint) from public, anon;
grant execute on function public.admin_directory_tags() to authenticated;
grant execute on function public.admin_retire_directory_tag(bigint) to authenticated;
grant execute on function public.admin_restore_directory_tag(bigint) to authenticated;
grant execute on function public.admin_merge_directory_tags(bigint, bigint) to authenticated;
