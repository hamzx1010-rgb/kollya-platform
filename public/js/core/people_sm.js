/**
 * KOLIYA — people_sm.js
 * ============================================================
 * One profile cache for the whole app.
 *
 * Before this file, five modules each carried their own hardcoded
 * PEOPLE map. That is why a post could show "Étudiant" while the
 * conversation list showed the real name for the same person: two
 * copies of the truth.
 *
 * Now every module reads from here, and api_sm.js fills it from
 * `profiles` in bulk — one request for forty authors, not forty.
 * ============================================================
 */

const cache = new Map();
const pending = new Map();

/** Store rows returned by any query. Later data wins. */
export function cachePeople(rows) {
  for (const r of Array.isArray(rows) ? rows : [rows]) {
    if (r && r.id) cache.set(String(r.id), { ...cache.get(String(r.id)), ...r });
  }
  return rows;
}

/** Synchronous lookup. Never null — rendering must not crash. */
export function person(id) {
  if (!id) return { id: null, full_name: 'Anonyme', username: 'anonyme' };
  return cache.get(String(id)) || {
    id: String(id), full_name: 'Étudiant', username: String(id).slice(0, 8), faculty: ''
  };
}

export const hasPerson = id => cache.has(String(id));
export const allPeople = () => [...cache.values()];
export const forgetPeople = () => cache.clear();

/**
 * Fetch any ids we do not have yet, in one request.
 * Concurrent callers asking for the same id share a single promise.
 */
export async function ensurePeople(ids, fetcher) {
  const want = [...new Set((ids || []).filter(Boolean).map(String))]
    .filter(id => !cache.has(id) && !pending.has(id));
  if (!want.length) {
    await Promise.all((ids || []).map(id => pending.get(String(id))).filter(Boolean));
    return;
  }

  const p = fetcher(want)
    .then(rows => { cachePeople(rows || []); return rows; })
    .catch(() => [])
    .finally(() => { for (const id of want) pending.delete(id); });

  for (const id of want) pending.set(id, p);
  await p;
}

export default { person, cachePeople, ensurePeople, hasPerson, allPeople, forgetPeople };
