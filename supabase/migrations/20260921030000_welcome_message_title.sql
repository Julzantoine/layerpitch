-- LayerPitch — titre pour le message d'accueil automatique (21 septembre).
--
-- Suite de 20260921020000_admin_messages_title.sql : la boîte de réception affiche un titre par
-- message, et le message de bienvenue insérait jusqu'ici sans titre (donc "Annonce LayerPitch").
-- mark_onboarding_complete() est reprise à l'identique de 20260921010000 (texte du message
-- inchangé, copié tel quel) -- seule l'insertion gagne un titre "Bienvenue sur LayerPitch" /
-- "Welcome to LayerPitch".
--
-- Rattrapage : les messages d'accueil déjà envoyés (les seuls messages ciblés sur un compte à ce
-- jour, admin_send_message n'est jamais appelé avec un destinataire depuis l'interface) reçoivent
-- le même titre. Le texte de leur corps n'est pas touché.

update public.admin_messages
   set title = jsonb_build_object('fr', 'Bienvenue sur LayerPitch', 'en', 'Welcome to LayerPitch')
 where recipient_id is not null and title is null;

create or replace function public.mark_onboarding_complete()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Non autorisé : aucune session active';
  end if;
  update public.profiles set onboarding_completed = true where id = v_uid;

  if not exists (select 1 from public.admin_messages where recipient_id = v_uid) then
    insert into public.admin_messages (body, title, recipient_id) values (
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
      ),
      jsonb_build_object('fr', 'Bienvenue sur LayerPitch', 'en', 'Welcome to LayerPitch'),
      v_uid
    );
  end if;
end;
$$;

grant execute on function public.mark_onboarding_complete() to authenticated;
