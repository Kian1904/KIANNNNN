// M46: env resolver — prefix baru `K_`, prefix lama `K_SROUTER_` deprecated.
// Aturan: K_<NAME> menang; kalau kosong, fallback ke K_SROUTER_<NAME>.
export const NEW_PREFIX = 'K_';
export const OLD_PREFIX = 'K_SROUTER_';

export function readEnv(name, { env = process.env } = {}) {
  const newKey = NEW_PREFIX + name;
  const oldKey = OLD_PREFIX + name;
  const next = env[newKey];
  if (next !== undefined && next !== '') return next;
  const legacy = env[oldKey];
  if (legacy !== undefined && legacy !== '') return legacy;
  return undefined;
}

export function readEnvInt(name, fallback, opts = {}) {
  const raw = readEnv(name, opts);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readEnvFlag(name, opts = {}) {
  const raw = readEnv(name, opts);
  return raw === '1' || raw === 'true';
}

// Nama-nama env yang dipakai KIANNNNN (dokumentasi + audit).
export const ENV_KEYS = [
  'MODE',
  'UI',
  'AUTOROUTE',
  'STREAM',
  'NO_COLOR',
  'MAX_SEARCH',
  'MAX_FETCH',
  'BASH_TIMEOUT_MS',
  'BASH_MAXBUFFER',
  'BASH_SEND_LIMIT',
  'INTENT_LLM',
];
