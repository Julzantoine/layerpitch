# LayerPitch — Landing page (contenu verrouillé)

**Statut** : contenu texte finalisé et validé. Construction visuelle sur Framer (hors repo, gérée par Jules-Antoine). Ce fichier documente le contenu, pas l'implémentation.

**Décision de contexte** : cette landing page s'inscrit dans une communication anticipée avant SaaS opérationnel (parcours incubateur + produit), sur conseil reçu de l'incubateur le 25 août 2026. Le Moodboard Studios / modèle de rémunération studio reste explicitement hors périmètre de toute communication externe, y compris ici. *Une ADR documentant ce changement de règle de timing reste à rédiger — différée à la demande de Jules-Antoine tant que les autres docs (business-marche.md, extensions-roadmap.md, dossier Take Off) ne sont pas eux-mêmes poussés à jour.*

**Public cible** : compositeurs (priorité), écosystème incubateur en second plan (verra la page par rebond).

**Outil de construction** : Framer (page ne vivant pas dans le repo `layerpitch`, pour raisons de protection du code source).

---

## 1. Accroche

> **MP3 vs LayerPitch : épée en bois vs full stuff.**
> Pour avancer dans le game, mieux vaut être équipé.

---

## 2. La démo

> [Bouton : Manipulez-la vous-même →]
>
> Pas de lecture passive. Bougez le curseur, faites entrer et sortir les couches, testez la baston, l'exploration, le boss fight. C'est votre système, en vrai, entre vos mains.

**Lien** : vers un AdReel de démo complet hébergé sur GitHub Pages, ouverture en nouvel onglet (Option A retenue — pas d'embed du player dans Framer, pour limiter la complexité technique et l'exposition du moteur audio hors repo).

**Tracking à prévoir** : event de clic sur ce bouton dans Umami, pour mesurer le taux de sortie de page vers l'AdReel et objectiver plus tard une éventuelle bascule vers un player embarqué (Option B, non retenue pour l'instant).

---

## Preuve sociale (bloc positionné juste après le bloc 2)

> "The branching music system really has the ability to wow someone!"
> — Michael W., compositeur de jeu vidéo / enseignant en MA Composition for Video Game
>
> "That's genuinely cool for game composers' reel!"
> — Giorgio V., sound designer / enseignant en MA Sound Design for Video Games

**Format** : deux citations côte à côte, statique (pas de carrousel — pertinent seulement à partir de 4-5 témoignages). Structure pensée pour accueillir une grille 2→3 colonnes si d'autres retours s'ajoutent via la bêta.

**Position** : juste après la démo — les citations décrivent l'expérience de manipulation, donc plus fortes à chaud, juste après que le visiteur vient de la vivre.

---

## 3. Le problème

> Votre métier, c'est de fluidifier l'expérience du joueur. Pas de compliquer celle du studio en lui apportant de nouvelles problématiques.
>
> Un MP3 dit comment votre musique sonne. Il ne dit rien sur comment elle marche — les couches, les transitions, la logique derrière.
>
> Le gamedev/studio ne peut pas savoir ce que ça donnerait en pleine bagarre, en exploration tranquille, ou pendant un boss fight à 10% de vie.
>
> Avec LayerPitch, vous permettez à votre interlocuteur de se projeter dans le jeu grâce à votre musique — et augmentez vos chances de remporter le gig.

---

## 4. Ce que ça change

> - **5 modes de lecture adaptative** — du layering vertical classique au branchement piloté par le joueur.
> - **Contrôle en direct** — votre interlocuteur joue avec votre musique en ajustant l'intensité, en coupant des couches, en explorant les embranchements lui-même.
> - **Un lien, point barre** — aucune install, aucun fichier à dézipper avec méfiance. Ça s'ouvre comme une page web.
> - **Sur-mesure, jusqu'au bout** — chaque AdReel se personnalise entièrement, à votre image ou à celle du studio visé.
> - **Vous savez qui a vraiment testé** — un suivi par AdReel vous dit qui a ouvert le lien, joué avec quoi, combien de temps. Fini de deviner si le studio a vraiment écouté.

*Note : le point "sur-mesure, jusqu'au bout" s'appuie sur l'onglet Apparence du Backstage (personnalisation confirmée existante), sans détail exhaustif de ce qui est personnalisable — formulation volontairement générale pour rester exacte sans sur-promettre.*

---

## 5. Parcours

> J'ai toujours trouvé ça dommage : construire des systèmes musicaux complexes, puis devoir les aplatir en un simple MP3 pour les pitcher à des studios.
>
> LayerPitch est né de cette frustration. De fil en aiguille, l'idée a pris forme — jusqu'à être aujourd'hui accompagnée par Plaine Images / Take Off Inspiration, l'incubateur musique tech en partenariat avec la Sacem.

**⚠️ Point de vigilance factuel** : ce texte est rédigé en assumant une admission confirmée, alors que le statut réel au 25 août 2026 est un accord oral informel du startup manager, pas encore une décision formelle communiquée. Jules-Antoine a validé ce choix en connaissance de cause (confiance à 99 %, publication de la page prévue après confirmation officielle). **Ne pas publier ce bloc tel quel avant confirmation officielle explicite.**

---

## 6. CTA final

> LayerPitch entrera bientôt en phase de bêta test.
>
> [Champ email]
> [Bouton : Je suis intéressé par la bêta] [Bouton : Tenez-moi juste au courant]
>
> Pas de spam, pas d'engagement.

**Implémentation technique prévue** : les deux boutons pointent vers le même formulaire Formspree (déjà utilisé pour la bêta), avec un champ caché `intent` distinguant `beta` vs `waitlist` — segmentation sans doubler l'infrastructure.

---

## Points en suspens

- Bloc 5 : ne pas publier avant confirmation officielle de l'admission Take Off.
- Champ caché `intent` sur le formulaire Formspree : à implémenter côté Framer par Jules-Antoine.
- Event de clic (bouton démo bloc 2) à ajouter dans Umami une fois la page en ligne.
- ADR sur la levée du principe "pas de diffusion avant SaaS opérationnel" : à rédiger une fois les autres docs (business-marche.md, extensions-roadmap.md, dossier Take Off actualisé) poussés à jour sur GitHub.
