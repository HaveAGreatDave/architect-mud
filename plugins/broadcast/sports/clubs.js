// The club seam, server side, shared by every sport with clubs (sports_pools.clubs).
//
// A short stamp for a league's club identities, so a client can tell whether the set it
// holds is current without being sent the set with every payload. The set itself goes out
// once a revision, on `tv_clubs` (broadcast/index.js, sendTvClubs).
const _revs = new WeakMap();
export function clubsRevOf(clubs) {
  if (!clubs || typeof clubs !== 'object') return '';
  let r = _revs.get(clubs);
  if (r == null) {
    const str = JSON.stringify(clubs);
    let x = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619) >>> 0;
    r = `${str.length.toString(36)}${x.toString(36)}`;
    _revs.set(clubs, r);
  }
  return r;
}
