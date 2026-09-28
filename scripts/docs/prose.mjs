// docs:prose — a ratcheted lint for AI-sounding prose.
//
//   npm run docs:prose              check against the baseline (runs inside docs:lint)
//   npm run docs:prose -- --report  print the worst files and rules, change nothing
//   npm run docs:prose -- --update  rewrite the baseline after you've cleaned something up
//
// What it reads:
//   - docs/**/*.md, CLAUDE.md, plugins/*/README.md, tools/*/README.md
//   - player-facing strings in content/ (see SKIP_CONTENT for what's left out and why)
//   - the HTML guides under client/game
//
// How it gates. Two kinds of rule:
//   - ERROR rules have no legitimate use (chat-tool citation residue, assistant sign-offs, the
//     breath-you-didn't-know-you-were-holding family). One hit anywhere fails.
//   - WARN rules have legitimate uses, so they're RATCHETED rather than banned: each doc file
//     and each content directory has a recorded count per rule in prose-baseline.json, and the
//     check fails if any count goes up. Counts going down are fine; run --update to lock them in.
//   A new file starts at zero, so new writing is held to the standard and old writing can only
//   get better.
//
// Corpus repetition is its own check: the number of content sentences that appear on more than
// REPEAT_LIMIT tiles/files may not rise. That's the wilderness problem (one sentence on 1,900
// rooms), which no per-file rule can see.
//
// Rules come from docs/reference/plain-writing.md, docs/reference/ai-fiction-tells.md, Wikipedia's
// "Signs of AI writing", Kobak et al. 2024 (excess vocabulary in PubMed abstracts) and the EQ-Bench
// slop lists. Matching is on prose only: code fences, inline code, URLs and HTML tags are stripped
// first, because identifiers like SEA_ROLL and words like `surface` in code are not prose.
//
// `load-bearing` and `-gated` are docs-only: in the fiction they usually mean what they say (a
// collapsing wall, webbing kit), which the first prose-audit run found twelve times out of twelve.
//
// Em dashes are counted everywhere. There is no voice exemption: the Architect and the Ascendants
// lost theirs on 2026-09-27 and carry their voice by formal register and no contractions.
// The nine public-domain books are never read.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASELINE = join(ROOT, 'scripts', 'docs', 'prose-baseline.json');
const REPORT = process.argv.includes('--report');
const UPDATE = process.argv.includes('--update');
const REPEAT_LIMIT = 50;

