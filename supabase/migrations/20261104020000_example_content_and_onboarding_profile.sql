-- LayerPitch — exemples préchargés + questions de profil (4 novembre 2026), étape 1 : la base.
--
-- Cadrage validé par Jules-Antoine le 4/11 : layerpitch-docs/2026-11-04-exemples-precharges-et-profilage-cadrage.md
--
-- 1. Exemples préchargés : chaque compte reçoit UNE FOIS une copie de 6 morceaux du dossier « Jazz +/- » (un par mode)
--    et des 3 Sfx attachés au statique, rangés dans deux dossiers « Exemples », plus un pack d'exemple et un AdReel « Démo »
--    privé. Les copies portent example_source_id (l'id de la source : drapeau « exemple » ET lien vers la source) ;
--    le pack, l'AdReel et les dossiers, qui n'ont pas de source, portent un repère fixe ('example-pack', 'example-adreel',
--    'example-folder'). Les fichiers son ne sont JAMAIS copiés : la copie garde la `base` de la source
--    (media.layerpitch.com/audio/<id source>/), et cette base est figée (déclencheur plus bas) pour qu'une sauvegarde du
--    Backstage ne la réécrive pas vers audio/<id de la copie>/ (dossier vide).
-- 2. Garde-fous en base : un exemple n'est jamais public (lecture publique fermée aux autres comptes, annuaire, catalogue,
--    sitemap, statistiques, quota de pages) et ne peut être ni protégé, ni vendu, ni mis dans un album, ni placé dans une
--    page publique (AdReel, pack ou collection qui n'est pas lui-même un exemple).
-- 3. Questions de profil : profiles.onboarding_profile (jsonb : rôle, carrière, OST, voie, date) et la répartition pour
--    les statistiques admin.
--
-- Feux verts (admin d'abord) :
--   select public.set_feature_released('example_content', true);
--   select public.set_feature_released('onboarding_profile', true);

-- ---------------------------------------------------------------------------------------------------------------------
-- Marquage
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.tracks          add column example_source_id text;
alter table public.sfx_library     add column example_source_id text;
alter table public.packs           add column example_source_id text;
alter table public.ad_reels        add column example_source_id text;
alter table public.track_folders   add column example_source_id text;
alter table public.sfx_folders     add column example_source_id text;
comment on column public.tracks.example_source_id is 'Exemple préchargé (seed_my_examples) : id du morceau source. NULL = morceau ordinaire. Jamais public, jamais protégé/vendu/en album ; base figée sur les fichiers de la source.';
comment on column public.sfx_library.example_source_id is 'Exemple préchargé : id du Sfx source. NULL = Sfx ordinaire.';
comment on column public.packs.example_source_id is 'Pack d''exemple (repère ''example-pack''). Jamais public ni en vente ni au catalogue.';
comment on column public.ad_reels.example_source_id is 'AdReel « Démo » d''exemple (repère ''example-adreel''), access_mode = ''example'' : aucune page publique.';
comment on column public.track_folders.example_source_id is 'Dossier « Exemples » (repère ''example-folder'').';
comment on column public.sfx_folders.example_source_id is 'Dossier « Exemples » des Sfx (repère ''example-folder'').';
create index tracks_example_owner_idx on public.tracks (owner_id) where example_source_id is not null;
create index sfx_library_example_owner_idx on public.sfx_library (owner_id) where example_source_id is not null;

-- AdReel Démo : nouvelle valeur d'accès. La règle de lecture actuelle (access_mode = 'public' ou propriétaire) le cache
-- déjà à tout le monde sauf la personne ; get_private_ad_reel ne sert que 'password'/'magic' ; le sitemap ne liste que 'public'.
alter table public.ad_reels drop constraint ad_reels_access_mode_check;
alter table public.ad_reels add constraint ad_reels_access_mode_check check (access_mode in ('public', 'password', 'magic', 'example'));

-- Une seule fois : l'ajout ne se refait pas après « Retirer les exemples ».
alter table public.composer_profiles add column examples_seeded_at timestamptz;
comment on column public.composer_profiles.examples_seeded_at is 'Date de l''ajout des exemples préchargés (seed_my_examples). Renseignée = ne se refait jamais, même après remove_my_examples().';

-- Réponses aux questions de profil (fin de visite guidée).
alter table public.profiles add column onboarding_profile jsonb;
comment on column public.profiles.onboarding_profile is 'Questions de profil (fin de visite) : {role: composer|studio|both, career: contracts|starting, ost: yes|no, path: composer|studio, skipped: bool, at: date}. NULL = jamais proposé. Écrit par set_my_onboarding_profile().';

-- ---------------------------------------------------------------------------------------------------------------------
-- Liste des sources (changer la sélection plus tard sans migration de code : modifier ces lignes)
-- ---------------------------------------------------------------------------------------------------------------------
create table public.example_catalog (
  kind text not null check (kind in ('track', 'sfx')),
  source_id text not null,
  position int not null,
  titles jsonb,          -- nom dans le compte, une clé par langue ; NULL = garder le titre de la source
  primary key (kind, source_id)
);
comment on table public.example_catalog is 'Sources des exemples préchargés (seed_my_examples) : morceaux et Sfx du compte de Jules-Antoine, ordre, nom par langue. Lue seulement par les fonctions security definer (RLS sans policy).';
alter table public.example_catalog enable row level security;

insert into public.example_catalog (kind, source_id, position, titles) values
  ('track', 'bmvjfdonbsfnkd', 1, '{"fr": "Example 1 - EZ Jazz Statique", "en": "Example 1 - EZ Jazz Static"}'),
  ('track', 'bmvidp6unbjfkq', 2, '{"fr": "Example 2 - EZ Jazz Embranchement vertical", "en": "Example 2 - EZ Jazz Vertical branching"}'),
  ('track', 'bmvidtfhvfa5tt', 3, '{"fr": "Example 3 - EZ Jazz Layering vertical additif", "en": "Example 3 - EZ Jazz Additive vertical layering"}'),
  ('track', 'bmvin15j2vxt4p', 4, '{"fr": "Example 4 - EZ Jazz Layering vertical randomisé", "en": "Example 4 - EZ Jazz Randomized vertical layering"}'),
  ('track', 'bmvi797lv98i68', 5, '{"fr": "Example 5 - EZ Jazz Séquentiel", "en": "Example 5 - EZ Jazz Sequential"}'),
  ('track', 'bmvidx6a4320my', 6, '{"fr": "Example 6 - EZ Jazz Séquentiel à embranchement", "en": "Example 6 - EZ Jazz Sequential branching"}'),
  ('sfx',   'bmvjel4krqhewx', 1, null),   -- Glaçons
  ('sfx',   'bmvjelkpymwo8r', 2, null),   -- Se remplir un verre
  ('sfx',   'bmvjew5nmxel2r', 3, null);   -- Se balader dans le bar

-- Textes des fiches créées (une clé par langue ; une langue absente retombe sur l'anglais).
create or replace function public.example_text(p_key text, p_lang text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(t->>p_lang, t->>'en')
  from (select (case p_key
    when 'folder' then '{"fr": "Exemples", "en": "Examples"}'
    when 'pack'   then '{"fr": "Pack d''exemple", "en": "Example pack"}'
    when 'adreel' then '{"fr": "Démo", "en": "Demo"}'
    when 'bio'    then '{"fr": "Ici, tu pourrais mettre ta photo et une bio, mais tu peux aussi rajouter une vidéo ou des photos.", "en": "Here you could add your photo and a bio, but you can also add a video or photos."}'
  end)::jsonb as t) x;
$$;

-- Message de la boîte de réception (texte de Jules-Antoine, 4/11) : modèle natif, modifiable depuis le panneau admin
-- (admin_update_native_message) ; copié dans la boîte de la personne au moment de l'ajout.
insert into public.platform_message_templates (key, title, body) values (
  'examples',
  jsonb_build_object('fr', 'Des exemples pour jouer', 'en', 'Examples to play with'),
  jsonb_build_object(
    'fr', $msg_fr$Salut, c'est Jules-Antoine.

En ce moment, je cherche à rendre la prise en main de LayerPitch la plus facile possible. Du coup, j'ai préparé quelques courtes compositions dans chacun des modes de lecture, pour que tu puisses jouer avec et voir comment ça fonctionne. Elles sont là pour tester : modifie-les, essaie-les, casse tout ! Quand tu n'en as plus besoin, clique sur « Retirer les exemples » : ça les effacera toutes. Amuse-toi bien !

PS : dans le même état d'esprit, il y a aussi un pack et un AdReel de démo. Fais-toi plaisir ! :)$msg_fr$,
    'en', $msg_en$Hi, it's Jules-Antoine.

Right now I'm trying to make getting started with LayerPitch as easy as possible. So I've prepared a few short compositions in each playback mode, so you can play with them and see how it all works. They're here for testing: edit them, try them, break everything! When you no longer need them, click "Remove examples" and they'll all be deleted. Have fun!

PS: in the same spirit, there's also a demo pack and a demo AdReel. Enjoy! :)$msg_en$
  )
) on conflict (key) do nothing;

-- Feux verts (admin seulement jusqu'à l'ouverture par Jules-Antoine).
insert into public.feature_flags (key, description) values
  ('example_content', 'Exemples préchargés (04/11) — 6 morceaux + 3 Sfx « Jazz +/- », pack d''exemple et AdReel Démo copiés une fois dans chaque compte ; admin seulement.'),
  ('onboarding_profile', 'Questions de profil en fin de visite + « Tes essentiels » dans le menu Tutoriel (04/11) ; admin seulement.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- Lecture publique : un exemple n'est lisible que par son propriétaire (pages publiques, lecteur, page pack…).
-- Les fonctions security definer (projets, rapports admin) ne passent pas par ces règles.
-- ---------------------------------------------------------------------------------------------------------------------
drop policy "public read" on public.tracks;
create policy "public read" on public.tracks for select using (example_source_id is null or owner_id = public.current_composer_id());
drop policy "public read" on public.sfx_library;
create policy "public read" on public.sfx_library for select using (example_source_id is null or owner_id = public.current_composer_id());
drop policy "public read" on public.packs;
create policy "public read" on public.packs for select using (example_source_id is null or owner_id = public.current_composer_id());

-- ---------------------------------------------------------------------------------------------------------------------
-- Garde-fous (refus côté base ; le Backstage affiche son propre message avant d'en arriver là)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.example_guard_track_or_sfx()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.example_source_id := old.example_source_id;      -- le marquage ne se retire pas par une sauvegarde
  end if;
  if new.example_source_id is null then return new; end if;
  if new.protected then
    raise exception 'Exemple : un morceau ou Sfx d''exemple ne peut pas être protégé (ses fichiers sont partagés).' using hint = 'example_forbidden';
  end if;
  if tg_op = 'UPDATE' then
    new.base := old.base;                                 -- fichiers de la source, jamais audio/<id de la copie>/
  end if;
  return new;
end;
$$;
create trigger example_guard before insert or update on public.tracks for each row execute function public.example_guard_track_or_sfx();
create trigger example_guard before insert or update on public.sfx_library for each row execute function public.example_guard_track_or_sfx();

create or replace function public.example_guard_pack()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then new.example_source_id := old.example_source_id; end if;
  if new.example_source_id is null then return new; end if;
  if new.buyable or coalesce(new.price_eur_cents, 0) > 0 or new.subscriber_credits is not null then
    raise exception 'Exemple : le pack d''exemple ne peut pas être mis en vente.' using hint = 'example_forbidden';
  end if;
  new.catalog_listed := false;
  return new;
end;
$$;
create trigger example_guard before insert or update on public.packs for each row execute function public.example_guard_pack();

create or replace function public.example_guard_ad_reel()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then new.example_source_id := old.example_source_id; end if;
  if new.example_source_id is not null and new.access_mode <> 'example' then
    raise exception 'Exemple : l''AdReel d''exemple n''a pas de page publique.' using hint = 'example_forbidden';
  end if;
  if new.example_source_id is null and new.access_mode = 'example' then
    raise exception 'Accès « example » réservé à l''AdReel d''exemple.' using hint = 'example_forbidden';
  end if;
  return new;
end;
$$;
create trigger example_guard before insert or update on public.ad_reels for each row execute function public.example_guard_ad_reel();

-- Un morceau/Sfx d'exemple n'entre que dans un pack ou un AdReel d'exemple (tout autre pack/AdReel est une page publique).
create or replace function public.example_guard_placement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_is_example boolean;
  v_holder_is_example boolean;
begin
  if tg_table_name = 'pack_tracks' then
    v_item_is_example := exists (select 1 from public.tracks where id = new.track_id and example_source_id is not null);
    v_holder_is_example := exists (select 1 from public.packs where id = new.pack_id and example_source_id is not null);
  elsif tg_table_name = 'pack_sfx' then
    v_item_is_example := exists (select 1 from public.sfx_library where id = new.sfx_id and example_source_id is not null);
    v_holder_is_example := exists (select 1 from public.packs where id = new.pack_id and example_source_id is not null);
  elsif tg_table_name = 'ad_reel_tracks' then
    v_item_is_example := exists (select 1 from public.tracks where id = new.track_id and example_source_id is not null);
    v_holder_is_example := exists (select 1 from public.ad_reels where owner_id = new.owner_id and id = new.ad_reel_id and example_source_id is not null);
  elsif tg_table_name = 'collection_packs' then
    v_item_is_example := exists (select 1 from public.packs where id = new.pack_id and example_source_id is not null);
    v_holder_is_example := false;                          -- une collection est toujours une page publique
  elsif tg_table_name = 'album_tracks' then
    v_item_is_example := exists (select 1 from public.tracks where id = new.track_id and example_source_id is not null);
    v_holder_is_example := false;                          -- un album se vend
  end if;
  if v_item_is_example and not v_holder_is_example then
    raise exception 'Exemple : remplace-le par ta propre musique avant de publier (un exemple ne va que dans le pack ou l''AdReel d''exemple).' using hint = 'example_forbidden';
  end if;
  return new;
end;
$$;
create trigger example_guard before insert or update on public.pack_tracks for each row execute function public.example_guard_placement();
create trigger example_guard before insert or update on public.pack_sfx for each row execute function public.example_guard_placement();
create trigger example_guard before insert or update on public.ad_reel_tracks for each row execute function public.example_guard_placement();
create trigger example_guard before insert or update on public.collection_packs for each row execute function public.example_guard_placement();
create trigger example_guard before insert or update on public.album_tracks for each row execute function public.example_guard_placement();

-- ---------------------------------------------------------------------------------------------------------------------
-- Ajout / retrait
-- ---------------------------------------------------------------------------------------------------------------------
-- Identifiant au même format que genId() du Backstage : 'b' + horodatage en base 36 + aléa.
create or replace function public.example_new_id()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  n bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  s text := '';
  c text := '0123456789abcdefghijklmnopqrstuvwxyz';
begin
  loop
    s := substr(c, (n % 36)::int + 1, 1) || s;
    n := n / 36;
    exit when n = 0;
  end loop;
  return 'b' || s || substr(md5(random()::text || clock_timestamp()::text), 1, 7);
end;
$$;

-- Copie les exemples dans le compte connecté, UNE FOIS (composer_profiles.examples_seeded_at), si le feu vert
-- example_content est ouvert pour lui. Langue : p_lang (langue affichée) sinon profiles.lang sinon 'fr' ; une langue sans
-- texte retombe sur l'anglais. Une source supprimée entre-temps est simplement sautée.
-- Retour : {seeded: true, tracks, sfx} ou {skipped: 'flag' | 'done' | 'no_composer'}.
create or replace function public.seed_my_examples(p_lang text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.current_composer_id();
  v_seeded timestamptz;
  v_lang text;
  v_track_folder text;
  v_sfx_folder text;
  v_pack text;
  v_adreel text;
  v_sfx_map jsonb := '{}'::jsonb;     -- id source → id copie
  v_slot_map jsonb;
  v_track_ids text[] := '{}';
  v_sfx_ids text[] := '{}';
  v_row record;
  v_slot record;
  v_new_id text;
  v_txt text;
  v_k text;
  v_v text;
  v_pos int;
  v_tpl record;
begin
  if v_owner is null then return jsonb_build_object('skipped', 'no_composer'); end if;
  if not public.feature_released('example_content', auth.uid()) then return jsonb_build_object('skipped', 'flag'); end if;
  -- Verrou de la ligne : deux onglets ouverts en même temps ne copient pas deux fois.
  select examples_seeded_at into v_seeded from public.composer_profiles where id = v_owner for update;
  if v_seeded is not null then return jsonb_build_object('skipped', 'done'); end if;
  update public.composer_profiles set examples_seeded_at = now() where id = v_owner;

  v_lang := lower(coalesce(nullif(btrim(p_lang), ''), (select lang from public.profiles where id = auth.uid()), 'fr'));

  -- Dossiers « Exemples », en tête de liste.
  v_track_folder := public.example_new_id();
  insert into public.track_folders (id, label, owner_id, position, example_source_id)
    values (v_track_folder, public.example_text('folder', v_lang), v_owner,
            coalesce((select min(position) from public.track_folders where owner_id = v_owner), 0) - 1, 'example-folder');
  v_sfx_folder := public.example_new_id();
  insert into public.sfx_folders (id, label, owner_id, position, example_source_id)
    values (v_sfx_folder, public.example_text('folder', v_lang), v_owner,
            coalesce((select min(position) from public.sfx_folders where owner_id = v_owner), 0) - 1, 'example-folder');

  -- Sfx (avant les morceaux : les morceaux s'y attachent). Même base que la source : aucun fichier copié.
  for v_row in
    select s.*, c.titles from public.example_catalog c join public.sfx_library s on s.id = c.source_id
    where c.kind = 'sfx' and s.retired_at is null order by c.position
  loop
    v_new_id := public.example_new_id();
    v_sfx_map := v_sfx_map || jsonb_build_object(v_row.id, v_new_id);
    v_sfx_ids := v_sfx_ids || v_new_id;
    insert into public.sfx_library
      select (jsonb_populate_record(null::public.sfx_library,
        (to_jsonb(v_row) - 'titles') || jsonb_build_object(
          'id', v_new_id, 'owner_id', v_owner, 'folder_id', v_sfx_folder, 'example_source_id', v_row.id,
          'title', coalesce(v_row.titles->>v_lang, v_row.titles->>'en', v_row.title),
          'protected', false, 'retired_at', null, 'created_at', now(), 'updated_at', now()))).*;
  end loop;

  -- Morceaux : nouvelles fiches, nouveaux emplacements (séquentiel) ; les références internes (emplacements, Sfx) sont
  -- redirigées par remplacement de l'id entre guillemets dans le JSON (ids longs et uniques).
  for v_row in
    select t.*, c.titles, c.position as cat_pos from public.example_catalog c join public.tracks t on t.id = c.source_id
    where c.kind = 'track' and t.retired_at is null order by c.position
  loop
    v_new_id := public.example_new_id();
    v_track_ids := v_track_ids || v_new_id;
    v_slot_map := '{}'::jsonb;
    for v_slot in select id from public.segment_slots where track_id = v_row.id loop
      v_slot_map := v_slot_map || jsonb_build_object(v_slot.id, public.example_new_id());
    end loop;
    v_txt := ((to_jsonb(v_row) - 'titles' - 'cat_pos') || jsonb_build_object(
      'id', v_new_id, 'owner_id', v_owner, 'folder_id', v_track_folder, 'example_source_id', v_row.id,
      'title', coalesce(v_row.titles->>v_lang, v_row.titles->>'en', v_row.title),
      'protected', false, 'retired_at', null, 'created_at', now(), 'updated_at', now()))::text;
    for v_k, v_v in select key, value from jsonb_each_text(v_slot_map || v_sfx_map) loop
      v_txt := replace(v_txt, '"' || v_k || '"', '"' || v_v || '"');
    end loop;
    insert into public.tracks select (jsonb_populate_record(null::public.tracks, v_txt::jsonb)).*;

    for v_slot in select * from public.segment_slots where track_id = v_row.id order by position loop
      v_txt := (to_jsonb(v_slot) || jsonb_build_object('track_id', v_new_id, 'created_at', now()))::text;
      for v_k, v_v in select key, value from jsonb_each_text(v_slot_map || v_sfx_map) loop
        v_txt := replace(v_txt, '"' || v_k || '"', '"' || v_v || '"');
      end loop;
      insert into public.segment_slots select (jsonb_populate_record(null::public.segment_slots, v_txt::jsonb)).*;
    end loop;
    insert into public.segment_slot_transitions (from_slot_id, target_slot_id, label, transition, position, fx_actions)
      select v_slot_map->>x.from_slot_id, v_slot_map->>x.target_slot_id, x.label, x.transition, x.position, x.fx_actions
      from public.segment_slot_transitions x join public.segment_slots s on s.id = x.from_slot_id
      where s.track_id = v_row.id and v_slot_map ? x.target_slot_id;
    -- Sfx attachés : seulement ceux copiés (un Sfx source hors catalogue n'est pas à la personne).
    insert into public.track_sfx (track_id, sfx_id, position)
      select v_new_id, v_sfx_map->>ts.sfx_id, ts.position from public.track_sfx ts
      where ts.track_id = v_row.id and v_sfx_map ? ts.sfx_id;
  end loop;

  -- AdReel « Démo » (privé, à côté de l'AdReel principal, jamais à sa place).
  v_adreel := public.example_new_id();
  insert into public.ad_reels (id, owner_id, label, lang, profile, access_mode, allow_indexing, example_source_id)
    values (v_adreel, v_owner, public.example_text('adreel', v_lang), case when v_lang = 'fr' then 'fr' else 'en' end,
            jsonb_build_object('title', public.example_text('adreel', v_lang), 'bio', public.example_text('bio', v_lang),
                               'effectivePlan', public.composer_real_tier(v_owner)),
            'example', false, 'example-adreel');
  v_pos := 0;
  foreach v_k in array v_track_ids loop
    insert into public.ad_reel_tracks (owner_id, ad_reel_id, track_id, position) values (v_owner, v_adreel, v_k, v_pos);
    v_pos := v_pos + 1;
  end loop;

  -- Pack d'exemple : les 6 morceaux + les 3 Sfx.
  v_pack := public.example_new_id();
  insert into public.packs (id, owner_id, title, catalog_listed, example_source_id)
    values (v_pack, v_owner, public.example_text('pack', v_lang), false, 'example-pack');
  insert into public.pack_tracks (pack_id, track_id, position) select v_pack, t, o - 1 from unnest(v_track_ids) with ordinality u(t, o);
  insert into public.pack_sfx (pack_id, sfx_id, position) select v_pack, s, o - 1 from unnest(v_sfx_ids) with ordinality u(s, o);

  -- Message de la boîte de réception (personnel, sans e-mail).
  select * into v_tpl from public.platform_message_templates where key = 'examples';
  if found then
    insert into public.admin_messages (body, title, recipient_id) values (v_tpl.body, v_tpl.title, auth.uid());
  end if;

  return jsonb_build_object('seeded', true, 'tracks', coalesce(array_length(v_track_ids, 1), 0), 'sfx', coalesce(array_length(v_sfx_ids, 1), 0),
                            'adReelId', v_adreel, 'packId', v_pack);
end;
$$;
revoke execute on function public.seed_my_examples(text) from public, anon;
grant execute on function public.seed_my_examples(text) to authenticated;

-- « Retirer les exemples » : efface d'un coup les fiches d'exemple du compte connecté (jamais les fichiers son, partagés).
-- Les morceaux de la personne rangés dans un dossier « Exemples » retombent hors dossier (ON DELETE SET NULL).
-- examples_seeded_at reste : l'ajout ne se refait pas.
create or replace function public.remove_my_examples()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.current_composer_id();
  v_ad int; v_pk int; v_tr int; v_sx int;
begin
  if v_owner is null then raise exception 'Non autorisé : aucun profil compositeur associé à ce compte'; end if;
  delete from public.ad_reels where owner_id = v_owner and example_source_id is not null;
  get diagnostics v_ad = row_count;
  delete from public.packs where owner_id = v_owner and example_source_id is not null;
  get diagnostics v_pk = row_count;
  delete from public.tracks where owner_id = v_owner and example_source_id is not null;
  get diagnostics v_tr = row_count;
  delete from public.sfx_library where owner_id = v_owner and example_source_id is not null;
  get diagnostics v_sx = row_count;
  delete from public.track_folders where owner_id = v_owner and example_source_id is not null;
  delete from public.sfx_folders where owner_id = v_owner and example_source_id is not null;
  return jsonb_build_object('adReels', v_ad, 'packs', v_pk, 'tracks', v_tr, 'sfx', v_sx);
end;
$$;
revoke execute on function public.remove_my_examples() from public, anon;
grant execute on function public.remove_my_examples() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Questions de profil
-- ---------------------------------------------------------------------------------------------------------------------
-- p : {role, career, ost, path} ou {skipped: true}. Valeurs inconnues refusées ; la date est posée ici.
create or replace function public.set_my_onboarding_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then raise exception 'Non autorisé'; end if;
  if not public.feature_released('onboarding_profile', auth.uid()) then raise exception 'Fonction pas encore ouverte'; end if;
  if coalesce((p->>'skipped')::boolean, false) then
    v := jsonb_build_object('skipped', true);
  else
    if coalesce(p->>'role', '') not in ('composer', 'studio', 'both') then raise exception 'role invalide'; end if;
    if p->>'career' is not null and p->>'career' not in ('contracts', 'starting') then raise exception 'career invalide'; end if;
    if p->>'ost' is not null and p->>'ost' not in ('yes', 'no') then raise exception 'ost invalide'; end if;
    if p->>'path' is not null and p->>'path' not in ('composer', 'studio') then raise exception 'path invalide'; end if;
    v := jsonb_strip_nulls(jsonb_build_object('role', p->>'role', 'career', p->>'career', 'ost', p->>'ost', 'path', p->>'path'));
  end if;
  v := v || jsonb_build_object('at', now());
  update public.profiles set onboarding_profile = v where id = auth.uid();
  return v;
end;
$$;
revoke execute on function public.set_my_onboarding_profile(jsonb) from public, anon;
grant execute on function public.set_my_onboarding_profile(jsonb) to authenticated;

-- Répartition des réponses pour les statistiques admin.
create or replace function public.admin_onboarding_profile_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Non autorisé : réservé aux admins'; end if;
  return jsonb_build_object(
    'accounts', (select count(*) from public.profiles where deleted_at is null),
    'asked', (select count(*) from public.profiles where deleted_at is null and onboarding_profile is not null),
    'skipped', (select count(*) from public.profiles where deleted_at is null and (onboarding_profile->>'skipped')::boolean),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('role', role, 'career', career, 'ost', ost, 'path', path, 'count', n) order by n desc)
      from (select onboarding_profile->>'role' as role, onboarding_profile->>'career' as career, onboarding_profile->>'ost' as ost,
                   onboarding_profile->>'path' as path, count(*) as n
            from public.profiles where deleted_at is null and onboarding_profile ? 'role'
            group by 1, 2, 3, 4) g), '[]'::jsonb));
end;
$$;
grant execute on function public.admin_onboarding_profile_stats() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Exclusions : quota de pages, annuaire, catalogue, sitemap, statistiques
-- ---------------------------------------------------------------------------------------------------------------------
-- L'AdReel Démo ne prend pas une place du quota d'AdReels.
create or replace function public.composer_public_pages_used(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.ad_reels a join public.composer_profiles cp on cp.id = a.owner_id
          where cp.profile_id = p_profile_id and a.example_source_id is null)::int
       + (select count(*) from public.project_vitrines v join public.projects p on p.id = v.project_id
          where p.owner_kind = 'composer' and p.owner_profile_id = p_profile_id and v.published and v.audience = 'players')::int;
$$;

-- Annuaire : seuls les vrais morceaux de l'AdReel principal comptent (les exemples ne doivent faire apparaître personne).
create or replace function public.directory_hidden_reason(p_composer uuid)
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
    when not exists (select 1 from public.ad_reel_tracks a join public.tracks t on t.id = a.track_id
                     where a.owner_id = c.id and a.ad_reel_id = 'main' and t.example_source_id is null)
      -- Liste de blocs vide ou ancienne : la page publique y remet un bloc « Morceaux » (migrateBlocks).
      or not (jsonb_typeof(r.blocks) <> 'array' or jsonb_array_length(r.blocks) = 0 or r.blocks @> '["tracks"]'::jsonb or r.blocks @> '[{"type":"tracks"}]'::jsonb)
      then 'no_tracks'
    end
  from public.composer_profiles c
  left join public.ad_reels r on r.owner_id = c.id and r.id = 'main'
  where c.id = p_composer;
$$;

-- Catalogue audio : jamais de pack d'exemple (déjà impossible à mettre en vente ; filtre explicite en plus).
create or replace function public.catalog_packs()
returns table(id text, title text, illustration text, tags text[], price_eur_cents integer, subscriber_credits integer, composer_name text, composer_handle text, track_count integer, sfx_count integer, updated_at timestamp with time zone)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.title, p.illustration, p.tags, p.price_eur_cents, p.subscriber_credits,
         coalesce(nullif((select a.profile->>'title' from public.ad_reels a
                          where a.owner_id = p.owner_id and a.example_source_id is null order by (a.id = 'main') desc, a.created_at limit 1), ''), cp.handle),
         cp.handle,
         (select count(*)::int from public.pack_tracks pt where pt.pack_id = p.id),
         (select count(*)::int from public.pack_sfx ps where ps.pack_id = p.id),
         p.updated_at
  from public.packs p
  join public.composer_profiles cp on cp.id = p.owner_id
  where p.buyable and p.catalog_listed and coalesce(p.price_eur_cents, 0) > 0 and p.example_source_id is null
  order by p.updated_at desc;
$$;

-- Sitemap / moteurs (Worker apercu-liens via list_seo_adreels) : seuls les AdReels 'public' — l'AdReel Démo est
-- 'example', il n'y entre donc pas ; filtre explicite en plus pour qu'un futur changement de règle ne l'y fasse pas entrer.
create or replace function public.seo_adreel_allowed(p_owner uuid, p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ad_reels ar join public.composer_profiles cp on cp.id = ar.owner_id
    where ar.owner_id = p_owner and ar.id = p_id and ar.access_mode = 'public' and ar.allow_indexing
      and ar.example_source_id is null
      and cp.handle is not null and public.feature_released('search_indexing', cp.profile_id));
$$;

-- Statistiques admin : les exemples ne comptent pas (sinon chaque compte « aurait » 6 morceaux, 1 pack, 1 AdReel).
CREATE OR REPLACE FUNCTION public.admin_get_stats(p_period text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_composer_count int;
  v_since timestamptz;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;

  v_since := case p_period
    when '24h' then now() - interval '24 hours'
    when '7d' then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    when '6m' then now() - interval '6 months'
    when '1y' then now() - interval '1 year'
    else null
  end;

  select count(*) into v_composer_count from public.composer_profiles;

  select jsonb_build_object(
    'accounts', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'suspended', (select count(*) from public.profiles where suspended),
      'composers', v_composer_count,
      'studios', (select count(*) from public.studio_profiles),
      'fans', (select count(*) from public.fan_profiles)
    ),
    'content', jsonb_build_object(
      'adReels', (select count(*) from public.ad_reels where example_source_id is null),
      'packs', (select count(*) from public.packs where example_source_id is null),
      'tracks', (select count(*) from public.tracks where example_source_id is null),
      'sfx', (select count(*) from public.sfx_library where example_source_id is null),
      'collections', (select count(*) from public.collections),
      'albums', (select count(*) from public.albums)
    ),
    'composerAverages', jsonb_build_object(
      'tracksPerComposer', case when v_composer_count > 0 then round((select count(*)::numeric from public.tracks where example_source_id is null) / v_composer_count, 2) else 0 end,
      'packsPerComposer', case when v_composer_count > 0 then round((select count(*)::numeric from public.packs where example_source_id is null) / v_composer_count, 2) else 0 end,
      'adReelsPerComposer', case when v_composer_count > 0 then round((select count(*)::numeric from public.ad_reels where example_source_id is null) / v_composer_count, 2) else 0 end
    ),
    'newInPeriod', case when v_since is null then null else jsonb_build_object(
      'accounts', (select count(*) from public.profiles where created_at >= v_since),
      'composers', (select count(*) from public.composer_profiles where created_at >= v_since),
      'studios', (select count(*) from public.studio_profiles where created_at >= v_since),
      'fans', (select count(*) from public.fan_profiles where created_at >= v_since),
      'adReels', (select count(*) from public.ad_reels where created_at >= v_since and example_source_id is null),
      'packs', (select count(*) from public.packs where created_at >= v_since and example_source_id is null),
      'tracks', (select count(*) from public.tracks where created_at >= v_since and example_source_id is null),
      'sfx', (select count(*) from public.sfx_library where created_at >= v_since and example_source_id is null),
      'collections', (select count(*) from public.collections where created_at >= v_since),
      'albums', (select count(*) from public.albums where created_at >= v_since)
    ) end
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_growth_series(p_granularity text DEFAULT 'week'::text, p_periods integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_unit interval;
  v_start timestamptz;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  if p_granularity not in ('week', 'month') then
    raise exception 'p_granularity doit valoir ''week'' ou ''month''';
  end if;
  if p_periods is null or p_periods < 1 or p_periods > 104 then
    raise exception 'p_periods doit être compris entre 1 et 104';
  end if;

  v_unit := case p_granularity when 'week' then interval '1 week' else interval '1 month' end;
  v_start := date_trunc(p_granularity, now()) - (p_periods - 1) * v_unit;

  with buckets as (
    select generate_series(v_start, date_trunc(p_granularity, now()), v_unit) as bucket
  ),
  counted as (
    select
      b.bucket,
      (select count(*) from public.profiles p where date_trunc(p_granularity, p.created_at) = b.bucket) as accounts,
      (select count(*) from public.composer_profiles cp where date_trunc(p_granularity, cp.created_at) = b.bucket) as composers,
      (select count(*) from public.studio_profiles sp where date_trunc(p_granularity, sp.created_at) = b.bucket) as studios,
      (select count(*) from public.fan_profiles fp where date_trunc(p_granularity, fp.created_at) = b.bucket) as fans,
      (select count(*) from public.ad_reels ar where ar.example_source_id is null and date_trunc(p_granularity, ar.created_at) = b.bucket) as ad_reels,
      (select count(*) from public.packs pk where pk.example_source_id is null and date_trunc(p_granularity, pk.created_at) = b.bucket) as packs,
      (select count(*) from public.tracks tr where tr.example_source_id is null and date_trunc(p_granularity, tr.created_at) = b.bucket) as tracks,
      (select count(*) from public.sfx_library sx where sx.example_source_id is null and date_trunc(p_granularity, sx.created_at) = b.bucket) as sfx,
      (select count(*) from public.collections cl where date_trunc(p_granularity, cl.created_at) = b.bucket) as collections,
      (select count(*) from public.albums al where date_trunc(p_granularity, al.created_at) = b.bucket) as albums
    from buckets b
  )
  select jsonb_build_object(
    'granularity', p_granularity,
    'buckets', (select jsonb_agg(to_char(bucket, 'YYYY-MM-DD') order by bucket) from counted),
    'series', jsonb_build_object(
      'accounts', (select jsonb_agg(accounts order by bucket) from counted),
      'composers', (select jsonb_agg(composers order by bucket) from counted),
      'studios', (select jsonb_agg(studios order by bucket) from counted),
      'fans', (select jsonb_agg(fans order by bucket) from counted),
      'adReels', (select jsonb_agg(ad_reels order by bucket) from counted),
      'packs', (select jsonb_agg(packs order by bucket) from counted),
      'tracks', (select jsonb_agg(tracks order by bucket) from counted),
      'sfx', (select jsonb_agg(sfx order by bucket) from counted),
      'collections', (select jsonb_agg(collections order by bucket) from counted),
      'albums', (select jsonb_agg(albums order by bucket) from counted)
    )
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_adreels_report()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  return coalesce((
    select jsonb_agg(q.c order by q.published desc nulls last, q.c ->> 'handle')
    from (
      select s.published_at as published, jsonb_build_object(
        'handle', cp.handle,
        'plan', public.composer_effective_tier(cp.id),
        'createdAt', cp.created_at,
        'lastSignInAt', u.last_sign_in_at,
        'publishedAt', s.published_at,
        'tracks', (select count(*) from public.tracks t where t.owner_id = cp.id and t.retired_at is null and t.example_source_id is null),
        'packs', (select count(*) from public.packs p where p.owner_id = cp.id and p.example_source_id is null),
        'collections', (select count(*) from public.collections co where co.owner_id = cp.id),
        'albums', (select count(*) from public.albums a where a.seller_id = cp.profile_id),
        'adreels', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ar.id, 'label', ar.label, 'slug', ar.slug, 'lang', ar.lang, 'updatedAt', ar.updated_at,
            'tracks', (select count(*) from public.ad_reel_tracks art where art.ad_reel_id = ar.id and art.owner_id = ar.owner_id)
          ) order by ar.created_at)
          from public.ad_reels ar where ar.owner_id = cp.id and ar.example_source_id is null
        ), '[]'::jsonb)
      ) as c
      from public.composer_profiles cp
      join public.profiles pr on pr.id = cp.profile_id and pr.deleted_at is null
      left join auth.users u on u.id = cp.profile_id
      left join public.settings s on s.owner_id = cp.id
      where cp.handle is not null
    ) q
  ), '[]'::jsonb);
end;
$function$;
