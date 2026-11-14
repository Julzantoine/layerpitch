-- LayerPitch — courriers d'accueil remis à jour (4 novembre).
--
-- Demandé par Jules-Antoine : plus aucune référence aux tutos vidéo (le tutoriel interactif les
-- remplace), mention des morceaux d'exemple préchargés dans la bibliothèque, adresse de contact
-- contact@layerpitch.com, et un message de bienvenue propre aux studios, centré sur le mode Projet.
--
-- 1. Bienvenue compositeur (platform_message_templates 'welcome') : réécrite. Ne touche que les
--    futurs arrivants (règle du 15/10).
-- 2. Bienvenue studio (nouvelle clé 'welcome_studio') : déposée à la place de 'welcome' quand le
--    compte a un profil studio et aucun profil compositeur (bienvenue.html crée le profil studio
--    AVANT d'appeler mark_onboarding_complete). Sans modèle studio, on retombe sur 'welcome'.
-- 3. « LayerPitch 101 » (admin_messages id 34, diffusé le 08/10 et rangé en accueil) : réécrit sur
--    place. C'est une seule ligne vue de tous : les anciens testeurs voient aussi la nouvelle
--    version, écrite pour marcher pour les deux.
-- 4. admin_update_native_message accepte la nouvelle clé (modifiable depuis le panneau admin).

update public.platform_message_templates
set title = jsonb_build_object('fr', 'Bienvenue sur LayerPitch', 'en', 'Welcome to LayerPitch'),
    body = jsonb_build_object(
      'fr', $fr$Bonjour et bienvenue sur LayerPitch !

Vous faites partie des toutes premières personnes à tester cet outil qui, je l'espère, nous aidera tous et toutes à faire connaître notre travail sur la musique adaptative. Vous rejoignez une petite communauté de bêta-testeurs répartis entre l'Angleterre, la France, les Pays-Bas, la Finlande et les États-Unis, et c'est vraiment très cool !

LayerPitch est encore en bêta, et ça devrait durer au moins jusqu'en 2027 : l'interface et les fonctionnalités vont donc évoluer, mais vous avez tout le temps de vous familiariser avec l'outil. Vous avez accès à l'ensemble des fonctionnalités déjà disponibles. Servez-vous-en comme d'un vrai outil de prospection, de pitch ou de préproduction avec un studio… ou simplement comme d'un terrain de jeu expérimental.

Par où commencer ? Le plus simple, c'est le menu « Tutoriel », en haut de votre Backstage. Chaque leçon vous guide pas à pas avec des morceaux d'exemple déjà prêts : vous faites les gestes vous-même, une bulle vous accompagne, et une pastille indique les leçons qu'il vous reste à faire. Deux parcours sont ouverts :
– Le moteur audio (10 leçons) : un mode de lecture par leçon, du statique à l'hybride, plus les SFX et les FX.
– Pitcher et vendre (9 leçons) : créer un AdReel, le diffuser, savoir qui l'a regardé, vendre des packs d'assets et des OST interactives.
Un troisième parcours, sur la collaboration entre studio et compositeur (espace Projet, Moodboard, carte musicale, versioning vidéo), arrive bientôt.

Et pour expérimenter librement, vous trouverez dans votre bibliothèque un dossier « Exemples » : de courtes compositions, une par mode de lecture, avec un pack et un AdReel de démo. Elles sont là pour ça : modifiez-les, essayez-les, cassez tout ! Quand vous n'en avez plus besoin, le bouton « Retirer les exemples » les efface toutes.

N'hésitez pas à fouiller, tester, casser l'outil… et surtout à me remonter des informations factuelles (« quand j'appuie sur ce bouton, rien ne se passe »), mais aussi vos « j'aime », « j'aime pas », « pour Noël, je voudrais… ». Les premiers retours m'ont déjà permis de corriger plusieurs bugs : vos idées et vos impressions (esthétique, ergonomie… et tout le reste !) me sont extrêmement précieuses. Le plus simple est le bouton « Faire un retour sur la version », en bas du menu de gauche : vous pouvez y joindre une capture d'écran, et ça arrive directement chez moi. Sinon, écrivez-moi à contact@layerpitch.com.

Je vous tiendrai informés de l'évolution du projet tout au long de la bêta. En attendant, je vous souhaite de décrocher plein de projets grâce à LayerPitch, mais aussi (et surtout) de bien vous amuser à composer et à montrer de la musique interactive.

Merci encore de votre aide,

Jules-Antoine

PS : si vous connaissez des gens qui pourraient être intéressés (compositeurs, compositrices ou studios), n'hésitez pas à les encourager à faire une demande sur www.layerpitch.com !

PS2 : en bas à gauche de l'écran, un petit bouton « cookies » vous permet d'activer Microsoft Clarity. C'est entièrement facultatif. Si vous l'activez, j'obtiens des enregistrements de votre navigation sur LayerPitch (où vous cliquez, où vous bloquez, ce qui fonctionne ou non), ce qui m'aide à améliorer l'outil. Les champs de saisie sont masqués et il n'y a aucun usage publicitaire : c'est uniquement de l'analyse d'usage. Vous pouvez changer d'avis à tout moment.$fr$,
      'en', $en$Hello and welcome to LayerPitch!

You're one of the very first people to test this tool, which I hope will help all of us get our adaptive music work out there. You're joining a small community of beta testers spread across England, France, the Netherlands, Finland and the United States, and that's really very cool!

LayerPitch is still in beta, and that should last until at least 2027: the interface and features will keep evolving, but you have plenty of time to get familiar with the tool. You have access to everything that's currently available. Use it as a real tool for prospecting, pitching or pre-production with a studio… or simply as an experimental playground.

Where to start? The easiest way is the "Tutorial" menu at the top of your Backstage. Each lesson guides you step by step with ready-made sample tracks: you do the gestures yourself, a bubble walks you through, and a badge shows the lessons you still have to do. Two paths are open:
– The audio engine (10 lessons): one playback mode per lesson, from static to hybrid, plus SFX and FX.
– Pitch and sell (9 lessons): create an AdReel, share it, see who watched it, sell asset packs and interactive OSTs.
A third path, on studio/composer collaboration (Project space, Moodboard, music map, video versioning), is coming soon.

And to experiment freely, you'll find an "Examples" folder in your library: short compositions, one per playback mode, plus a demo pack and a demo AdReel. That's what they're for: edit them, try them, break everything! When you no longer need them, the "Remove examples" button deletes them all.

Feel free to poke around, test things, break the tool… and above all, let me know what you find: factual stuff ("I click this button and nothing happens") as much as your "I like this," "I don't like that," "for Christmas I'd like…" Early feedback has already helped me fix several bugs: your ideas and impressions (aesthetics, ergonomics… and everything else!) are extremely valuable to me. The easiest way is the "Give feedback on this version" button at the bottom of the left-hand menu: you can attach a screenshot, and it comes straight to me. Otherwise, write to me at contact@layerpitch.com.

I'll keep you posted throughout the beta as the project evolves. In the meantime, I hope LayerPitch helps you land plenty of projects, but also (and especially) that you have fun composing and showcasing interactive music.

Thanks again for your help,

Jules-Antoine

PS: if you know people who might be interested (composers or studios), feel free to encourage them to request access at www.layerpitch.com!

PS2: at the bottom left of your screen, a small "cookies" button lets you turn on Microsoft Clarity. It's entirely optional. If you do, I get recordings of your navigation on LayerPitch (where you click, where you get stuck, what works and what doesn't), which helps me improve the tool. Input fields are masked and there is no advertising use whatsoever: it's purely usage analysis. You can change your mind at any time.$en$),
    updated_at = now()
where key = 'welcome';

insert into public.platform_message_templates (key, title, body) values (
  'welcome_studio',
  jsonb_build_object('fr', 'Bienvenue sur LayerPitch', 'en', 'Welcome to LayerPitch'),
  jsonb_build_object(
    'fr', $fr$Bonjour et bienvenue sur LayerPitch !

Merci de rejoindre la bêta studios. LayerPitch est né du côté des compositeurs, pour présenter de la musique adaptative ; avec vous, je teste maintenant l'autre moitié de l'outil : le travail commun entre un studio et ses compositeurs, dans un espace dédié à chaque jeu.

LayerPitch est encore en bêta, et ça devrait durer au moins jusqu'en 2027 : l'interface et les fonctionnalités vont donc évoluer. Vous avez accès à l'ensemble des fonctionnalités déjà disponibles, sans aucun paiement réel.

Par où commencer ? Par le mode Projet. Un projet, c'est l'espace de travail commun d'un jeu : vous y invitez vos compositeurs, vous échangez dans le tchat (un canal général et un par section), vous rassemblez vos notes, images et références dans un Moodboard, vous retrouvez la musique qu'on vous propose, vous comparez des versions musicales sur vos vidéos, et vous construisez une carte de niveau pour entendre la musique changer d'un lieu à l'autre.

Le menu « Tutoriel », en haut de l'écran, a un parcours dédié, avec un projet d'exemple déjà prêt : vous faites les gestes vous-même, une bulle vous accompagne. Les leçons : Créer un projet, Le tchat du projet, Le Moodboard, Versioning vidéo, La musique du projet, puis la carte de niveau (la construire, la musique, se balader).

N'hésitez pas à fouiller, tester, casser l'outil… et surtout à me remonter vos retours : ce qui bloque (« quand j'appuie sur ce bouton, rien ne se passe »), ce qui manque dans votre façon de travailler avec un compositeur, vos « j'aime », « j'aime pas »… Tout m'est extrêmement précieux pour construire un outil qui colle à la réalité d'un studio. Écrivez-moi à contact@layerpitch.com, captures d'écran bienvenues.

Je vous tiendrai informés de l'évolution du projet tout au long de la bêta.

Merci encore de votre aide,

Jules-Antoine

PS : si vous connaissez d'autres studios, ou des compositeurs et compositrices avec qui vous aimeriez essayer l'outil, encouragez-les à faire une demande sur www.layerpitch.com !$fr$,
    'en', $en$Hello and welcome to LayerPitch!

Thanks for joining the studio beta. LayerPitch was born on the composer side, to showcase adaptive music; with you, I'm now testing the other half of the tool: studios and their composers working together, in a dedicated space for each game.

LayerPitch is still in beta, and that should last until at least 2027: the interface and features will keep evolving. You have access to everything that's currently available, with no real payments.

Where to start? With Project mode. A project is the shared workspace for a game: you invite your composers, talk in the chat (one general channel plus one per section), gather notes, images and references in a Moodboard, find the music that's been sent to you, compare musical versions on your videos, and build a level map to hear the music change from one place to the next.

The "Tutorial" menu at the top of the screen has a dedicated path, with a ready-made sample project: you do the gestures yourself, a bubble walks you through. The lessons: Create a project, The project chat, The Moodboard, Video versioning, The project's music, then the level map (build it, the music, take a walk).

Feel free to poke around, test things, break the tool… and above all, send me your feedback: what gets in your way ("I click this button and nothing happens"), what's missing from the way you work with a composer, what you like and don't like… It's all extremely valuable to build a tool that fits the reality of a studio. Write to me at contact@layerpitch.com, screenshots welcome.

I'll keep you posted throughout the beta as the project evolves.

Thanks again for your help,

Jules-Antoine

PS: if you know other studios, or composers you'd like to try the tool with, encourage them to request access at www.layerpitch.com!$en$)
)
on conflict (key) do nothing;

update public.admin_messages
set title = jsonb_build_object('fr', 'LayerPitch 101 : le lecteur interactif', 'en', 'LayerPitch 101 : Interactive Player'),
    body = jsonb_build_object(
      'fr', $fr$Bonjour à toutes et à tous,

La prise en main de LayerPitch peut prendre un peu de temps. Voici donc un petit mode d'emploi pour mettre en ligne votre premier morceau : un tour des modes de lecture, avec pour chacun la leçon correspondante du menu « Tutoriel » (en haut de votre Backstage) et un morceau d'exemple, déjà rangé dans le dossier « Exemples » de votre bibliothèque, à triturer autant que vous voulez.

Statique.
Votre morceau est linéaire (un générique, par exemple) ou doit boucler. Le réglage « Moteur de bouclage » propose deux choix :
- Simple : vous avez préparé le morceau pour qu'il boucle sans artefact (par exemple en recollant la queue de reverb au début).
- Quantifié : vous indiquez le point de départ, le début et la fin de la boucle, et LayerPitch boucle tout en laissant sonner les queues de reverb.
Leçon 1 · Exemple : « Example 1 - EZ Jazz Statique »

Embranchement vertical.
Votre morceau doit bifurquer vers une autre branche selon une situation : par exemple, l'étoile d'invincibilité de Mario.
Leçon 2 · Exemple : « Example 2 - EZ Jazz Embranchement vertical »

Layering vertical additif.
Votre morceau a plusieurs couches qui s'ajoutent selon un paramètre du jeu (un RTPC) : par exemple, la musique monte avec le nombre d'ennemis à l'écran.
Leçon 3 · Exemple : « Example 3 - EZ Jazz Layering vertical additif »

Layering vertical randomisé.
Chaque section propose plusieurs alternatives (plusieurs parties de cordes, plusieurs lignes de basse), et le moteur en tire une au hasard à chaque lecture : par exemple, pour un morceau qui doit être volontairement long sans pour autant être répétitif. Un menu, par exemple.
Leçon 4 · Exemple : « Example 4 - EZ Jazz Layering vertical randomisé »

Séquentiel.
Votre morceau est fait de plusieurs cycles de quelques mesures, joués dans un ordre précis ou aléatoire : par exemple, une ambiance d'exploration qui ne se répète jamais à l'identique.
Leçon 5 · Exemple : « Example 5 - EZ Jazz Séquentiel »

Séquentiel à embranchement.
Même mode, avec la case « Prévoir un ou plusieurs embranchements » cochée. Pour les morceaux qui bifurquent plusieurs fois : par exemple, la section exploration boucle (avec son contenu randomisé), puis, sur un événement (une attaque ennemie), bascule avec ou sans transition vers la section combat.
Leçon 6 · Exemple : « Example 6 - EZ Jazz Séquentiel à embranchement »

Hybride à sections.
Votre morceau enchaîne plusieurs sections, chacune avec son propre mode : par exemple, une ouverture en couches additives, puis une partie séquentielle, puis une fin statique. Vous choisissez où et comment on passe d'une section à l'autre (points et fichiers de transition).
Leçon 9

Hybride à embranchement.
Même principe, mais les sections forment un arbre : on choisit son chemin d'une section à l'autre, comme dans une balade où chaque carrefour mène à une musique différente.
Leçon 10

Les leçons 7 et 8 vous montrent aussi comment ajouter des SFX et des FX à vos morceaux.

Une question, un blocage ? Dites-le-moi par le bouton « Faire un retour sur la version », en bas du menu de gauche, ou directement par e-mail (contact@layerpitch.com).

Jules-Antoine$fr$,
      'en', $en$Hello everyone,

Getting started with LayerPitch can take a bit of time. So here is a short guide to help you get your first track online: a quick tour of the playback modes, each with its matching lesson in the "Tutorial" menu (at the top of your Backstage) and a sample track, already waiting in the "Examples" folder of your library for you to tinker with as much as you like.

Static.
Your track is linear (a main theme or credits, for example) or needs to loop. The "Loop engine" setting offers two choices:
- Simple: you've prepared the track so that it loops without artefacts (for example by cutting the reverb tail and pasting it back at the start).
- Quantized: you enter the start point, the loop start and the loop end, and LayerPitch loops it while letting the reverb tails ring out.
Lesson 1 · Example: "Example 1 - EZ Jazz Static"

Vertical branching.
Your track needs to switch to another branch depending on a situation: for example, Mario's invincibility star.
Lesson 2 · Example: "Example 2 - EZ Jazz Vertical branching"

Additive vertical layering.
Your track has several layers that stack up depending on a game parameter (an RTPC): for example, the music builds up with the number of enemies on screen.
Lesson 3 · Example: "Example 3 - EZ Jazz Additive vertical layering"

Randomized vertical layering.
Each section offers several alternatives (several string parts, several bass lines), and the engine picks one at random each time it plays: for example, for a track that has to be deliberately long without being repetitive. A menu, for instance.
Lesson 4 · Example: "Example 4 - EZ Jazz Randomized vertical layering"

Sequential.
Your track is made of several cycles of a few bars each, played in a set or random order: for example, an exploration ambience that never repeats itself the same way twice.
Lesson 5 · Example: "Example 5 - EZ Jazz Sequential"

Sequential branching.
Same mode, with the "Plan one or more branches" box ticked. For tracks that branch off several times: for example, the exploration section loops (with its randomized content), then, on an event (an enemy attack), switches, with or without a transition, to the combat section.
Lesson 6 · Example: "Example 6 - EZ Jazz Sequential branching"

Hybrid with sections.
Your track chains several sections, each with its own mode: for example, an opening in additive layers, then a sequential part, then a static ending. You choose where and how the music moves from one section to the next (transition points and files).
Lesson 9

Hybrid with branching.
Same idea, but the sections form a tree: you pick your path from one section to the next, like a walk where every crossroads leads to different music.
Lesson 10

Lessons 7 and 8 also show you how to add SFX and FX to your tracks.

A question, something blocking you? Tell me through the "Give feedback on this version" button at the bottom of the left-hand menu, or directly by email (contact@layerpitch.com).

Jules-Antoine$en$)
where id = 34 and welcome = true;

create or replace function public.mark_onboarding_complete()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := 'welcome';
  v_tpl public.platform_message_templates%rowtype;
begin
  if v_uid is null then
    raise exception 'Non autorisé : aucune session active';
  end if;
  update public.profiles set onboarding_completed = true where id = v_uid;

  if not exists (select 1 from public.admin_messages where recipient_id = v_uid) then
    -- Studio seul (4/11) : bienvenue centrée sur le mode Projet. Un compte qui a les deux profils
    -- garde la bienvenue compositeur.
    if exists (select 1 from public.studio_profiles where profile_id = v_uid)
       and not exists (select 1 from public.composer_profiles where profile_id = v_uid) then
      v_key := 'welcome_studio';
    end if;
    select * into v_tpl from public.platform_message_templates where key = v_key;
    if not found and v_key <> 'welcome' then
      select * into v_tpl from public.platform_message_templates where key = 'welcome';
    end if;
    if found then
      insert into public.admin_messages (body, title, recipient_id)
        values (v_tpl.body, nullif(v_tpl.title, '{}'::jsonb), v_uid);
    end if;
  end if;
end;
$$;
grant execute on function public.mark_onboarding_complete() to authenticated;

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
  if p_key is null or p_key not in ('welcome', 'welcome_studio') then
    raise exception 'Message natif inconnu : %', p_key;
  end if;
  if jsonb_typeof(p_body) is distinct from 'object' then
    raise exception 'p_body doit être un objet JSON (une clé par code langue)';
  end if;
  if p_title is not null and jsonb_typeof(p_title) is distinct from 'object' then
    raise exception 'p_title doit être un objet JSON (une clé par code langue) ou null';
  end if;
  insert into public.platform_message_templates (key, body, title)
    values (p_key, p_body, coalesce(p_title, '{}'::jsonb))
  on conflict (key) do update
    set body = excluded.body, title = excluded.title, updated_at = now();
end;
$$;
grant execute on function public.admin_update_native_message(text, jsonb, jsonb) to authenticated;
