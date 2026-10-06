// ---- Règles entre triggers (24/09) ----
// trigger.relations = { activates:[{triggerId, delaySec}], cuts:[triggerId], requires:[triggerId], autoOffSec }.
//   Active aussi (cascade) : quand ce trigger s'active, les triggers listés s'activent à leur tour, chacun après
//     son délai ; quand il se coupe, ceux qu'il avait activés se coupent (sauf s'ils ont été repris à la main).
//   Coupe (exclusion)      : quand ce trigger s'active, les triggers listés sont coupés.
//   Nécessite (condition)  : ce trigger ne peut être activé QUE tant que les triggers listés sont actifs ; si l'un
//     d'eux se coupe, celui-ci se coupe aussi. Ne bride que le VISITEUR (source 'visitor') : une bascule ou une
//     cascade -- décisions du compositeur -- passe outre.
//   Se coupe seul : autoOffSec secondes après son activation.
// Fonction PURE : ne connaît ni l'audio ni l'horloge. Le lecteur lui fournit un vrai temps (setTimeout) et applique
// les effets dans hooks.apply ; l'outil vidéo lui fournit un temps SIMULÉ (simulateTriggerRules) pour que le son
// exporté suive exactement les mêmes règles qu'en jeu.
// hooks : { schedule(delaySec, fn) -> handle, cancel(handle), apply(id, active, cause) }
// ---- Cascade par étapes (6/10) ----
// trigger.steps = [{ id, label?, delaySec, fx, children?:[étapes] }] : des groupes d'effets qui démarrent delaySec secondes
// APRÈS LEUR PARENT (le trigger pour les étapes du premier niveau, l'étape-mère pour les enfants ; 0 = en même temps), s'ajoutent
// aux effets du trigger et s'arrêtent avec lui. Pas de nouveau mécanisme : chaque étape devient un trigger invisible, relié à son
// parent par « Active aussi » avec son délai ; le moteur de règles ci-dessous, le lecteur et l'export vidéo les traitent donc
// comme n'importe quelle cascade. Les copies portent rootId (le trigger d'origine) et startSec (départ cumulé depuis l'appui).
// Fonction PURE.
const TRIGGER_STEPS_MAX_DEPTH = 5;
function expandTriggerSteps(triggers) {
  const out = [];
  (triggers || []).forEach(d => {
    if (!d || !d.id || !Array.isArray(d.steps) || !d.steps.length) { out.push(d); return; }
    const kids = [];
    function walk(parentId, steps, startSec, depth) {
      const links = [];
      (steps || []).forEach((s, i) => {
        if (!s || depth > TRIGGER_STEPS_MAX_DEPTH) return;
        const id = parentId + '~' + (s.id || i);
        const delay = +s.delaySec > 0 ? +s.delaySec : 0;
        const k = { id, label: s.label || '', target: d.target, fx: s.fx || {}, visible: false, fadeSec: d.fadeSec != null ? d.fadeSec : null, fadeOutSec: d.fadeOutSec != null ? d.fadeOutSec : null, relations: null, stepOf: parentId, rootId: d.id, startSec: startSec + delay };
        kids.push(k);
        const sub = walk(id, s.children, k.startSec, depth + 1);
        if (sub.length) k.relations = { activates: sub };
        links.push({ triggerId: id, delaySec: delay });
      });
      return links;
    }
    const top = walk(d.id, d.steps, 0, 1);
    const rel = Object.assign({}, d.relations);
    rel.activates = (rel.activates || []).concat(top);
    out.push(Object.assign({}, d, { relations: rel }));
    kids.forEach(k => out.push(k));
  });
  return out;
}
function createTriggerRuleEngine(defs, hooks) {
  const byId = new Map();
  (defs || []).forEach(d => { if (d && d.id) byId.set(d.id, d); });
  const active = [];             // dans l'ordre d'activation
  const cascadedBy = new Map();  // id -> Set des triggers dont la cascade le maintient actif
  const timers = new Map();      // id -> [handles] (coupure auto + cascades en attente ÉMISES par id)
  let depth = 0;
  const rel = id => (byId.get(id) && byId.get(id).relations) || {};
  const isActive = id => active.indexOf(id) >= 0;
  const requiresMet = id => (rel(id).requires || []).every(r => isActive(r));
  function addTimer(owner, h) { (timers.get(owner) || timers.set(owner, []).get(owner)).push(h); }
  function clearTimers(owner) { (timers.get(owner) || []).forEach(h => hooks.cancel(h)); timers.delete(owner); }
  function activate(id, source) {
    if (isActive(id) || depth > 25) return; // 25 : garde-fou contre une boucle de cascades mal configurée
    depth++;
    active.push(id);
    hooks.apply(id, true, source);
    const r = rel(id);
    (r.cuts || []).forEach(x => { if (x !== id && isActive(x)) deactivate(x, 'cut'); });
    (r.activates || []).forEach(a => {
      if (!a || a.triggerId === id || !byId.has(a.triggerId)) return;
      const fire = () => {
        if (!isActive(id)) return; // la source s'est coupée avant l'échéance : la cascade n'a plus lieu
        if (isActive(a.triggerId)) return; // déjà actif (à la main) : reste indépendant de cette cascade
        let set = cascadedBy.get(a.triggerId);
        if (!set) { set = new Set(); cascadedBy.set(a.triggerId, set); }
        set.add(id);
        activate(a.triggerId, 'cascade');
      };
      const d = +a.delaySec > 0 ? +a.delaySec : 0;
      if (d > 0) addTimer(id, hooks.schedule(d, fire)); else fire();
    });
    if (+r.autoOffSec > 0) addTimer(id, hooks.schedule(+r.autoOffSec, () => { if (isActive(id)) deactivate(id, 'auto'); }));
    depth--;
  }
  function deactivate(id, cause) {
    const i = active.indexOf(id);
    if (i < 0) return;
    active.splice(i, 1);
    clearTimers(id);
    cascadedBy.delete(id);
    hooks.apply(id, false, cause);
    (rel(id).activates || []).forEach(a => {
      const set = a && cascadedBy.get(a.triggerId);
      if (set && set.has(id)) {
        set.delete(id);
        if (!set.size) { cascadedBy.delete(a.triggerId); if (isActive(a.triggerId)) deactivate(a.triggerId, 'cascade-off'); }
      }
    });
    active.slice().forEach(x => { if ((rel(x).requires || []).indexOf(id) >= 0) deactivate(x, 'requires-lost'); });
  }
  return {
    // source : 'visitor' (bouton public) | 'composer' (bascule) | 'cascade'. Renvoie false si la demande est refusée
    // (condition « Nécessite » non remplie pour un visiteur), true sinon (y compris si rien ne change).
    request(id, want, source) {
      if (!byId.has(id)) return false;
      source = source || 'composer';
      if (want) {
        if (isActive(id)) return true;
        if (source === 'visitor' && !requiresMet(id)) return false;
        cascadedBy.delete(id);
        activate(id, source);
      } else {
        if (!isActive(id)) return true;
        deactivate(id, source);
      }
      return true;
    },
    isActive,
    activeList: () => active.slice(),
    canActivate: id => isActive(id) || requiresMet(id),
    missingRequirements: id => (rel(id).requires || []).filter(r => !isActive(r)),
    reset() {
      [...timers.keys()].forEach(clearTimers);
      active.splice(0).forEach(id => hooks.apply(id, false, 'reset'));
      cascadedBy.clear();
    }
  };
}
// Rejoue une suite de demandes datées [{t, id, active, source}] avec un temps SIMULÉ (aucune horloge réelle) et
// renvoie tous les changements d'état résultants [{t, id, active}], cascades temporisées et coupures automatiques
// comprises. Utilisé par l'export de l'outil vidéo (capture-render.js).
function simulateTriggerRules(defs, requests) {
  const queue = [];
  let now = 0, seq = 0;
  const changes = [];
  const engine = createTriggerRuleEngine(defs, {
    schedule: (d, fn) => { const h = { t: now + d, fn, seq: seq++, dead: false }; queue.push(h); return h; },
    cancel: h => { h.dead = true; },
    apply: (id, on) => changes.push({ t: now, id, active: on })
  });
  (requests || []).forEach(r => queue.push({ t: r.t, seq: seq++, dead: false, fn: () => engine.request(r.id, r.active, r.source) }));
  while (queue.length) {
    queue.sort((a, b) => (a.t - b.t) || (a.seq - b.seq));
    const h = queue.shift();
    if (h.dead) continue;
    now = h.t;
    h.fn();
  }
  return changes;
}
