// Carte à zones : option « Rester dans les zones » — le personnage de la balade ne peut pas sortir de l'ensemble des zones.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
const w = new JSDOM('<div id="host"></div>', { url: 'https://beta.layerpitch.com/projet.html', runScripts: 'outside-only' }).window;
w.eval(fs.readFileSync(path.join(__dirname, 'projet-carte.js'), 'utf8'));
const M = w.LayerPitchLevelMap.model;
const map = M.emptyMap();
M.addZone(map, 'rect', 0, 0, 400, 300, 'Bureau');
M.addZone(map, 'rect', 400, 0, 400, 300, 'Couloir');
M.addZone(map, 'rect', 1000, 0, 300, 300, 'Archives'); // vide entre Couloir et Archives
let r = M.constrainToZones(map, { x: 390, y: 100 }, { x: 1100, y: 100 });
check('option absente : on sort librement', !r.blocked && r.x === 1100);
map.stayInZones = true;
r = M.constrainToZones(map, { x: 100, y: 100 }, { x: 200, y: 150 });
check('option cochée, pas dans une zone : libre', !r.blocked && r.x === 200 && r.y === 150);
r = M.constrainToZones(map, { x: 100, y: 100 }, { x: 100, y: -20 });
check('sortie par le haut : arrêt au bord', r.blocked && r.x === 100 && r.y === 100);
r = M.constrainToZones(map, { x: 100, y: 295 }, { x: 150, y: 320 });
check('sortie en biais : glisse le long du bord', r.blocked && r.x === 150 && r.y === 295);
r = M.constrainToZones(map, { x: 395, y: 100 }, { x: 410, y: 100 });
check('zones qui se touchent : passage libre', !r.blocked && r.x === 410);
r = M.constrainToZones(map, { x: 795, y: 100 }, { x: 810, y: 100 });
check('le vide entre deux zones est bloqué', r.blocked && r.x === 795);
const roundtrip = M.normalize(JSON.parse(JSON.stringify(map)));
check('l\'option survit à la sauvegarde', roundtrip.stayInZones === true);
check('absente → reste absente', M.normalize({ nodes: [], edges: [] }).stayInZones === undefined);
process.exit(failures ? 1 : 0);
