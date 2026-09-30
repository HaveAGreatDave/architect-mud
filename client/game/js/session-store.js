// Browser storage that can't throw (session and local). Where a browser blocks storage (some privacy
// modes, a sandboxed frame) every access throws, and these calls sit on the
// connect and login path, so one throw there left the player on a blank page
// with no login form. A blocked store reads as empty and ignores writes.
export function sessionGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
export function sessionSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* storage blocked */ }
}
export function sessionRemove(key) {
  try { sessionStorage.removeItem(key); } catch { /* storage blocked */ }
}

// localStorage, the same way, for reads that run at module load.
export function localGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function localSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}
