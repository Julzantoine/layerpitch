const { buildTrackRow, initTrackPlayer, layerHasSource } = window.LayerPlayerCore;

// Barre latérale repliable (28/09) : même bouton et même réglage que les autres pages (layerpitch-shell.js).
if (window.LayerPitchShell) window.LayerPitchShell.collapsible(document.querySelector('.backstage-sidebar'), { selector: '.nav-item' });

