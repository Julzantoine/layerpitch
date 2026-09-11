-- LayerPitch — remplace le texte placeholder de mark_onboarding_complete() (posé dans
-- 20260911162000_admin_messages_targeting.sql) par le vrai texte de bienvenue de Jules-Antoine
-- (lettre bêta reçue le 11 septembre, fr + en). Aucun compte réel n'avait encore reçu le
-- placeholder au moment de cette migration (admin_messages vide, vérifié avant d'écrire ceci).

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
    insert into public.admin_messages (body, recipient_id) values (
      jsonb_build_object(
        'fr', $msg_fr$Bonjour et bienvenue sur LayerPitch ! Vous faites partie des toutes premières personnes à tester cet outil qui, je l'espère, nous aidera tous et toutes à faire connaître notre travail sur la musique adaptative.

La version de LayerPitch avec laquelle vous allez interagir, est encore en phase de bêta pour un petit moment… C'est-à-dire qu'il est tout à fait possible que l'interface et les fonctionnalités évoluent. Dans le cadre de cette bêta, vous avez accès à l'ensemble des fonctionnalités déjà disponibles. N'hésitez pas à fouiller, tester, casser l'outil…et surtout à me remonter des informations factuelles (quand j'appuie sur ce bouton, rien ne se passe), mais aussi vos « j'aime », « j'aime pas », « pour noël, je voudrais»... Il y'a un petit formulaire en bas à gauche de votre backstage dédié expressément à cela mais si vous me remontez des problèmes techniques, n'hésitez pas à me mettre des captures d'écran à cette adresse : julzantoine@yahoo.com.

Pour vous mettre sur les rails, j'ai commencé une série de tutos qui aborde dans les grandes lignes, tout ce qu'on peut faire avec LayerPitch (et comment le faire). Cette playlist va s'étoffer dans les prochaines semaines… Dès que j'arriverai à y consacrer du temps ! (A propos de cette série de tutos, veuillez pardonner mon accent français… J'ai fait de mon mieux mais bon, on ne peut pas être bon partout, hein ! :) )

-> https://www.youtube.com/playlist?list=PLUEGG1IiDkp0

Voilà, je crois que je vous ai dit le principal… Je vous tiendrai informés tout au long de la bêta de l'évolution du projet. En attendant, je vous souhaite de choper plein de gigs grâce à LayerPitch mais aussi (et surtout) de bien vous amuser à composer et montrer de la musique interactive.

Merci encore de votre aide,

Jules-Antoine$msg_fr$,
        'en', $msg_en$Hello and welcome to LayerPitch! You're one of the very first people to test this tool, which I hope will help all of us get our adaptive music work out there.

The version of LayerPitch you'll be using is still in beta for a while yet… meaning the interface and features may well change. As part of this beta, you have access to everything that's currently available. Feel free to poke around, test things, break the tool… and above all, let me know what you find — factual stuff ("I click this button and nothing happens") as much as your "I like this," "I don't like that," "for Christmas I'd like…" There's a small feedback form in the bottom left of your backstage made exactly for that, but if you're reporting a technical issue, feel free to send me screenshots at: julzantoine@yahoo.com.

To get you started, I've put together a series of tutorials covering, in broad strokes, everything you can do with LayerPitch (and how to do it). This playlist will keep growing over the coming weeks… as soon as I can carve out the time! (Speaking of these tutorials, please forgive my French accent… I did my best, but you can't be good at everything, right? :))

→ https://www.youtube.com/playlist?list=PLUEGG1IiDkp0

That's the gist of it, I think… I'll keep you posted throughout the beta as the project evolves. In the meantime, I hope LayerPitch helps you land plenty of gigs — but also (and especially) that you have fun composing and showcasing interactive music.

Thanks again for your help,

Jules-Antoine$msg_en$
      ),
      v_uid
    );
  end if;
end;
$$;

grant execute on function public.mark_onboarding_complete() to authenticated;
