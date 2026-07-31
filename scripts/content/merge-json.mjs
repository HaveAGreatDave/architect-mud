// A git merge driver for content/**/*.json — merges by KEY, not by line.
//
// Why this exists: the two long-lived branches change these files in ways that
// compose perfectly and conflict anyway. The derive work on studio-manager
// *removes* keys the build now owns ("audio_theme_id": null, "marker": null);
// main *edits values* ("The Hock Shop" → "In Hock We Trust"). Neither side
// touches a key the other touched — but the edits land on adjacent lines, and
// git's text merge sees only lines. A dry-run merge of 133 main commits into
// studio-manager produced 112 conflicts, 93 of them this exact shape.
//
// Git's own default is right for source files, where line adjacency really does
// imply semantic adjacency. It is wrong for a canonically-serialized object
// dump, where line order is an artifact of `Object.keys().sort()` and carries no
// meaning at all. That is the whole argument for this file.
//
// The merge is the standard three-way rule applied per key, recursively:
//   ours == theirs           → agreed, take it
//   ours == base             → only theirs moved, take theirs
//   theirs == base           → only ours moved, take ours
//   both objects             → recurse
//   otherwise                → a real disagreement, and a human decides
//
// Deletion is a value like any other: a key present in base and absent on one
// side was deleted by that side, and that survives so long as the other side
// left it alone. A key one side deleted and the other side edited is a genuine
// conflict — that is a decision about whether the field still exists, and this
// script must not make it quietly.
//
// Arrays are compared whole and never merged element-wise. Order is meaning in
// `exits`, `ambient_events` and the connection lists (canonicalJson deliberately
// leaves arrays alone for the same reason), so a positional merge would invent
// orderings neither author wrote.
//
// Output goes through canonicalJson, so a merge lands byte-identical to what
// `content:export` would have written. A merge that produced almost-canonical
// output would show up as spurious churn on the next export — the failure mode
// .gitattributes' eol=lf rule already exists to prevent.
//
// Wiring (per clone — .gitattributes names the driver, git config supplies it):
//   git config merge.contentjson.name "content JSON semantic merge"
//   git config merge.contentjson.driver "node scripts/content/merge-json.mjs %O %A %B %P"
// A clone that has not run those two lines falls back to git's text merge with a
// warning, which is the old behaviour — never a wrong merge, just a noisy one.
//
// Called by git as: <driver> %O %A %B %P
//   %O base   %A ours (and the file the result must be written to)   %B theirs
//   %P the real pathname, for messages
// Exit 0 = merged clean. Exit 1 = conflict left in %A for a human.

import { readFileSync, writeFileSync } from 'node:fs';
import { canonicalJson } from './lib.mjs';

const [basePath, oursPath, theirsPath, displayPath = oursPath] = process.argv.slice(2);

// An add/add conflict hands us an empty base. Treat "no base" as an empty object
// rather than bailing: every key is then "added on one side", which the same
// rule below resolves correctly whenever the two sides agree.
function load(path, fallback) {
  try {
    const text = readFileSync(path, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return undefined; // unparseable — caller falls back to git's text merge
  }
}

const MISSING = Symbol('missing');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const conflicts = [];

function merge(base, ours, theirs, path) {
  if (eq(ours, theirs)) return ours;                    // agreed, including agreed deletion
  if (eq(ours, base)) return theirs;                    // only theirs moved
  if (eq(theirs, base)) return ours;                    // only ours moved

  // Both moved. Objects can still merge key-by-key; anything else is a decision.
  if (isPlainObject(ours) && isPlainObject(theirs)) {
    const b = isPlainObject(base) ? base : {};
    const out = {};
    for (const key of new Set([...Object.keys(b), ...Object.keys(ours), ...Object.keys(theirs)])) {
      const at = path ? `${path}.${key}` : key;
      const bv = key in b ? b[key] : MISSING;
      const ov = key in ours ? ours[key] : MISSING;
      const tv = key in theirs ? theirs[key] : MISSING;
      const merged = merge(bv, ov, tv, at);
      if (merged !== MISSING) out[key] = merged;
    }
    return out;
  }

  // Absent-by-default: `null` and "key omitted" are the same statement — "no
  // override" — and rowToFileObject omits the key precisely so 5,785 files don't
  // spell out a non-statement. So one side dropping a key that was null in base
  // is a formatting change, not a semantic one, and it must not out-vote the
  // other side actually setting a value. This resolves the derive pass's null
  // stripping against a real authored override, which is otherwise the single
  // most common disagreement between these two branches.
  const droppedANull = (side, other) => side === MISSING && base === null && other !== MISSING;
  if (droppedANull(ours, theirs)) return theirs;
  if (droppedANull(theirs, ours)) return ours;

  conflicts.push(path || '(whole file)');
  return ours;
}

const base = load(basePath, {});
const ours = load(oursPath, {});
const theirs = load(theirsPath, {});

// If any side isn't JSON we have nothing to say about it. Leaving %A untouched
// and exiting non-zero hands the file back to git exactly as it found it.
if (base === undefined || ours === undefined || theirs === undefined) {
  process.stderr.write(`merge-json: ${displayPath} is not parseable JSON — leaving it to git\n`);
  process.exit(1);
}

const result = merge(base, ours, theirs, '');

if (conflicts.length) {
  // A real disagreement. Write ordinary conflict markers so the file resolves the
  // way every other conflicted file does, and name the keys on stderr — the whole
  // point of merging by key is knowing which key it was.
  const marked =
    `<<<<<<< ours\n${canonicalJson(ours)}=======\n${canonicalJson(theirs)}>>>>>>> theirs\n`;
  writeFileSync(oursPath, marked, 'utf8');
  process.stderr.write(
    `merge-json: ${displayPath} — ${conflicts.length} key(s) changed on both sides: ${conflicts.join(', ')}\n`
  );
  process.exit(1);
}

writeFileSync(oursPath, canonicalJson(result), 'utf8');
process.exit(0);
