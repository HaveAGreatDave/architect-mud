// Email address checks shared by the auth screen and the server. Players were
// registering with an address that was slightly wrong (a mistyped domain, or a
// phone keyboard "correcting" it), and with verification on that account could
// never log in. This catches what can be caught before the row is written:
// a malformed address, and a known provider misspelled.

// Deliberately loose: one @, something on each side, a dot in the domain, no
// spaces. Anything stricter starts refusing real addresses.
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

// A sentence for the player, or null if the address will do.
export function emailProblem(email) {
  const e = normalizeEmail(email);
  if (!e) return 'Email required.';
  if (e.length > 254) return "That email address is too long.";
  if (!SHAPE.test(e) || /[,;]|\.\.|@\.|\.$/.test(e)) return "That doesn't look like an email address.";
  return null;
}

// The providers players actually use, from prod. A domain one or two edits away
// from one of these, and not itself on the list, is almost certainly a typo.
const DOMAINS = [
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com',
  'msn.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'web.de', 'mail.com', 'yandex.com',
];

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let before = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // A swapped pair (gmial) counts as one edit, not two.
      if (before && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
    }
    before = prev;
    prev = row;
  }
  return prev[b.length];
}

// The corrected address, or null. Only the domain is ever corrected: nobody can
// tell a mistyped name from a real one.
export function suggestEmail(email) {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf('@');
  if (at < 1) return null;
  const local = e.slice(0, at), domain = e.slice(at + 1);
  if (DOMAINS.includes(domain)) return null;
  let best = null, bestD = 3;
  for (const d of DOMAINS) {
    const dist = distance(domain, d);
    if (dist < bestD) { best = d; bestD = dist; }
  }
  // Two edits on a short domain is a different domain (gmx.de vs gmx.com), so
  // the allowance scales with length.
  const allowed = domain.length >= 9 ? 2 : 1;
  return best && bestD <= allowed ? `${local}@${best}` : null;
}
