/* ---------------- Aide à l'implémentation (réglage global, une case par logiciel) ---------------- */
function fillImplementationSkillsFields() {
  document.getElementById('skillWwise').checked = !!implementationSkills.wwise;
  document.getElementById('skillFmod').checked = !!implementationSkills.fmod;
  document.getElementById('skillUnity').checked = !!implementationSkills.unity;
  document.getElementById('skillUnreal').checked = !!implementationSkills.unreal;
}
document.getElementById('skillWwise').addEventListener('change', e => { implementationSkills.wwise = e.target.checked; hasUnsavedEdits = true; });
document.getElementById('skillFmod').addEventListener('change', e => { implementationSkills.fmod = e.target.checked; hasUnsavedEdits = true; });
document.getElementById('skillUnity').addEventListener('change', e => { implementationSkills.unity = e.target.checked; hasUnsavedEdits = true; });
document.getElementById('skillUnreal').addEventListener('change', e => { implementationSkills.unreal = e.target.checked; hasUnsavedEdits = true; });
fillImplementationSkillsFields();

function fillNoAiCertifiedGlobalField() {
  document.getElementById('noAiCertifiedGlobal').checked = !!noAiCertifiedGlobal;
}
document.getElementById('noAiCertifiedGlobal').addEventListener('change', e => {
  noAiCertifiedGlobal = e.target.checked;
  hasUnsavedEdits = true;
  renderLibrary(); // les fiches morceau affichent le réglage global effectif pour ceux réglés sur "suivre"
});
fillNoAiCertifiedGlobalField();

function fillAllowEmbeddingField() {
  document.getElementById('allowEmbeddingCheckbox').checked = !!allowEmbedding;
}
document.getElementById('allowEmbeddingCheckbox').addEventListener('change', e => {
  allowEmbedding = e.target.checked;
  hasUnsavedEdits = true;
});
fillAllowEmbeddingField();

