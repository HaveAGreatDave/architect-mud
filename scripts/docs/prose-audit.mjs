/**
 * Audit player-facing prose for the tics named in docs/reference/plain-writing.md.
 *
 * This is a REPORTER, not a fixer, and deliberately so. Every pattern below has
 * legitimate uses — a contrast frame that genuinely rejects an objection stays,
 * a closing joke is not an aphorism — so the output is a worklist for a person,
 * not a gate. It is not wired into `docs:lint` for that reason.
 *
 * WHAT IT READS. Player-facing strings only: quests, items, zones, NPC dialogue,
 * glossary, furniture, enemies, drugs, recipes, the four HTML guides, and the
 * comic books written for this game.
 *
 * WHAT IT DOES NOT READ, on purpose:
 *   - content/media_* and data/scripts/*.bsm — broadcast and TV, excluded by
 *     request; that material has its own voice and is not being touched.
 *   - the nine public-domain books, which we did not write and must not edit.
 *   - docs/ — technical prose has its own pass and its own carve-outs.
 *
 *   node scripts/docs/prose-audit.mjs [--only=<surface>] [--full]
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const FULL = process.argv.includes('--full');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];

// The nine we did not write. Never audited, never edited.
const PUBLIC_DOMAIN = new Set([
  'book_modest_proposal', 'book_machine_stops', 'book_scarlet_plague', 'book_we',
  'book_moreau', 'book_iron_heel', 'book_candide', 'book_sleeper_awakes', 'book_opium_eater',
]);

const RULES = [
  {
    id: 'explaining-aside',
    why: 'A clause after an image telling the reader what the image meant. Forster never writes "Orion".',
    re: /,\s*(and|which)\s+(that\s+)?is\s+(the\s+)?(whole|entire|only|real|point|thing|skill|job|worst part|best part|difference|trick|test|way|reason)\b[^.]*\./gi,
  },
  {
    id: 'explaining-aside-small',
    why: 'The "which is not a small thing" family. Delete the clause and add nothing.',
    re: /,?\s*which\s+is\s+(not\s+a\s+small\s+thing|somehow\s+the\s+worst|a\s+whole\s+performance|the\s+point)\b/gi,
  },
  {
    id: 'redundant-orientation',
    why: 'Says a thing is about to be said. Say it.',
    // ⚠ `note that` needs the negative lookbehind: "a sweetish chemical note
    // that you stop noticing" is a noun and turned up on 15 zone tiles.
    re: /\b(it(?:'s| is) worth noting|importantly,|(?<![a-z] )note that\b|in other words|that said,|simply put|to be clear,|the key (?:thing|point) (?:here )?is)\b/gi,
  },
  {
    id: 'staged-emphasis',
    why: 'Announces a reveal instead of making one.',
    re: /\b(here(?:'s| is) the thing|but here(?:'s| is)|and then it hits you|what(?:'s| is) more|crucially,)\b/gi,
  },
  {
    id: 'claudish-vocabulary',
    // ⚠ GUIDES ONLY, and that was learned the hard way. Run against the world
    // this flagged twelve uses of "load-bearing" and every one was correct: a
    // collapsing building, a load-bearing VEST (real webbing kit), "her smile is
    // load-bearing", "the char is load-bearing now", a mutant's extra limb. The
    // Claudish objection is to the word used as a lazy abstraction in technical
    // prose, not to a word that means what it says. The carve-out in
    // plain-writing.md already covers this: in-world prose answers to story.md.
    surfaces: ['guides'],
    why: 'Decode back into the relationship it describes. Technical prose only.',
    // ⚠ only the VERB "surfaces", never the noun: "below the surface the light
    // goes green" is 400 underwater tiles and none of them are Claudish.
    re: /\b(load-bearing|first-class|at scale|surfaces (?:the|a) \w+|leverage[sd]? the|\w-gated)\b/gi,
  },
  {
    id: 'strained-comparative',
    why: 'The "more X than the ones Y-ing" shape. Reads as a saying rather than an answer.',
    re: /\bmore\s+\w+\s+(?:in|on|at)\s+[^.]{0,30}\s+than\s+the\s+ones\b/gi,
  },
  {
    id: 'withdrawal-as-appetite',
    why: 'De Quincey: withdrawal is not a mood and not a wanting. Write the bodily event.',
    re: /\b(you would kill for|crav(?:e|ing)s? (?:it|another)|you want it again)\b/gi,
  },
  // ── the rules added from published craft guidance, 2026-08-25 ─────────────
  // All three were measured clean when written down. They are here so they stay
  // that way, not because anything was wrong.
  {
    id: 'filter-word',
    why: 'A sensory verb between the reader and the scene. "The cat darted" beats "you saw the cat dart" — and the second person makes it always available here, so it needs watching.',
    surfaces: ['zones', 'items', 'furniture', 'enemies'],
    re: /\bYou (?:can )?(?:see|saw|notice|noticed|hear|heard|feel|felt|smell|smelled|watch|watched|observe|observed)\b/g,
  },
  {
    id: 'player-mind',
    why: 'Never tell the player what they think, know, want or decide. Unlike a novel, the person it describes is sitting right there and may disagree.',
    // ⚠ NARRATION SURFACES ONLY, and the reason is the same one that scoped
    // `claudish-vocabulary`: the rule is about the NARRATOR's authority, not
    // about the words. Run unscoped this produced 87 hits and almost all of them
    // were an NPC talking — "You want good, you want the Marquee" is a shopkeeper
    // sizing up a customer, and "You know the drill. And you are late" is a medic
    // who has seen you before. People address each other in the second person
    // constantly. `npcs` and `quests` are excluded because speech and narration
    // share one string in those files and no regex can tell them apart; those two
    // surfaces are a reading job, not a grep job.
    // ⚠ AND NOT DREAMS. Nine of the first twelve hits were dream_templates —
    // "You remember every one being applied", "You understand it perfectly and
    // will not be permitted to keep it". A dream is the one surface where the
    // narration legitimately has authority over the player's mind, because it
    // IS the player's mind, and unearned knowledge is the mechanic rather than
    // an overreach.
    surfaces: ['zones', 'items', 'furniture', 'enemies'],
    re: /\bYou (?:know|knew|realise|realised|realize|realized|understand|understood|believe|believed|remember|remembered|want|wanted|think|thought|decide|decided)\b/g,
  },
  {
    id: 'speech-tag-adverb',
    why: 'Leonard rules 3 and 4: use said, and hang nothing off it.',
    surfaces: ['npcs', 'quests'],
    re: /\b(?:said|says|asked|replied|answered|added|adds)\s+\w+ly\b/gi,
  },
  {
    id: 'distance-break',
    // ⚠ THIS ONE HAS NEVER BEEN TESTED. It enforces the per-surface distance
    // table added to plain-writing.md: room and item descriptions are read by
    // everyone, repeatedly, in an order we do not control, so they report the
    // exterior and never reach inside the player. Emotes and dialogue may.
    why: 'Interiority in a surface written at exterior distance. Room and item descriptions are read cold and out of order, so they cannot presume a mood.',
    surfaces: ['zones', 'items', 'furniture'],
    re: /\b(?:makes? you (?:feel|think|want)|you (?:cannot|can't) help|you are (?:suddenly )?aware|reminds? you of|you get the (?:sense|feeling)|something tells you|you find yourself)\b/gi,
  },
  {
    id: 'widened-claim',
    // ⚠ Guides only, same lesson. In the fiction every hit was literally true —
    // a six-armed thing that "uses every single one", masks that are each
    // quilted, a bouncer's "every single time". Rhetoric in a speaking voice is
    // characterisation, not an overclaim.
    surfaces: ['guides'],
    why: 'Never widen a claim while shortening it. Technical prose only.',
    re: /\b(every single (?:one|time|person|thing)|literally every|without exception|the only way to)\b/gi,
  },
];

// ─── surfaces ────────────────────────────────────────────────────────────────
const strip = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ');

function jsonStrings(obj, out = []) {
  if (typeof obj === 'string') { if (obj.length > 24) out.push(obj); return out; }
  if (Array.isArray(obj)) { for (const v of obj) jsonStrings(v, out); return out; }
  if (obj && typeof obj === 'object') { for (const v of Object.values(obj)) jsonStrings(v, out); return out; }
  return out;
}

const surfaces = [];

for (const dir of ['quests', 'items', 'zones', 'npcs', 'glossary', 'furniture', 'enemies', 'drugs', 'recipes', 'books', 'dream_templates', 'dream_tethers', 'dream_presences', 'job_boards']) {
  const d = path.join(ROOT, 'content', dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    const id = f.replace(/\.json$/, '');
    if (dir === 'books' && PUBLIC_DOMAIN.has(id)) continue;
    surfaces.push({ surface: dir, label: `content/${dir}/${f}`, text: jsonStrings(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))).join('\n') });
  }
}

for (const g of ['client/game/guide.html', 'client/game/guide-text.html', 'client/game/thomas-client-guide.html', 'docs/nine-orders-player-guide.html']) {
  const p = path.join(ROOT, g);
  if (fs.existsSync(p)) surfaces.push({ surface: 'guides', label: g, text: strip(fs.readFileSync(p, 'utf8')) });
}

// ─── run ─────────────────────────────────────────────────────────────────────
const bySurface = new Map();
const hits = [];

for (const s of surfaces) {
  if (ONLY && s.surface !== ONLY) continue;
  bySurface.set(s.surface, (bySurface.get(s.surface) || 0) + 1);
  for (const rule of RULES) {
    if (rule.surfaces && !rule.surfaces.includes(s.surface)) continue;
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(s.text)) !== null) {
      const from = Math.max(0, m.index - 60), to = Math.min(s.text.length, m.index + m[0].length + 60);
      hits.push({ rule: rule.id, label: s.label, surface: s.surface, match: m[0], quote: s.text.slice(from, to).replace(/\s+/g, ' ').trim() });
    }
  }
}

// ⚠ Dedupe by the MATCHED TEXT, not by file. `content/zones` alone is 17,000+
// tiles and a shared line — the same sentence on 400 underwater squares — would
// otherwise read as 400 separate problems. One distinct phrasing is one job;
// the file count is its blast radius.
const byRule = new Map();
for (const h of hits) {
  const key = `${h.rule}::${h.match.toLowerCase()}::${h.quote.slice(0, 90).toLowerCase()}`;
  const bucket = byRule.get(h.rule) || new Map();
  const prev = bucket.get(key);
  if (prev) { prev.count++; if (prev.files.length < 3 && !prev.files.includes(h.label)) prev.files.push(h.label); }
  else bucket.set(key, { ...h, count: 1, files: [h.label] });
  byRule.set(h.rule, bucket);
}

console.log(`Scanned ${surfaces.length} file(s) across ${bySurface.size} surface(s):`);
console.log('  ' + [...bySurface].map(([k, v]) => `${k} ${v}`).join(', '));
const distinct = [...byRule.values()].reduce((n, b) => n + b.size, 0);
console.log(`\n${hits.length} hit(s), ${distinct} distinct line(s), across ${byRule.size} rule(s).\n`);

for (const rule of RULES) {
  const bucket = byRule.get(rule.id);
  if (!bucket || !bucket.size) continue;
  const list = [...bucket.values()].sort((a, b) => b.count - a.count);
  console.log(`── ${rule.id}  (${list.length} distinct, ${list.reduce((n, h) => n + h.count, 0)} total)`);
  console.log(`   ${rule.why}`);
  const show = FULL ? list : list.slice(0, 10);
  for (const h of show) {
    const where = h.count > 1 ? `${h.files[0]} +${h.count - 1} more` : h.files[0];
    console.log(`   · [${h.surface}] ${where}\n     …${h.quote}…`);
  }
  if (list.length > show.length) console.log(`   … and ${list.length - show.length} more distinct (--full)`);
  console.log();
}
if (!hits.length) console.log('Nothing flagged.');