const ERROR = [
  { id: 'tool-residue', re: /contentReference|oaicite|turn\d+search\d+|\[cite:\s*\d+\]|\[span_\d+\]|grok_card/g },
  { id: 'assistant-residue', re: /\b(great question|i hope this helps|as an ai\b|as of my (last|knowledge) (update|cutoff)|let me know if you)/gi },
  { id: 'fiction-cliche-hard', re: /\bbreath (s?he|they|i|you) didn'?t know (s?he|they|i|you) (was|were) holding|a (shiver|chill) (ran|went|crawled) down (his|her|their|my|your) spine|sent shivers down|somewhere(,)? (in the distance,? )?a dog barked|the world (seemed to )?held its breath/gi },
];

const WARN = [
  // A contraction hung on a pronoun that is the object of a preposition ("everything in it's
  // reachable"). The 2026-09-04 contractions sweep made 334 of these; scripts/prose/object-contractions.mjs
  // expands them. A warn rather than an error: in speech "all of it's gone" is
  // ordinary English, and a character written that way can be accepted with --update.
  { id: 'object-contraction', re: /\b(in|of|on|to|for|with|from|at|by|about|like|than|into|onto|under|behind|inside|through|all|none|most|some) (it|you|that|this|they|we|them)('s|'re|'ll|'ve)\b/gi },
  { id: 'vocab', re: /\b(delv(e|es|ed|ing)|tapestr(y|ies)|testament to|showcas(e|es|ed|ing)|underscor(e|es|ed|ing)|meticulous(ly)?|intricac(y|ies)|pivotal|interplay|multifaceted|bolster(s|ed|ing)?|garner(s|ed|ing)?|plethora|myriad|paradigm|synergy|holistic|leverag(e|es|ed|ing)|utiliz(e|es|ed|ing)|elucidat(e|es|ed|ing)|embark(s|ed|ing)?)\b/gi },
  { id: 'jargon-metaphor', re: /\bload-bearing\b|\b\w+-gated\b/gi, docsOnly: true },
  { id: 'negative-parallelism', re: /\bnot (just|only|merely|simply) [^.;!?]{1,60}?,? (but|it'?s|it is)\b|\b(it'?s|it is|this is|that'?s) not (about )?[^.;!?]{1,40}[.;,]\s*(it'?s|it is|this is|that'?s)\b|\bnot because\b[^.]{0,80}\.\s+because\b/gi },
  { id: 'significance-frame', re: /\bplays? a (crucial|pivotal|vital|key|significant) role|underscor\w* the importance|reflects? (a )?broader|setting the stage for|indelible mark|deeply rooted|evolving landscape|serves as a (reminder|testament)|a (stark|powerful) reminder|\b(serves|stands|functions) as (a|an|the) /gi },
  // Constructed irony: a description built as setup plus twist. Fallout 2's examine texts do this in
  // about 3% of lines; it was the shape of many of ours. See house-voice.md, "The default register".
  { id: 'constructed-irony', re: /\b(says|said|claims?|promises?|advertises?|reads|is labelled|is marked|is reserved)\b[^.!?]{3,120}[.!?]\s+(There is no|There's no|There are no|It isn't|It is not|It doesn't|It does not|It never|Nobody has ever)\b|\b(\w{4,})\b[^.!?]{0,90}\b(stops? being|stopped being|isn't|is not|wasn't|never was) (a |an |the )?\3\b|\bthe speed of (a|something) (thing )?that isn't\b|\bthe only thing (anyone|anybody|everyone)\b/gi },
  { id: 'staged-reveal', re: /\bhere'?s the (thing|catch|kicker|twist)|\bthe (real|deeper|honest) (answer|point|question|truth) is\b|\band (that'?s|this is) (the point|why it matters)|\bit'?s worth (noting|mentioning)|\bit'?s important to (note|remember)|\bneedless to say\b|\bsimply put\b|\bthe bottom line\b/gi },
  { id: 'aphoristic-closer', re: /\b(that|this|which)('s| is| was) (the )?(whole|entire|only|real) (point|argument|trick|lesson|reason|thing)\b|\bwhich is the part (worth|that)\b|\bthe part worth keeping\b/gi },
  { id: 'fiction-cliche', re: /\bbarely above a whisper|the (air|room) (was |grew )?(thick|heavy) with|a (flicker|glint) of (something|mischief|amusement)|a (wry|knowing) smile (tugged|played)|the ghost of a smile|let out a (shaky|ragged) breath|maybe, just maybe|(palpable|unspoken) (tension|silence)|the silence (stretched|hung)|time (seemed to )?(stand|stood) still\b/gi },
  { id: 'promotional', re: /\b(nestled|in the heart of|breathtaking|a must-see|hidden gem|rich tapestry)\b/gi },
  { id: 'transition-opener', re: /(^|[.!?]\s+)(Moreover|Furthermore|Additionally|Ultimately|Notably|Importantly|Crucially|Interestingly),/gm },
  { id: 'caps-run', re: /\b[A-Z]{3,}(?: [A-Z']{2,}){2,}\b/g },
  { id: 'em-dash', re: /—|&mdash;|&#8212;/g },
];

// Content directories that are not player-facing prose.
const SKIP_CONTENT = new Set([
  'books', 'building_models', 'fauna_models', 'vehicle_models', 'generators', 'power_zones', 'map', 'maps',
  'connections', 'audio_ambient', 'audio_event_routes', 'audio_instruments', 'audio_samples', 'audio_sfx',
  'audio_songs', 'interface_sfx', 'climate_profiles', 'combat_config', 'command_aliases', 'aircraft_types',
  'media_broadcasts', 'media_cameras', 'media_channel_playlist', 'media_channels', 'media_deck_units',
  'media_graphics', 'media_themes', 'zone_spawns', 'loot_tables', 'scavenging_table_items', 'org_relations',
]);
const SKIP_KEYS = new Set(['id', 'map_id', 'marker', 'icon', 'script', 'graph', 'code', 'sql', 'css', 'color']);
// These two docs catalogue the tells, so they quote them. Error rules skip them; warn rules still apply.
const CATALOGS = new Set(["docs/reference/plain-writing.md", "docs/reference/ai-fiction-tells.md"]);

function walk(dir, test, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out); else if (test(p)) out.push(p);
  }
  return out;
}

const stripMd = (t) => t.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\]\([^)]*\)/g, ']');
const stripHtml = (t) => t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');

function contentStrings(v, key, out) {
  if (typeof v === 'string') { if (!SKIP_KEYS.has(key) && v.length >= 30 && v.includes(' ')) out.push(v); }
  else if (Array.isArray(v)) for (const x of v) contentStrings(x, key, out);
  else if (v && typeof v === 'object') for (const k in v) contentStrings(v[k], k, out);
  return out;
}

const count = (re, text) => { re.lastIndex = 0; let n = 0; while (re.exec(text)) n++; return n; };

// ---- gather units: { key, text } ----
const units = [];
const rel = (p) => relative(ROOT, p).split(sep).join('/');
for (const p of [join(ROOT, 'CLAUDE.md'), ...walk(join(ROOT, 'docs'), (f) => f.endsWith('.md')),
  ...walk(join(ROOT, 'plugins'), (f) => f.endsWith(sep + 'README.md')),
  ...walk(join(ROOT, 'tools'), (f) => f.endsWith(sep + 'README.md'))]) {
  if (existsSync(p)) units.push({ key: rel(p), text: stripMd(readFileSync(p, 'utf8'))});
}
for (const p of walk(join(ROOT, 'client', 'game'), (f) => f.endsWith('.html'))) {
  units.push({ key: rel(p), text: stripHtml(readFileSync(p, 'utf8'))});
}
const sentenceHits = new Map();
const contentByDir = new Map();
// Descriptions longer than their surface's hard maximum (house-voice.md, "Length"). Counted per
// directory and ratcheted like any warn rule. Hero posters and betatapes are exempt: the text is the content.
const DESC_MAX = { zones: 60, items: 45, furniture: 45, npcs: 65, enemies: 50 };
const overLength = new Map();
for (const dir of readdirSync(join(ROOT, 'content'))) {
  if (SKIP_CONTENT.has(dir)) continue;
  for (const p of walk(join(ROOT, 'content', dir), (f) => f.endsWith('.json'))) {
    let json; try { json = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    const strs = contentStrings(json, '', []);
    const desc = json.description || json.tags?.description;
    if (DESC_MAX[dir] && typeof desc === 'string' && !/hero_poster|betatape/.test(p) && desc.split(/\s+/).length > DESC_MAX[dir]) {
      overLength.set(dir, (overLength.get(dir) || 0) + 1);
    }
    if (!strs.length) continue;
    const bucket = contentByDir.get(dir) || [];
    bucket.push(...strs);
    contentByDir.set(dir, bucket);
    for (const s of strs) for (const sent of s.split(/(?<=[.!?])\s+/)) {
      if (sent.length < 30) continue;
      sentenceHits.set(sent, (sentenceHits.get(sent) || 0) + 1);
    }
  }
}
for (const [dir, b] of contentByDir) {
  units.push({ key: `content/${dir}`, text: b.join('\n') });
}

// ---- score ----
const counts = {};   // key -> rule -> n
const errors = [];
for (const u of units) {
  for (const r of ERROR) {
    if (CATALOGS.has(u.key)) continue;
    r.re.lastIndex = 0; const m = r.re.exec(u.text);
    if (m) errors.push(`${u.key}: ${r.id}: "${m[0]}"`);
  }
  const c = (counts[u.key] ||= {});
  for (const r of WARN) {
    if (r.docsOnly && u.key.startsWith("content/")) continue;
    if (r.fictionOnly && !(u.key.startsWith("content/") || u.key.startsWith("client/"))) continue;
    const n = count(r.re, u.text);
    if (n) c[r.id] = (c[r.id] || 0) + n;
  }
}
const repeated = [...sentenceHits].filter(([, n]) => n > REPEAT_LIMIT).sort((a, b) => b[1] - a[1]);
for (const [dir, n] of overLength) (counts[`content/${dir}`] ||= {})['over-length'] = n;
for (const k of Object.keys(counts)) if (!Object.keys(counts[k]).length) delete counts[k];

// ---- report / update / check ----
if (REPORT) {
  const totals = {};
  for (const c of Object.values(counts)) for (const [r, n] of Object.entries(c)) totals[r] = (totals[r] || 0) + n;
  console.log('Totals by rule:'); for (const [r, n] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(`  ${r.padEnd(22)} ${n}`);
  const worst = Object.entries(counts).map(([k, c]) => [k, Object.values(c).reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log('\nWorst files/dirs:'); for (const [k, n] of worst) console.log(`  ${String(n).padStart(6)}  ${k}`);
  console.log(`\nSentences repeated on more than ${REPEAT_LIMIT} content entries: ${repeated.length}`);
  for (const [s, n] of repeated.slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${s.slice(0, 100)}`);
  if (errors.length) { console.log('\nErrors:'); errors.forEach((e) => console.log('  ' + e)); }
  process.exit(0);
}

if (UPDATE) {
  const sorted = Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]]));
  writeFileSync(BASELINE, JSON.stringify({ repeatedSentences: repeated.length, files: sorted }, null, 2) + '\n');
  console.log(`docs:prose baseline written: ${Object.keys(sorted).length} entries, ${repeated.length} repeated sentences.`);
  if (errors.length) { console.error('But these ERROR hits must be fixed, the baseline does not cover them:'); errors.forEach((e) => console.error('  ' + e)); process.exit(1); }
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { repeatedSentences: 0, files: {} };
const rises = [];
for (const [k, c] of Object.entries(counts)) for (const [r, n] of Object.entries(c)) {
  const was = base.files[k]?.[r] || 0;
  if (n > was) rises.push(`${k}: ${r} ${was} -> ${n}`);
}
if (repeated.length > base.repeatedSentences) {
  rises.push(`content: sentences repeated on more than ${REPEAT_LIMIT} entries ${base.repeatedSentences} -> ${repeated.length} (top: "${repeated[0][0].slice(0, 80)}" x${repeated[0][1]})`);
}
let improved = 0;
for (const [k, c] of Object.entries(base.files)) for (const [r, n] of Object.entries(c)) if ((counts[k]?.[r] || 0) < n) improved++;

if (errors.length || rises.length) {
  console.error('docs:prose FAILED');
  for (const e of errors) console.error('  error  ' + e);
  for (const r of rises) console.error('  rise   ' + r);
  console.error('\nRules and fixes: docs/reference/plain-writing.md. If the new count is deliberate (a character who talks like that),');
  console.error('rewrite what you can, then run `npm run docs:prose -- --update` and say why in the commit.');
  process.exit(1);
}
console.log(`docs:prose ok (${units.length} units checked${improved ? `, ${improved} counts below baseline: run --update to lock them in` : ''}).`);
