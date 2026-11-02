// Username checks shared by the auth screen and the server. The rule is 3 to 24
// letters, numbers and _ . - and it was enforced with one flat sentence that
// never said what was wrong. On a phone the Username box is where autofill drops
// the saved email address, so a player typed a good name into Handle, left an
// address in Username, and got the same refusal "no matter what username" they
// tried. This names the actual problem.

const RULE = /^[a-z0-9_.-]{3,24}$/i;

// Trim, fold compatibility forms (full-width letters from some keyboards) and
// drop invisible characters a paste or keyboard can carry in.
export function normalizeUsername(username) {
  return String(username ?? '')
    .normalize('NFKC')
    .replace(/[​-‍⁠﻿]/g, '')
    .trim();
}

// A sentence for the player, or null if the name will do.
export function usernameProblem(username) {
  const u = normalizeUsername(username);
  if (!u) return 'Username required.';
  if (u.includes('@')) return "Your username can't be an email address. Pick a login name: letters, numbers and _ . - only.";
  if (/\s/.test(u)) return "Usernames can't have spaces. Try _ or - instead.";
  if (u.length < 3) return 'Usernames are 3 characters or more.';
  if (u.length > 24) return 'Usernames are 24 characters or fewer.';
  if (!RULE.test(u)) {
    const bad = [...new Set(u.replace(/[a-z0-9_.-]/gi, ''))].slice(0, 5).join(' ');
    return `Usernames can't contain ${bad}. Letters, numbers and _ . - only.`;
  }
  return null;
}
