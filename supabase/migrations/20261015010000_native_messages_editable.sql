-- LayerPitch — messages « natifs » modifiables par l'admin (15 octobre).
--
-- Le message de bienvenue des nouveaux arrivants était écrit en dur dans mark_onboarding_complete() :
-- le changer exigeait une migration. Il vit maintenant dans platform_message_templates (une ligne
-- par message natif, clé = 'welcome' pour l'instant ; titre et texte une clé par langue, comme
-- admin_messages) et se modifie depuis le panneau admin.
--
-- Portée actée avec Jules-Antoine : une modification ne touche que les FUTURS arrivants (la copie
-- déjà déposée dans une boîte existante n'est pas réécrite).
-- Les messages déjà envoyés depuis le panneau (admin_messages) deviennent aussi modifiables sur
-- place via admin_update_message() : une diffusion est une seule ligne, la correction vaut donc
-- pour tous les comptes qui la voient.
--
-- Accès : RLS activée sans aucune policy, lecture/écriture uniquement par les fonctions
-- security definer ci-dessous, gardées par is_admin() (jamais de GRANT direct).

create table public.platform_message_templates (
  key text primary key,
  title jsonb not null default '{}'::jsonb,
  body jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table public.platform_message_templates is 'Messages automatiques de la plateforme (ex. bienvenue), titre et texte une clé par code langue. Lecture/écriture via admin_list_native_messages()/admin_update_native_message() (security definer, is_admin()) ; lue par mark_onboarding_complete().';
alter table public.platform_message_templates enable row level security;

-- Texte actuel de la bienvenue, repris tel quel de 20260921030000_welcome_message_title.sql.
insert into public.platform_message_templates (key, title, body) values (
  'welcome',
  jsonb_build_object('fr', 'Bienvenue sur LayerPitch', 'en', 'Welcome to LayerPitch'),
  jsonb_build_object(
    'fr', $msg_fr$Bonjour et bienvenue sur LayerPitch !

Vous faites partie des toutes premières personnes à tester cet outil qui, je l'espère, nous aidera tous et toutes à faire connaître notre travail sur la musique adaptative. Vous rejoignez une petite communauté de bêta-testeurs répartis entre l'Angleterre, la France, les Pays-Bas, la Finlande et les États-Unis, et c'est vraiment très cool !

LayerPitch est encore en bêta, et ça devrait durer au moins jusqu'en 2027 : l'interface et les fonctionnalités vont donc évoluer, mais vous avez tout le temps de vous familiariser avec les différents modes de lecture. Vous avez accès à l'ensemble des fonctionnalités déjà disponibles. Servez-vous-en comme d'un vrai outil de prospection, de pitch ou de préproduction avec un studio… ou simplement comme d'un terrain de jeu expérimental.

N'hésitez pas à fouiller, tester, casser l'outil… et surtout à me remonter des informations factuelles (« quand j'appuie sur ce bouton, rien ne se passe »), mais aussi vos « j'aime », « j'aime pas », « pour Noël, je voudrais… ». Les premiers retours m'ont déjà permis de corriger plusieurs bugs : vos idées et vos impressions (esthétique, ergonomie… et tout le reste !) me sont extrêmement précieuses. Il y a un petit formulaire en bas à gauche de votre backstage dédié à cela ; pour un problème technique, n'hésitez pas à m'envoyer des captures d'écran à julzantoine@yahoo.com.

Pour vous mettre sur les rails, j'ai commencé une série de tutos qui aborde, dans les grandes lignes, tout ce qu'on peut faire avec LayerPitch (et comment le faire) : une dizaine de vidéos sont déjà scriptées et couvrent tous les modes de lecture et les principales fonctionnalités. Il faut maintenant que j'avance dans la production des vidéos à proprement parler. La playlist va s'étoffer au fil des semaines, dès que j'arriverai à y consacrer du temps ! (Pour l'instant, elle est en bon franglish… mais si c'est bloquant et qu'une version en français peut vous aider, dites-le-moi !)

-> https://www.youtube.com/playlist?list=PLUEGG1IiDkp0

Je vous tiendrai informés de l'évolution du projet tout au long de la bêta. En attendant, je vous souhaite de choper plein de gigs grâce à LayerPitch mais aussi (et surtout) de bien vous amuser à composer et montrer de la musique interactive.

Merci encore de votre aide,

Jules-Antoine

PS : j'aimerais monter gentiment en puissance tout au long de l'automne, avec un objectif de quelques dizaines de testeurs (50, peut-être ?). Si vous connaissez des gens qui pourraient être intéressés, n'hésitez pas à les encourager à faire une demande sur www.layerpitch.com !

PS2 : en bas à gauche de l'écran, un petit bouton « cookies » vous permet d'activer Microsoft Clarity. C'est entièrement facultatif. Si vous l'activez, j'obtiens des enregistrements de votre navigation sur LayerPitch (où vous cliquez, où vous bloquez, ce qui fonctionne ou non), ce qui m'aide à améliorer l'outil. Les champs de saisie sont masqués et il n'y a aucun usage publicitaire : c'est uniquement de l'analyse d'usage. Vous pouvez changer d'avis à tout moment.$msg_fr$,
    'en', $msg_en$Hello and welcome to LayerPitch!

You're one of the very first people to test this tool, which I hope will help all of us get our adaptive music work out there. You're joining a small community of beta testers spread across England, France, the Netherlands, Finland and the United States, and that's really very cool!

LayerPitch is still in beta, and that should last until at least 2027: the interface and features will keep evolving, but you have plenty of time to get familiar with the different playback modes. You have access to everything that's currently available. Use it as a real tool for prospecting, pitching or pre-production with a studio… or simply as an experimental playground.

Feel free to poke around, test things, break the tool… and above all, let me know what you find: factual stuff ("I click this button and nothing happens") as much as your "I like this," "I don't like that," "for Christmas I'd like…" Early feedback has already helped me fix several bugs: your ideas and impressions (aesthetics, ergonomics… and everything else!) are extremely valuable to me. There's a small feedback form at the bottom left of your backstage made exactly for that; for a technical issue, feel free to send me screenshots at julzantoine@yahoo.com.

To get you started, I've put together a series of tutorials covering, in broad strokes, everything you can do with LayerPitch (and how to do it): about ten videos are already scripted, covering all the playback modes and the main features. Now I need to make progress on actually producing the videos. The playlist will keep growing over the coming weeks, as soon as I can carve out the time! (Speaking of these tutorials, please forgive my French accent… I did my best, but you can't be good at everything, right? :))

→ https://www.youtube.com/playlist?list=PLUEGG1IiDkp0

I'll keep you posted throughout the beta as the project evolves. In the meantime, I hope LayerPitch helps you land plenty of gigs, but also (and especially) that you have fun composing and showcasing interactive music.

Thanks again for your help,

Jules-Antoine

PS: I'd like to ramp up gradually throughout the autumn, with a target of a few dozen testers (50, maybe?). If you know people who might be interested, feel free to encourage them to request access at www.layerpitch.com!

PS2: at the bottom left of your screen, a small "cookies" button lets you turn on Microsoft Clarity. It's entirely optional. If you do, I get recordings of your navigation on LayerPitch (where you click, where you get stuck, what works and what doesn't), which helps me improve the tool. Input fields are masked and there is no advertising use whatsoever: it's purely usage analysis. You can change your mind at any time.$msg_en$
  )
);

