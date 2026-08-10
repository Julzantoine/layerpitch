# LAYERPITCH — EXTENSIONS ENVISAGÉES & ROADMAP
*Extrait de `MASTER.md` le 28 juillet 2026. Aucune de ces idées n'est engagée côté développement au-delà de ce qui est marqué ✅ ailleurs (`architecture.md`, `audio-engine.md`). Réserve d'idées pour le dossier incubateur et la discussion avec le startup manager, pas un engagement de sprint.*

## Point de qualité ouvert — contraste des couleurs

Signalé par un retour compositeur externe : le gris clair utilisé pour le texte n'offrirait pas un contraste suffisant pour les personnes malvoyantes (norme WCAG AA : ratio ≥ 4,5:1 texte normal, 3:1 grand texte). À vérifier avec un contrast checker (ex. WebAIM) sur les couleurs `bgColor`/`textColor` publiées, et ajuster si insuffisant. **Défaut d'accessibilité sur l'existant, pas une feature à roadmapper — prioritaire sur les nouvelles idées ci-dessous.**

## 0. Modes de lecture — nouvelle famille de modes hybrides

**Contexte et intention stratégique** : renforcer la précision technique du vocabulaire des modes de lecture pour maximiser l'attrait de LayerPitch comme terrain de jeu pour des compositeurs exigeants — la sophistication de la nomenclature devient elle-même un argument de différenciation.

**0.1 Renommage : « Vertical layering » → « Vertical additif »** — le mode V1 serait renommé pour distinguer le principe (couches d'intensité qui s'additionnent) et libérer "vertical" pour toute une famille de modes. Renommage cosmétique, aucun changement de comportement.

**Vertical additif randomisé** et **vertical additif séquentiel** — extensions hybrides documentées comme prolongements de cette famille, non commencées.

## 2. Backstage et organisation

**2.2 Restructuration du backstage en onglets** *(7 juillet)* — à mesure que le backstage accumule des sections, la navigation en long scroll devient difficile (comparaison ReelCrafter : onglets Media/Embedded Player/Social Sharing/Details/History). Principe retenu : deux niveaux de navigation — onglets globaux (Bibliothèque, Packs, Projet(s), à terme Compte/Réglages) + sélecteur d'AdReel avec Contenu/Apparence pour l'AdReel sélectionné. Les blocs de page restent une liste réordonnable/repliable, pas remplacés par la logique d'onglets. Idée gardée au chaud : "History" (historique de versions), non priorisé. Statut : principe validé, pas conçu dans le détail ni codé. Pas de dépendance backend.

## 3. Intelligence artificielle

