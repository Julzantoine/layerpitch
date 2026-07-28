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

**3.1 Smart Import IA** *(7 juillet)* — le compositeur dépose des stems + description en langage naturel, un appel LLM transforme ça en JSON conforme au schéma `tracks[]`, préremplissant le formulaire (relu et validé avant publication). Nature : extraction texte → structure, pas d'analyse audio. Hypothèse : stems pré-alignés (sinon message d'erreur, pas de resynchronisation automatique). Niveaux écartés : démo complète avec transitions (correspond à V4, non commencé) et import direct Wwise/FMOD (jugé surestimé — les notions de branchement conditionnel n'ont nulle part où exister dans le schéma actuel, les SoundBanks compilées ne contiennent pas toujours l'audio source exploitable). **Coût vérifié** (7 juillet) : ~0,4 à 1 centime par appel (Haiku 4.5 ou Sonnet 5), quelques dollars à ~15$/mois dans le scénario SOM le plus ambitieux — non un frein. Contrainte : clé API jamais exposée côté navigateur → nécessite un backend. Décision actée : pas de système de clé API fournie par l'utilisateur. Phasage : bêta au mieux, sinon déploiement complet.

**3.2 Interface à prompt (couche de commandes IA)** *(7 juillet)* — langage naturel déclenchant des actions ("crée un pack avec ces trois morceaux", "duplique ma page principale pour le studio X") plutôt que navigation dans les menus. Différence avec Smart Import : celui-ci transforme du contenu en données, l'Interface à prompt exécute des actions sur l'état de l'appli — une action mal interprétée a un effet réel. Mécanique : function calling/tool use. Décision actée : toujours un aperçu avant exécution, jamais d'exécution directe sans confirmation (cohérent avec la logique déjà en place pour la publication GitHub). Audience : backstage compositeur ET côté acheteur. Dépendance structurelle : couche par-dessus des fonctionnalités déjà existantes — sa valeur grandit à mesure que le reste de la roadmap avance. Phasage : bêta ou déploiement, après construction des fonctionnalités orchestrées.

**3.3 Traduction automatisée à la demande** *(14 juillet)* — traduire bio/textes de morceaux/packs à partir de l'échafaudage i18n existant. Nuance actée : traduction proposée à valider par le compositeur avant publication, jamais automatique.

## 4. Visualisation et confort d'usage

**4.1 Waveform à la lecture (page publique)** *(7 juillet, retour compositeur externe)* — afficher la forme d'onde pendant la lecture, surtout pour les morceaux `static`.

## 5. Vision long terme — Marketplace, Moodboard, Espace Projet

**5.1 Moodboard Studios** (~3 ans) — studio-side pitch tool, distinct de LayerPitch composer tool. Deux population paths : (1) via marketplace avec LayerPitch comme intermédiaire financier ; (2) via Projet → Moodboard, composer/studio en relation contractuelle directe (studio subscription paie l'outil, pas les droits musicaux). Pourquoi l'idée est solide : réutilise l'infrastructure déjà pensée sur un nouveau segment client, ticket moyen studio sans commune mesure avec l'abonnement freelance, effet réseau naturel. Droit d'usage — pistes à baliser avec un avocat : mention obligatoire du compositeur, interdiction d'usage en version finale sans renégociation, licence non exclusive. Rémunération : abonnement studio couvre prix d'achat des packs (revient aux compositeurs) + prix du service (marge LayerPitch), mécanisme de répartition non tranché. Paysage concurrentiel : Epidemic Sound/Artlist (pool anonyme sans musique interactive), agences de sync (placement individuel négocié) — combinaison non identifiée ailleurs. Statut : piste à horizon ~3 ans, aucun chiffrage détaillé engagé.

**5.2 Marketplace de packs** *(14 juillet)* — case à cocher pour rendre un pack visible dans un catalogue public, achat unitaire direct, même mécanique de commission (30/5/1 % par palier). Relation avec le Moodboard : prérequis naturel — impossible de construire un catalogue accessible par abonnement studio sans d'abord avoir un catalogue de packs publics découvrables.

### Statut global des extensions

Aucune de ces extensions n'est engagée côté développement au-delà de ce qui figure ✅ fait dans `architecture.md`/`audio-engine.md`. La quasi-totalité (sections 1, 2.1, 3) dépend de la bascule backend. Seules 2.2 (onglets backstage) et la section 4 (visualisation, waveform, petites améliorations) sont réalisables sur l'architecture statique actuelle, sans backend.
