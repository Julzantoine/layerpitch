# LAYERPITCH — BUSINESS & MARCHÉ
*Extrait de `MASTER.md` le 28 juillet 2026 lors de la restructuration en fichiers spécialisés. Contenu inchangé sur le fond, réorganisé uniquement.*

## Problème

Un MP3 ne montre pas comment une musique fonctionne, seulement comment elle sonne. La musique interactive est un système (couches, intensité, transitions), mais les formats de présentation du secteur montrent un résultat figé. Trois compositeurs indépendants ont dû construire des démos interactives bricolées (dont des `.exe` flaggés comme malware par des destinataires) faute d'outil adapté — validation directe du problème, pas seulement une hypothèse.

## Marché — TAM / SAM / SOM

| Niveau | Définition | Estimation | Méthode |
|---|---|---|---|
| TAM | Compositeurs de musique de jeu vidéo dans le monde, tous statuts | 6 000 à 12 000 | **Estimation par triangulation** : G.A.N.G. (2 500+ membres, 29 pays) × taux de couverture associatif habituel (20-40 %) dans des secteurs créatifs comparables |
| SAM | Ceux ayant une activité freelance au moins partielle | 2 700 à 5 400 (45 % du TAM) | **Fait vérifié** (GameSoundCon Game Audio Industry Survey 2025, 654 répondants/631 professionnels : 62 % salariés, 25 % freelance exclusif, 8,7 %+11,3 % hybrides) appliqué à l'estimation TAM |

**Réserve sur le SAM** : enquête GameSoundCon non aléatoire (recrutement par listes de diffusion et réseaux du secteur) — biais possible vers les compositeurs les plus connectés.

**Chiffre alternatif écarté** : une estimation de 20 000-40 000 professionnels a circulé sans méthode de calcul — écartée faute de méthode défendable.

### Repère de volume complémentaire — production française (ajouté 25 août 2026)

Pour rendre le SAM plus concret et répondre à un retour du relecteur Take Off sur la difficulté à appréhender le marché à partir du seul TAM/SAM :

- **Fait vérifié** (SNJV, Baromètre annuel du jeu vidéo en France, juin 2025) : 1 040 jeux en production en France en 2024, dont 55 % de jeux indépendants ; écosystème français de plus de 980 entreprises.
- **Fait vérifié, affine la fourchette SACEM déjà citée** (CNC, données CIJV) : la composition musicale représente en moyenne 0,8 % du coût total des projets aidés en 2024 (0,3 % en 2025), sur un échantillon documenté de 31 dossiers sur 40 en 2024 et 29 sur 39 en 2025 ; certains projets de taille intermédiaire (500 K€-1 M€ de budget) y consacrent jusqu'à 7 à 11 %. Remplace la fourchette "0,2 % à 7 %" jusqu'ici citée sans détail méthodologique.
- **Limite assumée, volontairement non comblée** : ces pourcentages portent sur des coûts de production, pas sur un chiffre d'affaires adressable pour LayerPitch. Les convertir en un montant de marché en euros nécessiterait une hypothèse sur le budget moyen de production d'un jeu français, non sourcée publiquement à ce stade — pas de chiffrage inventé ici.
- **Fait vérifié** (SNJV, Baromètre annuel du jeu vidéo en France, édition 2024 publiée juin 2025, PDF officiel consulté directement) : répartition des 1 040 jeux en production par tranche de budget — 60,5 % à moins de 500 K€, 8,8 % entre 500 K€ et 1 M€, 12,3 % entre 1 et 2 M€, 9,6 % entre 2 et 5 M€, 3,5 % entre 5 et 10 M€, 5,3 % au-delà de 10 M€ (104 répondants sur cette question précise, sur 575 entreprises interrogées au total). La grande majorité de la production française (60,5 %) reste donc dans la tranche basse, cohérente avec le profil de client visé par LayerPitch.
- **Fait vérifié** (même source) : répartition géographique des 980 entreprises françaises — Île-de-France 44,3 %, **Hauts-de-France 5,7 %**, Auvergne-Rhône-Alpes 13,2 %, Nouvelle-Aquitaine 8,9 %, Occitanie 8,8 %, Provence-Alpes-Côte d'Azur 6,6 %. Remplace la lecture approximative de carte utilisée précédemment.
- **Non vérifié, volontairement écarté** : un chiffre de "budget moyen CNC autour de 350 000 €" et une fourchette "5 % à 10 % du budget en audio global" ont été trouvés dans une synthèse tierce (outil IA externe) mais n'ont pas pu être confirmés dans le rapport SNJV ni retracés à une source primaire fiable — non repris ici.

