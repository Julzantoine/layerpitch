-- Sécurité (audit du 16/11, B1) : noms d'images des pages publiques verrouillés côté base.
--
-- Un nom d'image (logo, photo, avatar de témoignage, images d'un bloc photo, fond de thème ou de bloc, vignette de
-- vidéo, illustration et filigrane d'un pack, illustration d'une collection) est collé par les pages publiques dans
-- une adresse d'image. Jusqu'ici n'importe quelle chaîne était acceptée : un compositeur pouvait enregistrer un « nom »
-- contenant `"` puis du code, exécuté chez chaque visiteur de son AdReel / pack / collection (vol de session, y compris
-- celle d'un admin connecté, même adresse beta.layerpitch.com). Les pages échappent désormais ces noms (src/reel,
-- src/pack, collection.html, library.html) ; ce verrou est la deuxième barrière, valable pour TOUS les chemins
-- d'écriture (fonctions upsert_*, écriture directe autorisée par les règles d'accès, Edge Functions).
--
-- Forme acceptée : celle que fabrique le Backstage (src/backstage/42-publication.js) — « <id du compositeur>/logo-<id>.png »,
-- ou les anciens noms à plat « photo-main.jpg » : lettres, chiffres, point, tiret, tiret bas, barre oblique ; premier
-- caractère lettre ou chiffre ; pas de « .. ». Vide ou absent = pas d'image, toujours accepté.
-- Noms déjà en base : contrôlés au moment d'appliquer cette migration (bloc « Contrôle de l'existant » plus bas). Si un
-- seul ne respecte pas la forme, la migration s'arrête SANS RIEN CHANGER et liste les fautifs — sinon le compositeur
-- concerné ne pourrait plus enregistrer son AdReel / pack / collection.

create or replace function public.assert_media_name(p_value text, p_field text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_value is null or p_value = '' then
    return;
  end if;
  if p_value !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$' or position('..' in p_value) > 0 then
    raise exception 'Nom d''image refusé (%): seuls lettres, chiffres, point, tiret, tiret bas et / sont permis', p_field
      using errcode = '22023';
  end if;
end;
$$;

-- Tableau JSON attendu ; toute autre forme (objet, texte, null) est traitée comme « aucun élément ».
create or replace function public.media_json_array(p jsonb)
returns setof jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select e from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e
$$;

create or replace function public.assert_ad_reel_media_names(p_profile jsonb, p_testimonials jsonb, p_blocks jsonb)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  b jsonb;
  x jsonb;
begin
  -- Seules les valeurs texte sont des noms ; une valeur d'un autre type (nombre, objet) est refusée elle aussi, car
  -- les pages la convertiraient en texte avant de la coller dans l'adresse.
  if jsonb_typeof(p_profile -> 'logo') not in ('string', 'null') then raise exception 'Nom d''image refusé (logo)' using errcode = '22023'; end if;
  if jsonb_typeof(p_profile -> 'photo') not in ('string', 'null') then raise exception 'Nom d''image refusé (photo)' using errcode = '22023'; end if;
  perform public.assert_media_name(p_profile ->> 'logo', 'logo');
  perform public.assert_media_name(p_profile ->> 'photo', 'photo');
  perform public.assert_media_name(p_profile -> 'theme' ->> 'bgImage', 'fond du thème');

  for x in select * from public.media_json_array(p_testimonials) loop
    if jsonb_typeof(x -> 'avatar') not in ('string', 'null') then raise exception 'Nom d''image refusé (avatar)' using errcode = '22023'; end if;
    perform public.assert_media_name(x ->> 'avatar', 'avatar de témoignage');
  end loop;

  for b in select * from public.media_json_array(p_blocks) loop
    perform public.assert_media_name(b -> 'appearance' ->> 'bgImage', 'fond de bloc');
    for x in select * from public.media_json_array(b -> 'images') loop
      if jsonb_typeof(x -> 'file') not in ('string', 'null') then raise exception 'Nom d''image refusé (bloc photo)' using errcode = '22023'; end if;
      perform public.assert_media_name(x ->> 'file', 'image d''un bloc photo');
    end loop;
    for x in select * from public.media_json_array(b -> 'videos') loop
      perform public.assert_media_name(x ->> 'thumbnail', 'vignette de vidéo');
    end loop;
  end loop;
end;
$$;

create or replace function public.ad_reels_media_names_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform public.assert_ad_reel_media_names(new.profile, new.testimonials, new.blocks);
  return new;
end;
$$;

create or replace function public.packs_media_names_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform public.assert_media_name(new.illustration, 'illustration du pack');
  perform public.assert_media_name(new.watermark, 'filigrane du pack');
  return new;
end;
$$;

create or replace function public.collections_media_names_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform public.assert_media_name(new.illustration, 'illustration de la collection');
  return new;
end;
$$;

-- Contrôle de l'existant (voir en-tête) : rien n'est modifié, la migration s'arrête si un nom déjà en base serait refusé.
do $$
declare
  r record;
  bad text[] := '{}';
begin
  for r in select id, profile, testimonials, blocks from public.ad_reels loop
    begin perform public.assert_ad_reel_media_names(r.profile, r.testimonials, r.blocks);
    exception when others then bad := bad || ('AdReel ' || r.id || ' : ' || sqlerrm); end;
  end loop;
  for r in select id, illustration, watermark from public.packs loop
    begin perform public.assert_media_name(r.illustration, 'illustration'); perform public.assert_media_name(r.watermark, 'filigrane');
    exception when others then bad := bad || ('pack ' || r.id || ' : ' || sqlerrm); end;
  end loop;
  for r in select id, illustration from public.collections loop
    begin perform public.assert_media_name(r.illustration, 'illustration');
    exception when others then bad := bad || ('collection ' || r.id || ' : ' || sqlerrm); end;
  end loop;
  if array_length(bad, 1) > 0 then
    raise exception 'Noms d''images déjà en base qui seraient refusés (% au total) : %', array_length(bad, 1), array_to_string(bad[1:20], ' | ');
  end if;
end;
$$;

drop trigger if exists ad_reels_media_names_guard on public.ad_reels;
create trigger ad_reels_media_names_guard
  before insert or update of profile, testimonials, blocks on public.ad_reels
  for each row execute function public.ad_reels_media_names_guard();

drop trigger if exists packs_media_names_guard on public.packs;
create trigger packs_media_names_guard
  before insert or update of illustration, watermark on public.packs
  for each row execute function public.packs_media_names_guard();

drop trigger if exists collections_media_names_guard on public.collections;
create trigger collections_media_names_guard
  before insert or update of illustration on public.collections
  for each row execute function public.collections_media_names_guard();

-- Fonctions des déclencheurs : personne n'a à les appeler directement. assert_media_name et media_json_array restent
-- appelables (sans danger : elles ne lisent ni n'écrivent rien) car le déclencheur s'exécute avec les droits du
-- compositeur qui enregistre, et a donc besoin de pouvoir les appeler.
revoke all on function public.ad_reels_media_names_guard() from public, anon, authenticated;
revoke all on function public.packs_media_names_guard() from public, anon, authenticated;
revoke all on function public.collections_media_names_guard() from public, anon, authenticated;
