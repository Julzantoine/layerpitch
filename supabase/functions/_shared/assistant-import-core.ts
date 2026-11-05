// Logique pure de la porte « import par assistant » (Edge Function assistant-import) : aucune dépendance réseau ni Deno,
// pour être testée sous Node (test_assistant_import_core.js). Tout ce qui décide d'accepter ou de refuser passe par ici.

export const TOKEN_RE = /^lpa_[0-9a-f]{64}$/;
export const PROGRAM_MIN_VERSION = '0.1.0';
export const MAX_BODY_BYTES = 70 * 1024; // plan (64 Ko max) + liste des fichiers

// « Authorization: Bearer lpa_… » -> le jeton, ou null si le format n'est pas exactement celui de nos jetons.
export function parseBearer(header: string | null | undefined): string | null {
  const m = /^Bearer (\S+)$/.exec(header || '');
  return m && TOKEN_RE.test(m[1]) ? m[1] : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Un vrai WAV commence par « RIFF » (ou « RF64 » pour les gros) puis, à l'octet 8, « WAVE ». On lit 12 octets, pas plus.
export function isWavHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  return (tag(0) === 'RIFF' || tag(0) === 'RF64') && tag(8) === 'WAVE';
}

// Compare deux versions « x.y.z » : -1, 0 ou 1. Une version illisible est considérée comme la plus ancienne (donc refusée).
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => { const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(v || ''); return m ? [+m[1], +m[2], +m[3]] : [-1, 0, 0]; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

// Erreurs levées par la base (« assistant:xxx ») -> message français pour la personne, sans détail interne.
const DB_MESSAGES: Record<string, string> = {
  not_released: "La fonction « import par assistant » n'est pas encore ouverte pour ce compte.",
  too_many_imports: "Trop d'imports en attente : ouvre le Backstage pour en traiter ou en écarter, puis réessaie.",
  too_many_files: 'Trop de fichiers dans cet import.',
  no_files: "Aucun fichier à importer.",
  bad_plan: "Le plan envoyé n'est pas valide.",
  bad_file: 'Un des fichiers est mal décrit.',
  bad_file_name: "Un nom de fichier n'est pas acceptable (il doit finir par .wav).",
  file_too_big: 'Un fichier dépasse la taille maximale (150 Mo).',
  import_too_big: 'Cet import dépasse la taille maximale (1 Go).',
  account_quota: "L'espace d'attente du compte est plein (3 Go) : traite les imports en attente d'abord.",
  too_many_tokens: 'Trop de jetons actifs.',
  bad_duration: 'Durée de validité invalide.',
  unknown_composer: 'Compte introuvable.',
};
export function dbErrorMessage(message: string | undefined): { code: string; text: string } {
  const m = /assistant:([a-z_]+)/.exec(message || '');
  const code = m ? m[1] : 'internal';
  return { code, text: DB_MESSAGES[code] || 'Erreur interne.' };
}
