# LAYERPITCH — ARCHITECTURE
*Extrait de `MASTER.md` le 28 juillet 2026 lors de la restructuration en fichiers spécialisés. Contenu inchangé sur le fond, réorganisé uniquement.*

## Fichiers actuels

Repo GitHub `Julzantoine/layerpitch`, hébergé via GitHub Pages, tous les fichiers dans le même répertoire (contrainte `file://` non négociable — pas de modules ES, pas de build pipeline ; cette contrainte tombera lors de la bascule backend, voir `infrastructure.md`) :

- **`index.html`** — moteur public générique. Charge `data.json` au runtime. Lit `?adreel=xxx` (défaut `main`). Thème clair (Space Grotesk / Inter / JetBrains Mono, accent ambre).
- **`pack.html`** — page publique secondaire par pack, filtrée par `?id=...`. Même moteur.
- **`collection.html`** — équivalent pour les Collections (regroupement de packs), même logique de chargement que `pack.html`/`index.html`.
- **`player.js`** — moteur de lecture partagé, IIFE `window.LayerPlayerCore`, chargé en `<script>` classique (pas `type="module"`, compatibilité `file://`).
- **`layerpitch-backstage.html`** — outil local, jamais publié tel quel. Édition par sections (Bibliothèque, AdReels, Packs), conversion audio (WAV/MP3 en entrée → OGG côté navigateur), publication via API GitHub REST.
- **`layerpitch-i18n.js`**, **`layerpitch-help.js`** — scaffolding bilingue FR/EN et tooltips d'aide contextuelle.
- **`video-test.html`** — Mode Test Gameplay (vidéo YouTube/Vimeo en fenêtre séparée ou panneau intégré).
- **`admin-analytics.html`** — agrégateur des événements bêta-testeurs (outil strictement personnel, jamais vu par un testeur ou visiteur).
- **`migrate-to-library-adreels.js`** — script one-shot de migration, conservé comme utilitaire de dépannage.

## Schéma de données — structure à trois concepts

- **`library[]`** — bibliothèque de morceaux, indépendante des AdReels et des Packs.
- **`packs[]`** — regroupements de morceaux (`trackIds[]`) sous une page dédiée.
- **`adReels[]`** — plusieurs sites indépendants partageant la même bibliothèque (ex. pitch ciblé par studio).

Champs par morceau : `mode` (`static`, `vertical`, `vertical-random`, `sequential`, `embranchement-vertical`), `loopable`, `startTrackBeat`, `maxLoops`, `normalizeVolume`, `bpm`/`beatsPerBar` pour les modes quantifiés. Le mode `sequential` accepte en plus un champ optionnel `nextOptions` par emplacement (`segmentSlots[].nextOptions`, liste de `{targetId, label}`) — absence du champ : comportement inchangé (avancement automatique) ; présence : le visiteur choisit la suite par bouton au lieu d'un avancement automatique (voir `audio-engine.md`).

## Fonctionnalités transverses faites

- **iOS/Safari** : décodage Ogg Vorbis en fallback WASM par piste, workaround silent switch, Wake Lock, récupération audio au changement de visibilité, drag-to-seek (Pointer Events).
- **Publication** : GitHub Contents API avec cache-busting (`publishedAt`, URLs audio versionnées), conflit 409 résolu.
- Waveform (statique et blocs séquentiels), accordéon animé, bascule de contraste (CSS variables + `localStorage`), surcharges de texte par AdReel, bloc Contact via Formspree.
- **Mode Test Gameplay** : bouton ouvre une boîte de dialogue pour coller une URL vidéo (YouTube/Vimeo), ouverte dans une fenêtre séparée son coupé, pendant que le visiteur déclenche manuellement les morceaux/stingers sur la page d'origine.
- **i18n** : scaffolding FR/EN complet sur les cinq fichiers publics (`data-i18n`, `t('key')`, persistance `localStorage`), ~150-200 clés backstage définies en français, traductions anglaises complétées côté Jules-Antoine (historique détaillé : `decisions/2026-07-14-architecture-i18n.md`).
- **Umami analytics** intégré sur les pages publiques (confirmé fonctionnel).
- **Suivi bêta-testeurs** : logger d'événements côté backstage (vocabulaire fermé : `tab_switch`, `track_add/delete`, `pack_add/delete`, `adreel_add/delete`, `block_add`, `publish_click/success`, `preview_play`), buffer `localStorage` → `events.json` à la publication, `admin-analytics.html` agrège (mécanisme de duplication de repo par testeur détaillé dans `infrastructure.md`).

## Backstage — état actuel

- Sidebar Compte/Site : Bibliothèque / Packs / Projet(s, grisé) en onglets globaux ; sélecteur d'AdReel + Contenu/Apparence pour le site en cours.
- Lien public + bouton Copier, mis à jour automatiquement si owner/repo changent.
- Bouton "Vérifier si le site public est à jour" (compare le `data.json` réel via API avec ce que le site public renvoie réellement, contourne le cache navigateur — ne peut pas purger le cache CDN GitHub).
- Fenêtres dépliables/repliables avec état persistant (trois `Set` globaux), tout replié par défaut à l'ouverture.
- **Restructuration en onglets** : idée validée dans son principe (voir `extensions-roadmap.md`), pas encore codée.
- **Reste à faire** : sélecteur de couleur de fond du backstage pas entièrement câblé ; tooltips d'aide contextuelle (scope et rédaction à trancher).
