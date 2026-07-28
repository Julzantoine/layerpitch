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

## Premières validations de besoin — retours réels sur l'AdReel de démo (26-27 juillet 2026)

Deux échanges distincts suite au partage de l'AdReel de démo (`?adreel=demo-fr`) — premiers vrais résultats de la Phase 0, pas de la recherche documentaire.

**Validation 1 — Discord Game Audio France (GAFR)** : un compositeur (Karish63) a exprimé de lui-même le souhait de devenir bêta-testeur, sans sollicitation directe au-delà du partage initial. A reconnu une référence musicale précise dans la démo — signe d'une écoute analytique. Attente fixée correctement (pas avant l'automne). Game Audio France (Discord) ajouté à la liste des canaux Phase 0/1.

**Validation 2 — contact ThinkSpace (hasuprobe)** : réaction positive spontanée sur la partie interactive, doublée d'une confusion réelle sur le bloc Photos (bug corrigé depuis). Validation explicite du concept obtenue après correction.

## Dossier Take Off — statut

Version actualisée du dossier de candidature (`LAYERPITCH_DOSSIER_TAKEOFF_ACTUALISE.docx`) produite le 18 juillet, intégrant roadmap à jour, données de marché sourcées (SACEM, CNMlab, itch.io), signal de validation qualitative (deux pairs MFA), modèle économique à trois paliers. Les mises à jour de fond se font désormais dans `business-marche.md`, à répercuter vers le docx seulement au moment de le soumettre réellement, pas à chaque session de travail.
