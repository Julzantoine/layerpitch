// Lecture d'un projet Wwise (mini projet inline) -> brouillon LayerPitch. Voir layerpitch-wwise-import.js.
const W = require('./layerpitch-wwise-import.js');
let fails = 0;
const check = (name, ok) => { console.log((ok ? 'OK   ' : 'FAIL ') + name); if (!ok) fails++; };

const gp = `<?xml version="1.0"?><WwiseDocument><GameParameters><WorkUnit Name="W" ID="{W}"><ChildrenList>
  <GameParameter Name="Enemies" ID="{G1}"><PropertyList><Property Name="Max" Type="Real64" Value="50"/><Property Name="RTPCRamping" Type="int16" Value="1"/><Property Name="SlewRateUp" Type="Real64" Value="10"/></PropertyList></GameParameter>
</ChildrenList></WorkUnit></GameParameters></WwiseDocument>`;
const music = `<?xml version="1.0"?><WwiseDocument><InteractiveMusic><WorkUnit Name="M" ID="{M}"><ChildrenList>
  <MusicPlaylistContainer Name="Loop" ID="{C}"><ReferenceList><Reference Name="PlaylistRoot"><Custom><MusicPlaylistItem Name="" ID="{P}"><PropertyList><Property Name="LoopCount" Type="int16" Value="0"/></PropertyList><ChildrenList>
    <MusicPlaylistItem Name="" ID="{P2}"><ReferenceList><Reference Name="Segment"><ObjectRef Name="Seg" ID="{S}" WorkUnitID="{M}"/></Reference></ReferenceList></MusicPlaylistItem></ChildrenList></MusicPlaylistItem></Custom></Reference></ReferenceList>
    <ChildrenList><MusicSegment Name="Seg" ID="{S}"><PropertyList><Property Name="EndPosition" Type="Real64" Value="10000"/></PropertyList><ChildrenList>
      <MusicTrack Name="L1" ID="{T1}"><ChildrenList><AudioFileSource Name="L1" ID="{A1}"><AudioFile>l1.wav</AudioFile></AudioFileSource></ChildrenList></MusicTrack>
      <MusicTrack Name="L2" ID="{T2}"><ChildrenList><AudioFileSource Name="L2" ID="{A2}"><AudioFile>l2.wav</AudioFile></AudioFileSource></ChildrenList>
        <ObjectLists><ObjectList Name="RTPC"><Reference><Local><RTPC Name="" ID="{R}"><PropertyList><Property Name="PropertyName" Type="string" Value="Volume"/></PropertyList>
          <ReferenceList><Reference Name="ControlInput"><ObjectRef Name="Enemies" ID="{G1}" WorkUnitID="{W}"/></Reference></ReferenceList>
          <Curve Name="" ID="{CV}"><PointList><Point><XPos>0</XPos><YPos>-200</YPos></Point><Point><XPos>10</XPos><YPos>-200</YPos></Point><Point><XPos>20</XPos><YPos>0</YPos></Point><Point><XPos>50</XPos><YPos>0</YPos></Point></PointList></Curve>
        </RTPC></Local></Reference></ObjectList></ObjectLists></MusicTrack>
    </ChildrenList></MusicSegment></ChildrenList></MusicPlaylistContainer>
</ChildrenList></WorkUnit></InteractiveMusic></WwiseDocument>`;
const model = W.readWwiseProject([{ path: 'Game Parameters/a.wwu', text: gp }, { path: 'Interactive Music Hierarchy/m.wwu', text: music }, { path: 'x.txt', text: 'ignoré' }]);
const draft = W.draftFromModel(model);
const t = draft.tracks[0];
check('un paramètre de jeu lu (0–50)', model.gameParameters.length === 1 && model.gameParameters[0].max === 50);
check('un conteneur, un segment, 2 pistes avec leur fichier', model.containers.length === 1 && t.layers.length === 2 && t.layers[1].file === 'l2.wav');
check('boucle infinie (LoopCount 0)', t.loop === 'infini');
check('couche 1 toujours audible, couche 2 pilotée par le paramètre', !t.layers[0].volumeByParameter && t.layers[1].volumeByParameter.parameter === 'Enemies');
check('couche 2 : monte à 20 %, plein volume à 40 % (sur 0–50)', t.layers[1].volumeByParameter.audibleFrom >= 0.2 && t.layers[1].volumeByParameter.audibleFrom < 0.4 && t.layers[1].volumeByParameter.fullAt === 0.4);
check('lissage = étendue / vitesse (50 / 10 = 5 s)', t.fxSliders[0].smoothSec === 5);
check('passe-bas : 0 = ouvert (20 kHz), valeur croissante = fréquence plus basse', W.wwiseLowpassToHz(0) === 20000 && W.wwiseLowpassToHz(78) < W.wwiseLowpassToHz(25));
check('tempo absent signalé, pas inventé', t.layers.length === 2 && draft.notes.some(n => /tempo/i.test(n)));
check('le rapport se génère', /Combat|Loop/.test(W.reportMarkdown(model, draft)));
const built = W.buildLayerPitchTracks(model, draft);
const bt = built.tracks[0].track;
const okCurve = c => c.length >= 2 && c.every((q, i) => q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1 && (i === 0 || q.x >= c[i - 1].x));
const allBindings = bt.fxSliders.flatMap(sl => sl.bindings);
check('morceau LayerPitch : mode vertical, 2 couches, boucle', bt.mode === 'vertical' && bt.layers.length === 2 && bt.loopable === true);
check('liaison de volume : de -60 dB à 0 dB, courbe valide (x et y de 0 à 1)', allBindings.length === 1 && allBindings[0].param === 'volume.db' && allBindings[0].from === -60 && allBindings[0].to === 0 && okCurve(allBindings[0].curve));
check('la couche 2 est silencieuse à 0 % du curseur et pleine à 100 %', allBindings[0].curve[0].y === 0 && allBindings[0].curve[allBindings[0].curve.length - 1].y === 1);
check('les fichiers audio sont rattachés aux couches, rien n\'est envoyé', built.tracks[0].audioFiles[1].file === 'l2.wav' && bt.layers.every(l => l.remoteFile === null && l.pendingFile === null));
const forced = W.buildLayerPitchTracks(model, draft, { initialValues: { Enemies: 25 } }).tracks[0].track.fxSliders[0];
check('valeur de départ forcée : 25 sur 0–50 = 50 %', forced.defaultValue === 0.5 && bt.fxSliders[0].defaultValue === 0);
process.exit(fails ? 1 : 0);