create or replace function public.mark_onboarding_complete()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tpl public.platform_message_templates%rowtype;
begin
  if v_uid is null then
    raise exception 'Non autorisé : aucune session active';
  end if;
  update public.profiles set onboarding_completed = true where id = v_uid;

  if not exists (select 1 from public.admin_messages where recipient_id = v_uid) then
    select * into v_tpl from public.platform_message_templates where key = 'welcome';
    if found then
      insert into public.admin_messages (body, title, recipient_id)
        values (v_tpl.body, nullif(v_tpl.title, '{}'::jsonb), v_uid);
    end if;
  end if;
end;
$$;
grant execute on function public.mark_onboarding_complete() to authenticated;

create or replace function public.admin_list_native_messages()
returns table (key text, title jsonb, body jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  return query select t.key, t.title, t.body, t.updated_at from public.platform_message_templates t order by t.key;
end;
$$;
grant execute on function public.admin_list_native_messages() to authenticated;

create or replace function public.admin_update_native_message(p_key text, p_body jsonb, p_title jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  if p_key is distinct from 'welcome' then
    raise exception 'Message natif inconnu : %', p_key;
  end if;
  if jsonb_typeof(p_body) is distinct from 'object' then
    raise exception 'p_body doit être un objet JSON (une clé par code langue)';
  end if;
  if p_title is not null and jsonb_typeof(p_title) is distinct from 'object' then
    raise exception 'p_title doit être un objet JSON (une clé par code langue) ou null';
  end if;
  -- upsert : après une suppression, « enregistrer » recrée le message de bienvenue.
  insert into public.platform_message_templates (key, body, title)
    values (p_key, p_body, coalesce(p_title, '{}'::jsonb))
  on conflict (key) do update
    set body = excluded.body, title = excluded.title, updated_at = now();
end;
$$;
grant execute on function public.admin_update_native_message(text, jsonb, jsonb) to authenticated;

-- Suppression du modèle : plus aucun message de bienvenue automatique pour les futurs arrivants
-- (mark_onboarding_complete() ne dépose alors rien). Les boîtes déjà remplies ne changent pas.
create or replace function public.admin_delete_native_message(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  delete from public.platform_message_templates where key = p_key;
end;
$$;
grant execute on function public.admin_delete_native_message(text) to authenticated;

-- Un message diffusé peut aussi être un message d'accueil (« LayerPitch 101 : le lecteur interactif »,
-- visible des futurs comptes). welcome = true le range avec la bienvenue automatique dans le panneau
-- admin, au lieu de l'historique des envois.
alter table public.admin_messages add column welcome boolean not null default false;
comment on column public.admin_messages.welcome is 'true = message d''accueil des nouveaux arrivants, géré dans la carte « Messages d''accueil » du panneau admin plutôt que dans l''historique des envois.';
update public.admin_messages set welcome = true
 where recipient_id is null and title->>'fr' = 'LayerPitch 101 : le lecteur interactif';

drop function public.admin_list_messages();
create function public.admin_list_messages()
returns table (
  id bigint,
  body jsonb,
  title jsonb,
  created_at timestamptz,
  existing_accounts_only boolean,
  recipient_id uuid,
  recipient_email text,
  email_notify boolean,
  welcome boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;

  return query
    select m.id, m.body, m.title, m.created_at, m.existing_accounts_only, m.recipient_id, u.email::text, m.email_notify, m.welcome
    from public.admin_messages m
    left join auth.users u on u.id = m.recipient_id
    order by m.created_at desc
    limit 100;
end;
$$;
grant execute on function public.admin_list_messages() to authenticated;

-- Correction sur place d'un message déjà envoyé (diffusé ou personnel). Ne renvoie ni notification
-- ni e-mail et ne remet pas le message « non lu » : c'est une retouche, pas un nouvel envoi.
create or replace function public.admin_update_message(p_id bigint, p_body jsonb, p_title jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Non autorisé : réservé aux admins';
  end if;
  if jsonb_typeof(p_body) is distinct from 'object' then
    raise exception 'p_body doit être un objet JSON (une clé par code langue)';
  end if;
  if p_title is not null and jsonb_typeof(p_title) is distinct from 'object' then
    raise exception 'p_title doit être un objet JSON (une clé par code langue) ou null';
  end if;
  update public.admin_messages set body = p_body, title = p_title where id = p_id;
  if not found then
    raise exception 'Message introuvable : %', p_id;
  end if;
end;
$$;
grant execute on function public.admin_update_message(bigint, jsonb, jsonb) to authenticated;
