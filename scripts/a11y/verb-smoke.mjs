// The `accessibility` verb, actually run.
//
// scripts/a11y/smoke.mjs is a static check — it can tell you the verb is wired
// and reads the shared table, and nothing about whether typing it does anything.
// This one imports the real module against a stub DOM and drives it, because the
// verb is the ONE route to these settings for a player who cannot use the tablet,
// and "the verb throws" is not a failure mode we get to discover in production.
//
// Run: node scripts/a11y/verb-smoke.mjs   (also wired into pretest:regress)

let failed = 0;
const bad = (m) => { console.error(`  ✗ ${m}`); failed++; };
const ok = (m) => console.log(`  ✓ ${m}`);

// ── Stub browser ────────────────────────────────────────────────────────────
const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const attrs = {};
const stubEl = () => ({
  setAttribute: (k, v) => { attrs[k] = v; },
  getAttribute: k => attrs[k] ?? null,
  style: { setProperty() {}, removeProperty() {}, cssText: '' },
  appendChild() {}, removeChild() {},
  querySelectorAll: () => [], querySelector: () => null,
  classList: { toggle() {}, add() {}, remove() {} },
});
const root = stubEl();
globalThis.document = {
  documentElement: root, body: stubEl(), createElement: stubEl,
  getElementById: () => null, querySelector: () => null, addEventListener() {},
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#ffffff' });
let monoCalls = [];
globalThis.window = {
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  AudioEngine: { applyVolumeSettings() {}, setMonoAudio: (on) => monoCalls.push(on) },
};

const { runAccessibilityCommand } = await import('../../client/game/js/a11y-command.js');
const { loadSettings, A11Y_OPTIONS, prefersReducedMotion } =
  await import('../../client/shared/settings.js');

const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ── The bare verb lists everything ──────────────────────────────────────────
{
  const out = text(runAccessibilityCommand(''));
  const missing = A11Y_OPTIONS.filter(o => !out.includes(o.label)).map(o => o.label);
  if (missing.length) bad(`the bare verb doesn't list: ${missing.join(', ')}`);
  else ok(`the bare verb lists all ${A11Y_OPTIONS.length} options with their current values`);
  // Display Mode is not in the table but is the most consequential setting here.
  if (/Display Mode/.test(out)) ok('…and names Display Mode first, though it lives elsewhere');
  else bad('the listing no longer mentions Display Mode — the biggest accessibility lever is unnamed');
  // Every pill has to be clickable AND typeable, or the listing is a dead end.
  if (/data-cmd="accessibility /.test(runAccessibilityCommand(''))) ok('…and every option is a clickable command');
  else bad('the options are not clickable — a mouse user has to retype them');
}

// ── Setting by label, by value, and by unique prefix ────────────────────────
const cases = [
  ['text huge', 'fontSize', '26'],
  ['text 32', 'fontSize', '32'],
  ['text x', 'fontSize', '22'],          // unique prefix of "X-Large"
  ['font readable', 'uiFont', 'readable'],
  ['marks on', 'statusGlyphs', 'on'],
  ['mono on', 'monoAudio', 'on'],
  ['motion off', 'motion', 'off'],
];
for (const [cmd, key, want] of cases) {
  runAccessibilityCommand(cmd);
  const got = String(loadSettings()[key]);
  if (got === want) ok(`\`accessibility ${cmd}\` → ${key}=${got}`);
  else bad(`\`accessibility ${cmd}\` set ${key}=${got}, expected ${want}`);
}

// A size the player ASKED for must outrank the phone's width auto-fit.
if (loadSettings().fontSizeChosen === true) ok('a size set by the verb is marked as chosen, so the mobile auto-fit yields to it');
else bad('the verb does not set fontSizeChosen — on a phone the auto-fit will silently overwrite it');

// ── The settings actually reach the page ────────────────────────────────────
if (root.getAttribute('data-ui-font') === 'readable') ok('applySettings pushed the typeface to the document');
else bad(`data-ui-font is "${root.getAttribute('data-ui-font')}" — the CSS will never see the choice`);
if (root.getAttribute('data-status-glyphs') === 'on') ok('…and the status marks');
else bad('data-status-glyphs was not set — the marks are unreachable');
if (monoCalls.includes(true)) ok('…and mono audio reached the audio engine');
else bad('setMonoAudio was never called — the mono option does nothing');

// ── The derived helpers agree with what was stored ──────────────────────────
if (prefersReducedMotion() === true) ok('prefersReducedMotion() honours the in-game switch with no OS preference set');
else bad('prefersReducedMotion() ignored motion=off — every JS animation will keep running');

// ── Refusals explain themselves ─────────────────────────────────────────────
{
  const unknown = text(runAccessibilityCommand('nonsense'));
  if (/nonsense/.test(unknown) && A11Y_OPTIONS.every(o => unknown.includes(o.verb))) {
    ok('an unknown setting is refused and the real ones are listed');
  } else bad('an unknown setting does not list the valid ones — a dead end');

  const badVal = text(runAccessibilityCommand('font comic'));
  if (/comic/.test(badVal) && /Monospace/.test(badVal)) ok('an unknown value is refused and the valid ones are listed');
  else bad('an unknown value does not list the valid ones');

  // A refusal must never half-apply.
  if (loadSettings().uiFont === 'readable') ok('…and a refused value leaves the setting untouched');
  else bad('a refused value changed the setting anyway');
}

// ── Reset really resets ─────────────────────────────────────────────────────
// The escape hatch for somebody who just made the screen unreadable. If it left
// a single key behind, it would be the key they need it for.
{
  runAccessibilityCommand('reset');
  const s = loadSettings();
  const stuck = A11Y_OPTIONS.filter(o => String(s[o.key]) !== String(o.opts[0].v) && o.key !== 'fontSize');
  const sizeBack = String(s.fontSize) === '16';
  if (!stuck.length && sizeBack && !s.fontSizeChosen) ok('`accessibility reset` returns every option to its default');
  else bad(`reset left ${stuck.map(o => o.key).join(', ') || ''}${sizeBack ? '' : ' fontSize'}${s.fontSizeChosen ? ' fontSizeChosen' : ''} behind`);
}

if (failed) {
  console.error(`\n✗ a11y:verb — ${failed} problem(s). See docs/systems-display-mode.md.`);
  process.exit(1);
}
console.log('✓ a11y:verb clean — the accessibility verb runs, sets, refuses and resets.');
