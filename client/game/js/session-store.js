// sessionStorage that can't throw. Where a browser blocks storage (some privacy
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