**3.1 Smart Import IA** *(7 juillet)* — le compositeur dépose des stems + description en langage naturel, un appel LLM transforme ça en JSON conforme au schéma `tracks[]`, préremplissant le formulaire (relu et validé avant publication). Nature : extraction texte → structure, pas d'analyse audio. Hypothèse : stems pré-alignés (sinon message d'erreur, pas de resynchronisation automatique). Niveaux écartés : démo complète avec transitions (au-delà de ce que l'embranchement-vertical/`nextOptions` livrés le 31 juillet couvrent — un scénario scripté avec transitions cinématiques reste hors périmètre) et import direct Wwise/FMOD (jugé surestimé — les notions de branchement conditionnel n'ont nulle part où exister dans le schéma actuel, les SoundBanks compilées ne contiennent pas toujours l'audio source exploitable). **Coût vérifié** (7 juillet) : ~0,4 à 1 centime par appel (Haiku 4.5 ou Sonnet 5), quelques dollars à ~15$/mois dans le scénario SOM le plus ambitieux — non un frein. Contrainte : clé API jamais exposée côté navigateur → nécessite un backend. Décision actée : pas de système de clé API fournie par l'utilisateur. Phasage : bêta au mieux, sinon déploiement complet.

**3.2 Interface à prompt (couche de commandes IA)** *(7 juillet)* — langage naturel déclenchant des actions ("crée un pack avec ces trois morceaux", "duplique ma page principale pour le studio X") plutôt que navigation dans les menus. Différence avec Smart Import : celui-ci transforme du contenu en données, l'Interface à prompt exécute des actions sur l'état de l'appli — une action mal interprétée a un effet réel. Mécanique : function calling/tool use. Décision actée : toujours un aperçu avant exécution, jamais d'exécution directe sans confirmation (cohérent avec la logique déjà en place pour la publication GitHub). Audience : backstage compositeur ET côté acheteur. Dépendance structurelle : couche par-dessus des fonctionnalités déjà existantes — sa valeur grandit à mesure que le reste de la roadmap avance. Phasage : bêta ou déploiement, après construction des fonctionnalités orchestrées.

**3.3 Traduction automatisée à la demande** *(14 juillet)* — traduire bio/textes de morceaux/packs à partir de l'échafaudage i18n existant. Nuance actée : traduction proposée à valider par le compositeur avant publication, jamais automatique.

**3.4 Assistant IA pour l'analyse d'usage plateforme** *(3 août)* — extension naturelle du principe déjà en place dans `admin-beta-console.html` (agrégation des `events.json` par utilisateur), une fois la bascule backend faite et de vrais clients payants en usage réel — pas limité aux testeurs bêta. Les événements déjà typés et structurés (`intensity_change`, `voice_solo_toggle`, `track_play`, `publish_click`, etc.) permettent une analyse en langage naturel sans traitement audio ni comportemental complexe. Exemples concrets de questions visées : quels modes de lecture sont les plus utilisés par les compositeurs, nombre moyen d'AdReels par compositeur, taux d'engagement des destinataires (interaction réelle avec l'adaptativité — curseur d'intensité, solo/mute — plutôt que simple lecture passive). Deux formes possibles, non exclusives : question libre posée par Jules-Antoine, ou rapport automatique périodique. Même contrainte que Smart Import IA/Interface à prompt : nécessite un backend (clé API jamais exposée côté client), coût attendu du même ordre de grandeur (quelques centimes par requête). **Point de vigilance propre à cette extension, absent des autres idées IA** : l'analyse porte sur l'usage agrégé de tous les clients, pas seulement les données propres d'un compositeur — implique une couverture explicite dans la conformité RGPD (déjà une des six briques manquantes du backend), pas une simple extension technique.

## 4. Visualisation et confort d'usage

**4.1 Waveform à la lecture (page publique)** *(7 juillet, retour compositeur externe)* — afficher la forme d'onde pendant la lecture, surtout pour les morceaux `static`.

## 5. Vision long terme — Marketplace, Moodboard, Espace Projet

**5.1 Moodboard Studios** (~3 ans) — studio-side pitch tool, distinct de LayerPitch composer tool. Deux population paths : (1) via marketplace avec LayerPitch comme intermédiaire financier ; (2) via Projet → Moodboard, composer/studio en relation contractuelle directe (studio subscription paie l'outil, pas les droits musicaux). Pourquoi l'idée est solide : réutilise l'infrastructure déjà pensée sur un nouveau segment client, ticket moyen studio sans commune mesure avec l'abonnement freelance, effet réseau naturel. Droit d'usage — pistes à baliser avec un avocat : mention obligatoire du compositeur, interdiction d'usage en version finale sans renégociation, licence non exclusive. Rémunération : abonnement studio couvre prix d'achat des packs (revient aux compositeurs) + prix du service (marge LayerPitch), mécanisme de répartition non tranché. Paysage concurrentiel : Epidemic Sound/Artlist (pool anonyme sans musique interactive), agences de sync (placement individuel négocié) — combinaison non identifiée ailleurs. Statut : piste à horizon ~3 ans, aucun chiffrage détaillé engagé.

**5.2 Marketplace de packs** *(14 juillet)* — case à cocher pour rendre un pack visible dans un catalogue public, achat unitaire direct, même mécanique de commission (30/5/1 % par palier). Relation avec le Moodboard : prérequis naturel — impossible de construire un catalogue accessible par abonnement studio sans d'abord avoir un catalogue de packs publics découvrables.

**5.3 Interface acheteur (game dev) — bibliothèque personnelle et packs custom** *(30 juillet)* — conception d'interface (aucun code écrit) pour le profil "acheteur" : un game dev qui a acheté des packs musique/SFX et veut les réorganiser librement pour ses playtests, sans logique de revente. Prérequis explicite : suppose des comptes utilisateurs et des achats enregistrés, donc entièrement dépendant de la bascule backend — aucune valeur avant ça, contrairement à 2.2 et à la section 4.

*Portée volontairement exclue à ce stade* : pas d'affichage d'un catalogue "à acheter" dans les bibliothèques (Music Library / SFX Library n'affichent que ce que l'acheteur possède déjà) — la vitrine catalogue viendra avec la Marketplace (5.2), pas avant.

*Structure de navigation* : trois entrées côté acheteur — Music Library, SFX Library, Packs. "Packs" est un point d'entrée unique donnant accès à deux onglets internes : **Achetés** (packs officiels, lecture seule — action "Ouvrir" uniquement, pas de suppression/duplication puisque ce sont des achats) et **Mes packs custom** (créés par l'acheteur — actions Ouvrir / Dupliquer / Supprimer, plus bouton "+ Nouveau pack custom").

*Modèle de données envisagé pour un pack custom* :
```
PackCustom {
  id, nom, date_création
  allowSimultaneousPlayback: boolean (défaut false)
  musiques: [ { id, référence asset musique }, ... ]
  sfx_pool: [ { id, référence asset sfx, label perso (optionnel) }, ... ]
}
```
Un pack custom référence des assets déjà possédés (musique + SFX), jamais un nouvel objet vendable — usage perso uniquement, pas de republication. Peut être partiel (que des musiques, ou même que des SFX ; un pack "orphelin" sans musique est toléré, modifiable ensuite).

*Principe retenu — pas de timeline* : un SFX rattaché à une musique dans un pack custom n'est pas synchronisé/positionné dans le temps ; il reste déclenchable librement en overlay pendant que la musique joue (façon pads/sampler), sur le modèle des Sfx "stingers" déjà attachables à un morceau côté compositeur — mêmes assets, usage différent (déclenchement manuel en playtest plutôt que stinger ponctuel prévu par le compositeur).

*Lecture simultanée de plusieurs musiques* : réglage explicite par pack (`allowSimultaneousPlayback`), pas figé en dur. Décoché (défaut) : comportement identique à la page publique actuelle — lancer une musique replie/stoppe les autres (`activeTrackId` unique). Coché : chaque musique garde un état indépendant, plusieurs peuvent jouer/être dépliées ensemble. Le pool de SFX reste déclenchable librement dans les deux cas, indépendamment de l'état des musiques.

*Réutilisation du lecteur existant* : le lecteur de musique dans l'écran d'édition d'un pack custom reprend à l'identique le composant du site public (`.track-row-wrapper`/`.track-row`/`.track-row-details`), pas un lecteur ad hoc — ligne compacte (bouton Play rond + titre, repli/dépli au clic), une seule forme d'onde principale avec progression animée en `clip-path`, puces d'intensité si le morceau est en mode vertical.

*Flow de création d'un pack custom — deux points d'entrée complémentaires* :
1. **Depuis l'écran d'édition du pack** : sélecteurs "+ Ajouter un morceau…" / "+ Ajouter un Sfx…" listant les assets possédés non encore inclus, avec bouton "Retirer" par ligne — reprise à l'identique de la logique déjà en place dans le backstage compositeur pour peupler un pack (`addTrackOption`/`allTracksIncluded`/`removeBtn`).
2. **Depuis Music Library / SFX Library** : cases à cocher sur les assets possédés + bouton "Ajouter à un pack" (actif dès une sélection) → menu déroulant listant les packs custom existants + option "+ Nouveau pack…" (celle-ci demande juste un nom, crée le pack, y ajoute la sélection, puis redirige vers l'écran d'édition).

*Statut* : conception validée dans le détail (structure de données, navigation, deux écrans "Achetés"/"Mes packs custom" en onglets sous un point d'entrée unique "Packs", flow de création à deux entrées). Aucun wireframe visuel ni code produits — prochaine étape naturelle si ce chantier est repris : wireframe HTML/artifact cliquable, puis attente de la bascule backend (comptes + achats) avant tout développement réel.

**5.4 Comptes — un seul compte, plusieurs profils bascule** *(30 juillet)* — modèle retenu façon YouTube/YouTube Studio : **un seul système de compte** (auth unique, Supabase), pas de comptes séparés par rôle. Trois profils activables et basculables sans reconnexion :
- **[Nom à définir, provisoirement "Fan"]** — toujours présent par défaut sur tout compte, quel que soit le reste. Nom de travail jugé réducteur (un compositeur ou un game dev qui achète un OST n'est pas qu'un "fan") — à trancher au moment de l'exposer dans l'UI.
- **Compositeur** — accès backstage habituel.
- **Game dev** — accès Packs custom / bibliothèque acheteur (voir 5.3).

Un même compte peut cumuler plusieurs profils (ex. un compositeur a aussi son profil auditeur/fan de base ; un game dev peut aussi être compositeur). Le profil par défaut reste accessible à tout le monde, y compris ceux qui n'ont jamais activé les deux autres — c'est la brique commune qui porte l'entité Album (5.5).

**5.5 Album (OST adaptative) — entité distincte du Pack, interface auditeur** *(structure détaillée dans un fil séparé, "BiZ_CODE BACKSTAGE ACHETEUR_LP", non encore poussé en doc avant le 30 juillet)*

**Décision de fond** : Album ≠ Pack sur le plan technique/visuel (même moteur de lecture adaptative), mais **≠ sur l'audience et la finalité commerciale** — un Pack s'adresse à un studio/game dev qui achète en vue d'implémentation (notes techniques Wwise/FMOD/Unity/Unreal) ; un Album s'adresse à un auditeur qui achète en vue d'écoute/possession, modèle Bandcamp (téléchargement définitif, pas de streaming-only). Cette différence d'audience — et le fait que l'Album doit rester accessible à quelqu'un qui n'a *aucun* des deux autres profils — impose une entité `Album` séparée de `Pack` dans le schéma, pas un simple champ `type` sur un Pack existant.

**Interface auditeur validée (wireframe niveau réflexion, aucun HTML/code)** :
- **Library** — grille "trophées" façon page collection Bandcamp : pochettes d'albums possédés, favoris au niveau album (étoile) et au niveau morceau (étoile), notes personnelles, réordonnancement manuel par glisser-déposer, masquage individuel d'un item.
- **Album View** — liner notes reprises du champ `presentationLabelFr/En` déjà existant (aucun nouveau champ compositeur nécessaire), tracklist avec favoris par morceau et bouton "ajouter à la file", lecteur complet façon AdReel embarqué directement sur la page (pas de version simplifiée).
- **Queue et Playlists** — distinction entre une **file de session** temporaire (multi-albums, non sauvegardée, bouton "Enregistrer comme playlist") et des **playlists nommées persistantes** stockées par compte. Écran liste : pochette en collage auto-généré (mosaïque des covers des jeux inclus, façon Spotify, pas d'upload manuel). Écran détail d'une playlist : tracklist affichant pour chaque morceau le jeu/album et le compositeur d'origine (une playlist mélange plusieurs OST), favori par morceau (★) visible et modifiable ici avec la même logique que dans l'Album View, réordonnancement par glisser-déposer, retrait individuel, renommer/supprimer la playlist. Lecture d'une playlist → même lecteur complet AdReel embarqué que partout ailleurs (pas de version simplifiée pour le cas multi-jeux).
- **Player** — lecteur complet AdReel par défaut, repliable en mini-player persistant ; panneau "Réglages de lecture" qui s'adapte au mode du morceau (séquentiel vs vertical/vertical-random), mémorisé par morceau par compte (implique une table type `user_track_settings`, clé composite compte+morceau — dépend entièrement de la bascule backend). Réglages séquentiel : boucles du morceau avant morceau suivant + boucles par segment avant segment suivant. Réglages vertical/vertical-random : boucles du morceau avant morceau suivant + boucles du layering vertical (réglage global, pas par segment puisque la notion de "segment suivant" n'existe pas dans ce mode).
- **Bouton "Figer"** *(détail validé le 31 juillet, remplace la conception initiale à choix de fenêtre)* — capture toujours l'intégralité de la version en cours de lecture (couches actives, segments, tirages aléatoires compris), sans choix de fenêtre proposé à l'acheteur : un clic suffit. Si le morceau n'est pas terminé au moment du clic, l'export attend la fin naturelle (outro / dernière boucle selon les réglages de lecture) avant de se générer — jamais une coupe arbitraire en plein milieu. Implique un tampon audio glissant réinitialisé à chaque changement de morceau (pas une fenêtre fixe de durée arbitraire), alimenté en continu pendant la lecture via `MediaRecorder` branché sur le graphe audio existant. Séquence UI : clic → état "capture en cours, en attente de la fin du morceau" (annulable) → encodage automatique (WAV puis MP3) → résultat avec aperçu écoutable + deux boutons de téléchargement. Chaque export est conservé dans un nouvel onglet dédié **"Mes exports"** (liste triée par date, actions réécouter/retélécharger/supprimer) plutôt que perdu après le téléchargement initial.
- **Page collection publique partageable** (façon profil Bandcamp) — explicitement repoussée en v2, pas dans le périmètre de cette conception.
- **Statut de la conception 5.5** *(mis à jour le 31 juillet)* : les trois écrans (Library, Album View, Playlists) et le flow complet du bouton Figer sont désormais entièrement réfléchis au niveau wireframe texte. Aucun HTML/code produit — prochaine étape naturelle si ce chantier est repris : wireframe cliquable (artifact), puis attente de la bascule backend avant tout développement réel.

**5.6 Marketplace — trois catégories et mécanisme d'exclusivité** *(structure détaillée dans un fil séparé, "BIZ_DISCUSSION Gale_LP #2", non encore poussé en doc avant le 30 juillet)*

Trois catégories distinctes sur la Marketplace, pas deux :
- **Packs** — réutilisables, vendables à plusieurs game dev/studios différents (fonction actuelle).
- **Albums de compositeur** — œuvre artistique exclusive du compositeur, sans lien avec un jeu ou un studio précis (équivalent d'un artiste sortant un album sur Bandcamp indépendamment de tout travail de commande).
- **OST officielles / Adaptive Editions** — bande originale d'un jeu sorti, vendue par l'éditeur/studio, avec possibilité d'enrichir l'édition (artbook, vidéos, making-of — façon édition deluxe Bandcamp, précédent déjà répandu chez eux).

**Mécanisme d'exclusivité comme condition de conversion Pack → Album** : un Pack classique (non exclusif) peut être vendu à plusieurs studios différents, donc ne peut pas légitimement devenir "la" BO officielle d'un jeu précis — il n'est rattaché à aucun jeu en particulier. Un Pack **exclusif** (vendu une seule fois, à un seul studio) est par nature déjà rattaché à un jeu précis dès la vente initiale ; une fois ce jeu sorti, il devient éligible à être promu en Album OST officiel. L'exclusivité au moment de la vente initiale est ce qui rend la conversion légitime — ça répond à une question contractuelle laissée ouverte précédemment ("qui a le droit de packager la BO en interactif").

**Trois chemins d'entrée possibles vers un Album, convergeant vers le même objet final** :
1. Pack exclusif du Marketplace → promu en Album une fois le jeu sorti.
2. Musique née dans un Espace Projet → promue en Album à la sortie du jeu (extension du bouton "Convertir en Moodboard" déjà prévu, version "Convertir en Album OST").
3. Dépôt direct par l'éditeur (idée d'origine, gratuit, produit d'appel vers le Moodboard) — pour une BO jamais passée par LayerPitch en amont.

**Statut (5.4, 5.5, 5.6)** : cohérence vérifiée entre les trois fils sources et la conception game dev de 5.3 — aucune contradiction trouvée, le profil auditeur/"Fan" de 5.4 correspond exactement au périmètre de l'interface décrite en 5.5. Conception à un niveau de détail variable selon la section (5.4 et 5.6 : principes actés ; 5.5 : wireframe niveau réflexion validé mais incomplet — Playlists et Figer restent à finir). Aucun code, entièrement dépendant de la bascule backend (comptes, profils, achats, stockage des réglages de lecture).

## 6. Relations industrie — contacts moteurs audio (Wwise, FMOD)

**Idée actée, non engagée** *(3 août 2026)* — envisager de contacter Audiokinetic (éditeur de Wwise) et Firelight Technologies (éditeur de FMOD) pour présenter LayerPitch une fois le projet suffisamment mature. Positionnement pressenti comme complémentaire plutôt que concurrent avec les deux : ces moteurs couvrent l'implémentation audio en aval, LayerPitch couvre la présentation/le pitch en amont — logique similaire à la relation déjà établie avec Ollam Technologies dans l'espace RPG adaptatif.

**Cohérence déjà présente** : le vocabulaire du moteur emprunte volontairement des concepts partagés par les deux (segment model, "Voice Graph" pour le mode vertical-random) — un rapprochement s'appuierait sur une parenté déjà construite, pas artificielle. LayerPitch ne prend techniquement parti pour aucun des deux moteurs, ce qui permet de solliciter les deux sans contradiction ni risque de sembler affilié à l'un plutôt qu'à l'autre.

**Bénéfice envisagé** : visibilité dans leur écosystème respectif (forum, blog partenaire, mention communautaire), touchant une audience déjà qualifiée (compositeurs familiers de Wwise et/ou FMOD) — plus ciblée qu'une exposition presse généraliste.

**Différence de nature entre les deux cibles** : Audiokinetic est un groupe international (adossé à Sony/Sacem depuis son rachat) — visibilité potentiellement plus large, mais contact probablement plus formel/long à obtenir. Firelight Technologies (créateur de FMOD) est une structure indépendante et modeste (11-50 employés, Melbourne) — contact potentiellement plus direct et personnel, mais portée moindre. Pas d'ordre imposé entre les deux : commencer par celui pour lequel un contact naturel existe (connexion existante, forum, événement), puis répliquer l'approche vers l'autre.

**Timing à respecter (les deux)** : pas avant d'avoir dépassé la bêta A et idéalement obtenu une première preuve de traction côté backend V1 — se présenter en position de force plutôt qu'avec un prototype encore en bêta à une dizaine de testeurs. Cohérent avec (sans y être strictement identique) la discipline déjà actée de ne pas engager de communication externe avant que le SaaS soit pleinement opérationnel.

### Statut global des extensions

Aucune de ces extensions n'est engagée côté développement au-delà de ce qui figure ✅ fait dans `architecture.md`/`audio-engine.md`. La quasi-totalité (sections 1, 2.1, 3, 5.3, 5.4, 5.5, 5.6) dépend de la bascule backend. Seules 2.2 (onglets backstage), la section 4 (visualisation, waveform, petites améliorations) et la section 6 (relations industrie, sans dépendance technique) sont réalisables ou engageables sans attendre la bascule backend.
