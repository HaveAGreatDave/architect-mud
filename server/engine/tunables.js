import { query } from '../models/db.js';

let cache = null;

export async function reloadTunables() {
  const { rows } = await query('SELECT key, value FROM combat_config');
  cache = {};
  for (const row of rows) cache[row.key] = row.value;
}

export async function ensureTunables() {
  if (!cache) await reloadTunables();
}

export function getTunable(key, defaultValue) {
  if (cache === null) return defaultValue;
  return key in cache ? cache[key] : defaultValue;
}
