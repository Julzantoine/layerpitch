// layerpitch-photo-frame.js (25/10) : cadrage d'une photo dans un rond — bornes, aucun bord vide, image large / haute.
const PF = require('./layerpitch-photo-frame.js');
let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label); if (!cond) failures++; };
check('sans cadrage : centre, zoom 1', JSON.stringify(PF.normalize(null)) === '{"x":50,"y":50,"zoom":1}');
check('valeurs hors bornes ramenées', JSON.stringify(PF.normalize({ x: 200, y: -4, zoom: 9 })) === '{"x":100,"y":0,"zoom":3}');
let l = PF.layout(null, 1000, 1000);
check('image carrée, zoom 1 : couvre exactement le rond', l.width === 100 && l.height === 100 && l.left === 0 && l.top === 0);
l = PF.layout({ x: 10, y: 10, zoom: 1 }, 1000, 1000);
check('image carrée, zoom 1 : impossible de la décaler (sinon bord vide)', l.left === 0 && l.top === 0);
l = PF.layout({ x: 50, y: 20, zoom: 1 }, 1000, 2000);
check('image haute : largeur 100 %, hauteur 200 %, on peut monter/descendre', l.width === 100 && l.height === 200 && l.top === 0 && l.y === 25);
l = PF.layout({ x: 50, y: 50, zoom: 1 }, 2000, 1000);
check('image large : hauteur 100 %, largeur 200 %, centrée', l.height === 100 && l.width === 200 && l.left === -50);
l = PF.layout({ x: 0, y: 0, zoom: 2 }, 1000, 1000);
check('zoom 2 dans un coin : jamais de bord vide (left et top à 0)', l.left === 0 && l.top === 0 && l.width === 200);
check('style : position absolue, pourcentages', /position:absolute/.test(PF.style(null, 100, 100)) && /width:100%/.test(PF.style(null, 100, 100)));
console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