Sources : *Panorama SACEM — Musique et jeu vidéo* (édition 2026), données CNC/CIJV, SNJV Baromètre annuel du jeu vidéo en France (juin 2025).

### SOM — méthode retenue (révision du 18 juillet 2026)

Ancienne méthode (multiplication de deux pourcentages non sourcés) abandonnée — fausse précision méthodologique.

Nouvelle méthode :
- **Facteur sourcé** : taux de conversion parmi les personnes exposées à l'outil, 8-15 % (**fait vérifié**, benchmarks B2B SaaS — Powered by Search, First Page Sage — fourchette basse retenue car LayerPitch gratuit à l'entrée).
- **Facteur ancré sur un cas réel, non sourcé en tant que tel** : aucun benchmark public sur le taux de pénétration d'un nouvel outil dans une communauté professionnelle de niche.

Résultat calibré : **6 à 150 utilisateurs à 12-18 mois** — fourchette large assumée, calibrée contre la trajectoire réelle de ReelCrafter (voir Avantage concurrentiel) plutôt qu'une projection de croissance optimiste.

### Revenu estimé (V1, sans commission packs)

- Utilisateurs payants estimés : ~5 à 12 (**estimation**)
- Revenu mensuel estimé : ~50 à 300 $ selon le tier majoritaire
- Revenu annualisé V1 : ~600 à 3 600 $ — complément de revenu, pas un modèle autosuffisant, normal en phase de validation V1.
- **V2** (packs + commission) : dépend de données pas encore disponibles (volume de packs vendus, prix moyen, taux de conversion réel) — non chiffré avant les premiers résultats terrain.

### Pistes de recherche identifiées, non encore menées

Avis acheteurs sur les packs itch.io (signaux de déception/confusion post-achat) ; recherche X/Twitter et LinkedIn sur la difficulté de pitcher/recruter sur le critère adaptatif ; rapports sectoriels payants (IBISWorld, Statista, accès à vérifier) ; autres proxys pour resserrer le TAM (profils LinkedIn "game composer", volume d'étudiants dans des écoles équivalentes à ThinkSpace, volume de jeux indé publiés sur Steam/itch.io).

## Avantage concurrentiel

| | ReelCrafter | DropCue | DISCO.ac | Scorefolio | **LayerPitch** |
|---|---|---|---|---|---|
| Prix d'entrée payant | 10$ | 5$ | 10,80$ (+ add-ons ~69$) | ~14$ | 10€ |
| Musique interactive | ❌ | ❌ | ❌ | ❌ | **✅ seul du marché** |
| Vente de packs | ❌ | ❌ | ❌ | ✅ (scores PDF) | ✅ (packs audio) |
| Modèle tarifaire | Simple | Simple | Add-ons cachés | Simple | Simple (objectif) |

Aucun des quatre concurrents étudiés ne propose de musique interactive ni de packs adaptatifs — l'angle mort tient face à l'ensemble du marché, pas seulement face à ReelCrafter.

### Concurrent identifié le 25 août 2026 — Reprise

**Reprise**, outil construit par Rémi Gallego (compositeur ET développeur — Sloclap, crédits Rematch/VOIN/Dislyte/The Last Spell/Hacknet), lancé il y a 4 mois sur LinkedIn : un lien privé permet à un client d'entendre et de manipuler le système musical adaptatif complet dans le navigateur (toggle layers, transitions, navigation entre états de jeu), avec historique de versions, feedback annoté directement sur la waveform, et export vers FMOD et Wwise. Un second post (1 mois plus tard, 54 réactions dont plusieurs audio directors en poste) repositionne l'outil vers le **prototypage conjoint** compositeur/studio ("lets game devs and composers prototype adaptive music together"), pas seulement la révision de livraison.

**Ce que ça corrige** : la ligne "Musique interactive : seul du marché" ci-dessus n'est plus exacte au sens strict — le mécanisme central (manipulation réelle d'un système adaptatif dans le navigateur) existe déjà chez Reprise.

**Ce qui reste distinct** : Reprise se positionne sur la collaboration **pendant** une relation compositeur/studio déjà engagée (livraison, révision, prototypage conjoint) — l'AdReel de LayerPitch vise le **pitch pré-contrat**, pour décrocher la relation en premier lieu. Deux moments différents du même entonnoir, pas le même produit à ce jour.

