# LAYERPITCH — MASTER
*Restructuré le 28 juillet 2026 — ce document devient un résumé court + index. Le détail vit désormais dans les fichiers spécialisés listés ci-dessous, tous dans `docs/`.*

## Contexte

Outil de pitch pour musique adaptative, à l'usage de Jules-Antoine Escande, compositeur freelance basé à Lille, en MFA Video Game and Media Composition à ThinkSpace Education (Bournemouth). Admis au programme d'incubation Plaine Images / Take Off Inspiration (démarrage septembre 2026, partenariat Sacem formel).

L'unité centrale du produit est l'**AdReel** (Adaptive Reel) : une page de pitch indépendante et partageable où le destinataire peut interagir en direct avec la musique — en faire varier l'intensité, entendre les couches changer en temps réel — plutôt que de simplement l'écouter en MP3.

## État global (28 juillet 2026)

Prototype fonctionnel sur GitHub Pages. Bêta GitHub en préparation (essai à blanc du script de duplication de repo pas encore fait). Bascule backend cadrée mais pas commencée (canal Claude Code séparé, une fois les dernières décisions confirmées en pratique).

## Index des documents

- **`business-marche.md`** — problème, marché (TAM/SAM/SOM), avantage concurrentiel, stratégie de communication, signaux de validation qualitative, statut du dossier Take Off.
- **`architecture.md`** — fichiers actuels, schéma de données, fonctionnalités transverses faites, état du backstage.
- **`audio-engine.md`** — modes de lecture (statique, vertical, vertical-random, séquentiel, embranchement-vertical), option `nextOptions` du mode séquentiel, éditeur de points de boucle.
- **`infrastructure.md`** — bêta de retour qualitatif (Partie A) et bascule backend (Partie B), guide de démarrage bêta-testeurs séparé (voir ci-dessous).
- **`guide-beta-testeurs.md`** — document destiné à être transmis quasiment tel quel aux bêta-testeurs.
- **`extensions-roadmap.md`** — catalogue complet des idées non engagées, point de qualité ouvert (contraste des couleurs).
- **`decisions/`** — historique des choix techniques/produit significatifs (ADR), un fichier par décision.
- **`LAYERPITCH_CHANGELOG.md`** (racine du repo, hors `docs/`) — journal technique ligne à ligne, mis à jour après chaque modification de code. Reste indépendant, jamais dupliqué ici.

## Discipline de méthode à préserver

Architecture discutée et validée avant tout code ; pas de bricolage ; une question à la fois plutôt qu'une supposition ; jamais de travail sans accord explicite ; fichiers complets livrés plutôt que patches ; distinction systématique fait vérifié / estimation / hypothèse non testée dans toute donnée chiffrée (marché, coûts, marge). Quand une action est proposée sous forme de question, attendre la réponse explicite avant d'agir. Relectures externes (ChatGPT ou autres) challengées avant intégration, jamais adoptées telles quelles.

## Prochaine étape

- Éditeur visuel de forme d'onde (StartTrackPoint/StartLoopPoint/ExitLoopPoint, limite de boucles + outro) — chantier volontairement reporté.
- Essai à blanc de la bêta (Partie A infra) avant invitation de vrais testeurs.
- Raccourcir l'intro du mode séquentiel dans l'AdReel de démo (retour bêta du 27 juillet).
