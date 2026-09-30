// "Remember me". The client keeps the username (to fill the form) and a signed
// token the server hands back after a remembered login (server/engine/
// auth-tokens.js signRememberToken). It never keeps the password.
//
// Older clients stored the password itself under mud_remember_pass. The first
// auto-login after this shipped uses it once, asks for a token in the same
// message, and deletes it, so nobody is signed out by the change and no password
// stays on disk.
//
// Every storage call is guarded: where storage is blocked the getter throws, and
// this runs at boot, before anything else could catch it.

const USER = 'mud_remember_user';
const TOKEN = 'mud_remember_token';
const LEGACY_PASS = 'mud_remember_pass';

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
const del = (k) => { try { localStorage.removeItem(k); } catch { /* storage blocked */ } };

export const rememberedUser = () => get(USER);

/** True when an auto-login is about to be tried, so the form can stay hidden. */
export const hasAutoLogin = () => !!(get(TOKEN) || (get(USER) && get(LEGACY_PASS)));

/** Called on submit. Off forgets everything; on keeps the name for the form. */
export function setRemember(on, username) {
  if (on) set(USER, username);
  else { del(USER); del(TOKEN); }
  del(LEGACY_PASS);
}

export function saveRememberToken(token) {
  if (token) set(TOKEN, token);
  del(LEGACY_PASS);
}

export function forgetRememberToken() { del(TOKEN); }

/**
 * The message that signs this browser back in, or null. A legacy password is
 * read once and deleted here, whatever happens next.
 */
export function autoLoginMessage(displayRung) {
  const token = get(TOKEN);
  if (token) return { type: 'auth_remember', token, displayRung };
  const username = get(USER);
  const password = get(LEGACY_PASS);
  del(LEGACY_PASS);
  if (username && password) return { type: 'auth', username, password, remember: true, displayRung };
  return null;
}