**Point de vigilance** : le second positionnement de Reprise (prototypage conjoint compositeur/studio) recoupe partiellement la vision long terme "Moodboard Studios" de LayerPitch (voir `extensions-roadmap.md`, section 5.1) — traction réelle et rapide (54 réactions, audio directors engagés) à surveiller. Michael Worth (voir Validation 3 ci-dessus) a par ailleurs confirmé maîtriser WAAPI/l'API Wwise indépendamment, signe que ce terrain technique est déjà occupé par plusieurs acteurs du secteur.

**Point encore ouvert** : contact éventuel avec Rémi Gallego — posture à trancher entre "pair discret" (sans nommer LayerPitch) et "transparence ciblée" (nommer LayerPitch et l'AdReel, en excluant strictement le Moodboard et le modèle de rémunération studio, protégés dans tous les cas). Pas de décision prise à ce stade.

**Point de vigilance** : le risque concurrentiel n'est pas seulement produit, il est aussi tarifaire — un acteur pourrait répliquer la stratégie "autant de features pour moins cher" contre LayerPitch.

**Trajectoire réelle de ReelCrafter** (**fait vérifié**, utilisée pour calibrer le SOM) : fondé par Sam Hulick (compositeur, trilogie Mass Effect — notoriété de départ que LayerPitch n'a pas), 385 abonnés LinkedIn, 647 mentions J'aime Facebook, un seul avis G2 après 10 ans d'existence. Confirme un marché de niche réel mais structurellement modeste.

## Stratégie de communication et pénétration marché

*Synthèse recalibrée le 18 juillet 2026 à partir d'un playbook externe (ChatGPT, non conservé tel quel) — principe : garder l'architecture narrative qui tient (manifeste → pionniers → créateurs/écoles → studios), aligner tous les chiffres sur le SOM triangulé ci-dessus et sur l'état réel de l'architecture (pas de comptes multi-utilisateurs à ce jour).*

**Le concept AdReel n'est pas une nouveauté à créer** : `adReels[]` est déjà le terme technique en place (schéma de données, vocabulaire du logger bêta, nom du script de migration) depuis la refonte du 7 juillet.

**Repère externe validant le mécanisme (fait vérifié)** — Gamma (outil de présentation IA) : pivot fin 2022 depuis ~60 000 utilisateurs, aujourd'hui 50M+ utilisateurs, 50M$ d'ARR, rentable depuis 15 mois, ~30 personnes. Mécanisme central : chaque document partagé porte un filigrane "Made with Gamma" — l'objet partagé est le moteur marketing, logique identique à l'AdReel.

**Ce qui n'est pas transférable** : l'échelle du marketing créateur de Gamma (150+ créateurs, 6 agences) n'a de sens que pour un TAM de centaines de millions d'utilisateurs. Le SAM de LayerPitch est de 2 700-5 400 personnes — reproduire ce dispositif serait disproportionné. Garde-fou : imiter le principe du mécanisme, pas l'échelle du marketing créateur.

**Idée non tranchée** : un discret "propulsé par LayerPitch" sur chaque AdReel partagé (modèle du filigrane Gamma) — à ajouter aux extensions envisagées si retenu.

**Le manifeste (trois niveaux)** : (1) un MP3 ne montre pas comment une musique fonctionne ; (2) la musique interactive est un système, les formats du secteur montrent un résultat figé ; (3) la musique interactive est un comportement, pas un fichier audio — l'AdReel le rend visible et partageable.

**North Star Metric** : AdReels créés × taux de partage × nombre moyen de visiteurs externes — mesurable dès maintenant via `admin-analytics.html` et Umami, aucun développement supplémentaire requis.

**Séquencement des cibles** : Compositeurs (prioritaire) → écoles/créateurs de contenu (prescripteurs) → studios (bénéficiaires, marché aval).

**Référence ReelCrafter pour la mise sur le marché** (**fait vérifié**) : Sam Hulick a construit l'outil pour son propre usage, partagé d'abord avec son cercle professionnel, construit sa visibilité via des interviews dans des médias de niche (A Sound Effect, Creative Content Wire) plutôt que par la publicité. Palier gratuit assumé + boucle de retour utilisateur ont soutenu la croissance dans la durée.

## Validation qualitative — signaux documentés

Deux compositeurs du même cursus MFA (ThinkSpace) ont construit, chacun indépendamment, une démo de musique adaptative jouable en direct dans leur portfolio. **Ce n'est ni un chiffre de marché ni un échantillon représentatif** — deux personnes dans une cohorte ne permettent aucune extrapolation quantitative. Signal qualitatif direct et non sollicité, à formuler avec cette prudence dans tout dossier.

## Premières validations de besoin — retours réels sur l'AdReel de démo (26 juillet - 3 août 2026)

Trois échanges distincts suite au partage de l'AdReel de démo (`?adreel=demo-fr`) — premiers vrais résultats de la Phase 0, pas de la recherche documentaire.

**Validation 1 — Discord Game Audio France (GAFR)** : un compositeur (Karish63) a exprimé de lui-même le souhait de devenir bêta-testeur, sans sollicitation directe au-delà du partage initial. A reconnu une référence musicale précise dans la démo — signe d'une écoute analytique. Attente fixée correctement (pas avant l'automne). Game Audio France (Discord) ajouté à la liste des canaux Phase 0/1.

**Validation 2 — contact ThinkSpace (hasuprobe)** : réaction positive spontanée sur la partie interactive, doublée d'une confusion réelle sur le bloc Photos (bug corrigé depuis). Validation explicite du concept obtenue après correction.

**Validation 3 — retour de Michael Worth, professeur de musique de jeu vidéo à ThinkSpace, 3 août 2026** : retour spontané suite à démonstration. Point fort noté : le mode vertical ("Conan style") jugé le plus intéressant, contrôle solo/mute/volume identifié comme un vrai atout pour un game dev. **Écart réel signalé** : contrôle de volume indépendant par couche pas encore implémenté (solo/mute le sont). Point de vigilance sur le mode statique : jugé non différenciant par rapport à ReelCrafter ou une sélection YouTube privée — cohérent avec l'avantage concurrentiel déjà documenté (l'unicité de LayerPitch tient à l'adaptatif, pas au statique). Suggestion reçue pour la partie horizontale : transition fluide déclenchée par un bouton nommé ("headed to combat") — validation externe et indépendante de la conception "Progression à embranchement" tranchée le même mois, avec une nuance sur l'usage d'une "transition matrix" dédiée à soupeser face au choix retenu (intégration dans le segment de destination).

## Roadmap et jalons (ajouté 25 août 2026, en réponse à un retour du relecteur Take Off)

Le MVP est aujourd'hui pleinement fonctionnel (cinq modes de lecture, Backstage, système de packs), et un prototype bêta sur GitHub est opérationnel, avec l'infrastructure de suivi analytique des bêta-testeurs déjà en place. La confrontation à la cible a en réalité déjà commencé de façon informelle et organique, avant même l'ouverture officielle de la bêta : les trois validations documentées ci-dessus (Discord GAFR, ThinkSpace, Michael Worth) en sont la preuve.

Jalons à venir (**calage temporel fourni par Jules-Antoine, pas une estimation de Claude**) :
- **Été-automne 2026** : ouverture et montée en puissance de la phase de bêta test, avec l'objectif d'être bien avancée d'ici décembre 2026 — date du jury Take Off Inspiration — pour pouvoir présenter une bêta réellement en usage. En parallèle, poursuite de la qualification du marché engagée en amont (entretiens qualitatifs, questionnaires) auprès des compositeurs, pour affiner le produit avec des retours de bêta-testeurs réels plutôt que sur la seule base de la recherche documentaire.
- **Début 2027** : lancement de la construction de la version backend (comptes, infrastructure multi-utilisateur), conditionné à l'obtention de retours bêta suffisamment matures, qualitativement et quantitativement.
- **Printemps 2027** : intervention d'un développeur externe pour un audit de la version backend avant mise en production.
- **Printemps 2027, à la suite de l'audit** : lancement d'une bêta élargie sur l'infrastructure backend.
- **Été-automne 2027** : lancement commercial du SaaS.

## Dossier Take Off — statut

Version actualisée du dossier de candidature (`LAYERPITCH_DOSSIER_TAKEOFF_ACTUALISE.docx`) produite le 25 août 2026, intégrant roadmap datée, quantification marché complémentaire (SNJV/CNC), trois signaux de validation qualitative documentés, modèle économique à trois paliers. Les mises à jour de fond se font désormais dans `business-marche.md`, à répercuter vers le docx seulement au moment de le soumettre réellement, pas à chaque session de travail.
