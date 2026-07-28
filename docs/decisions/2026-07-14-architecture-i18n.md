# ADR — Architecture d'internationalisation (i18n)
*Date de la décision initiale : 14 juillet 2026. Corrigée le même jour après clarification du besoin réel. Consolidé le 28 juillet 2026 dans `decisions/` (anciennement section "Internationalisation (i18n) — historique" du MASTER).*

## Contexte

La plupart des bêta-testeurs pressentis seraient anglophones. Le backstage (`layerpitch-backstage.html`) et les pages publiques (`index.html`, `pack.html`, `player.js`, `video-test.html`) étaient entièrement en français. Besoin d'une version anglaise, sans dupliquer les fichiers (risque de dérive déjà rencontré ailleurs sur ce projet, entre le MASTER et d'anciens fichiers d'extension séparés).

## Décision initiale (première partie du 14 juillet)

Architecture retenue : chaque élément de texte porte un attribut `data-i18n="cle"` (ou variantes placeholder/title), objet JS centralisé `I18N = { fr: {...}, en: {...} }` local à chaque fichier, interrupteur de langue visible sur la page publique, langue choisie persistée en `localStorage`.

**Périmètre validé** : inclus — `layerpitch-backstage.html`, `index.html`, `pack.html`, `player.js`, `video-test.html`. Exclu — `admin-analytics.html` (outil strictement personnel, jamais vu par un testeur ou visiteur).

**Répartition du travail actée** : Claude prépare la structure technique et extrait les chaînes françaises comme clés — la traduction anglaise elle-même faite en externe par Jules-Antoine (habitude déjà en place sur ce projet, pour préserver le contexte de conversation), puis réintégrée.

## Correction (seconde partie du 14 juillet, même jour)

Après implémentation du premier passage, le besoin réel s'est révélé différent : ce n'est pas un interrupteur laissé au choix du visiteur sur la page publique qu'il fallait, mais deux réglages contrôlés depuis le backstage — "un bouton qui sert à mettre le backstage en français ou en anglais, un bouton qui sert à mettre l'AdReel en fr ou en anglais". La langue est fixe pour le visiteur (pas de bascule possible sur la page publique), et un AdReel anglais doit envoyer automatiquement vers un pack en anglais.

**Alternative écartée** : interrupteur visiteur avec langue persistée en `localStorage` côté page publique — écarté car il ne correspondait pas au besoin réel (contrôle éditorial par le compositeur, pas par le visiteur).

## Conséquences techniques de la correction

- Nouveau champ `adReel.lang` (`'fr'`/`'en'`) dans le schéma, réglable dans le backstage (menu déroulant dans l'onglet Apparence, et directement dans la modale "Nouvel AdReel" à la création).
- Retrait complet de l'interrupteur FR/EN visiteur sur `index.html` et `pack.html`.
- `index.html` lit `adReel.lang` et l'impose ; les liens vers les packs portent un paramètre `?lang=fr|en` dans l'URL pour que `pack.html` connaisse sa langue sans avoir besoin de la stocker lui-même. `video-test.html` hérite du même paramètre.
- Le **backstage garde son propre interrupteur FR/EN**, sans rapport avec ce qui précède : langue de l'outil pour la personne qui l'utilise (compositeur ou bêta-testeur), mémorisée en `localStorage`.
- Dans `player.js` : `currentLang()` ne lit plus `localStorage` mais une variable de module, fixée par une fonction exportée `setLang(lang)` appelée par chaque page hôte avant construction. Correction technique associée : `MODE_LABELS` était figé au chargement du script (jamais mis à jour ensuite) — converti en fonction `getModeLabel()` réévaluée à chaque affichage.

## Statut

Chantier terminé — voir `architecture.md`, section Fonctionnalités transverses faites. Vérification faite : recherche systématique de tout reliquat (`layerpitch_lang` en `localStorage`, classes `.lang-toggle`) dans les fichiers publics — confirmé absent partout sauf dans le backstage, où c'est volontaire.
