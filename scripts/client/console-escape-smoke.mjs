// Console escape smoke: the pirate console and the emergency console render
// player-typed text as markup, and that text must arrive inert.
//
// The pirate console put the breaking-news crawl into value="..." with an
// escaper that left quotes alone. A crawl like  x" onmouseover="...  closed the
// attribute and added a handler, and since a seizure kept the crawl, it ran in
// the session of the rival who took the deck next. The emergency console's
// ticker had the same shape.
//
// So this renders both consoles with hostile text in every string the server
// sends, then reads the markup the way a browser's tokenizer would: every
// element and attribute must be one the console wrote itself, and the text
// field must still hold exactly what was typed. It also checks the minigame and
// text-UI toolkits hand out the shared escaper, so their thirty-odd panels get
// the same quote handling.
//
// No browser, no DB, no network. The panels import net.js, which pulls in the
// socket and the rest of the client, so a resolve hook swaps it for a stub.

import { registerHooks } from 'node:module';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) { failed++; console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`); }
};

// ── net.js stub ────────────────────────────────────────────────────────────────
const NET = new URL('../../client/game/js/net.js', import.meta.url).href;
const sent = [];
globalThis.__consoleSmokeSend = (cmd) => sent.push(cmd);
registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    if (r.url === NET) {
      return { url: 'data:text/javascript,export const sendCmdSilent = (c) => globalThis.__consoleSmokeSend(c);', shortCircuit: true };
    }
    return r;
  },
});

// ── DOM stub ───────────────────────────────────────────────────────────────────
// The shape the two panels touch: make an element, append it, set innerHTML,
// wire listeners. innerHTML is kept as the string the panel wrote, which is
// the thing under test.
function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(), id: '', textContent: '', innerHTML: '', children: [],
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    remove() { this._removed = true; },
    querySelector() { return makeEl('div'); },
    querySelectorAll() { return []; },
  };
}
globalThis.document = {
  head: makeEl('head'), body: makeEl('body'),
  getElementById: () => null,
  createElement: (t) => makeEl(t),
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };

// ── A tokenizer for the markup ─────────────────────────────────────────────────
// Start tags and their attributes, read with the browser's rules: a quoted
// value runs to the matching quote, an unquoted one to whitespace or `>`. A
// payload that breaks out of a value shows up here as an attribute or element
// the console never wrote.
function tokenize(html) {
  const tags = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt); i = e < 0 ? html.length : e + 3; continue; }
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt));
    if (!m) { i = lt + 1; continue; }
    const tag = { name: m[1].toLowerCase(), attrs: [], start: lt };
    let j = lt + m[0].length;
    for (;;) {
      while (j < html.length && /\s/.test(html[j])) j++;
      if (j >= html.length) break;
      if (html[j] === '>') { j++; break; }
      if (html[j] === '/' ) { j++; continue; }
      let n = '';
      while (j < html.length && !/[\s=>]/.test(html[j]) && !(html[j] === '/' && n)) n += html[j++];
      while (j < html.length && /\s/.test(html[j])) j++;
      let value = '';
      if (html[j] === '=') {
        j++;
        while (j < html.length && /\s/.test(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          value = html.slice(j + 1, end < 0 ? html.length : end);
          j = end < 0 ? html.length : end + 1;
        } else {
          while (j < html.length && !/[\s>]/.test(html[j])) value += html[j++];
        }
      }
      tag.attrs.push({ name: n.toLowerCase(), value });
    }
    tag.end = j;
    tags.push(tag);
    i = j;
  }
  return tags;
}

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// What the two consoles write, and nothing else. A handler, a style or a new
// element in the parsed markup can only have come from the text.
const TAGS = new Set(['div', 'span', 'button', 'input']);
const ATTR_OK = (n) => n === 'class' || n === 'id' || n === 'title' || n === 'maxlength'
  || n === 'placeholder' || n === 'value' || n === 'aria-label' || /^data-[a-z-]+$/.test(n);

function inert(label, html) {
  for (const t of tokenize(html)) {
    check(`${label}: no element the console didn't write`, TAGS.has(t.name), `<${t.name}>`);
    for (const a of t.attrs) check(`${label}: no attribute the console didn't write`, ATTR_OK(a.name), `<${t.name} ${a.name}=...>`);
  }
}

function fieldValue(html, id) {
  const t = tokenize(html).find(x => x.name === 'input' && x.attrs.some(a => a.name === 'id' && a.value === id));
  return t ? decode(t.attrs.find(a => a.name === 'value')?.value ?? '') : null;
}

const PAYLOADS = [
  'x" onmouseover="alert(1)" style="position:fixed;inset:0',
  "x' onfocus='alert(1)' autofocus x='",
  '"><img src=x onerror=alert(1)>',
  '</div><script>alert(1)</script><div>',
  'Ampersand & "quotes" & \'apostrophes\' stay as typed',
];

// ── Pirate console ─────────────────────────────────────────────────────────────
const pirate = await import('../../client/game/js/panels/piratedeck.js');
const overlayOf = () => document.body.children[document.body.children.length - 1];

for (const p of PAYLOADS) {
  for (const mode of ['recorded', 'live']) {
    pirate.openPirateConsole({
      stationName: p, nowAiring: p, playing: true, mode, loop: 'queue', cursor: 0, crawl: p,
      queue: [{ name: p }, { name: p, mini: true }],
      pool: [{ id: p, name: p, src: 'carried' }],
      sources: [{ key: p, label: p }],
      liveSource: { key: p, label: p },
    });
    const html = overlayOf().innerHTML;
    inert(`pirate console (${mode}) with ${JSON.stringify(p)}`, html);
    check(`pirate console: the crawl field holds the crawl as typed (${mode})`, fieldValue(html, 'pd-crawl-input') === p, JSON.stringify(fieldValue(html, 'pd-crawl-input')));
    pirate.closePirateConsole();
  }
}

// ── Emergency console ──────────────────────────────────────────────────────────
const eb = await import('../../client/game/js/panels/ebconsole.js');
for (const p of PAYLOADS) {
  for (const mode of ['cassette', 'live']) {
    eb.openEmergencyConsole({
      deckName: p, on: true, mode, airingMode: mode, airingSource: p, ticker: p, tickerMax: 200,
      camera: 'c1', cameras: [{ key: 'c1', label: p, direction: p }, { key: 'c2', label: p, droid: true }],
      activeCassetteId: 'bc_a', cassettes: [{ id: 'bc_a', name: p }],
    });
    const html = overlayOf().innerHTML;
    inert(`emergency console (${mode}) with ${JSON.stringify(p)}`, html);
    check(`emergency console: the ticker field holds the ticker as typed (${mode})`, fieldValue(html, 'eb-ticker-input') === p, JSON.stringify(fieldValue(html, 'eb-ticker-input')));
    eb.closeEmergencyConsole();
  }
}

// ── One escaper ────────────────────────────────────────────────────────────────
const { escapeHtml } = await import('../../client/shared/dom.js');
check('escapeHtml escapes both quotes', escapeHtml(`"'`) === '&quot;&#39;', escapeHtml(`"'`));
check('escapeHtml keeps a numeric id', escapeHtml(42) === '42', escapeHtml(42));
check('escapeHtml gives empty text for null and undefined', escapeHtml(null) === '' && escapeHtml(undefined) === '');
const mg = await import('../../client/game/js/panels/minigame-common.js');
check('minigame-common hands out the shared escaper', mg.esc === escapeHtml);
const tx = await import('../../client/game/js/panels/textui.js');
check('textui hands out the shared escaper', tx.esc === escapeHtml);

check('rendering sent no commands', sent.length === 0, JSON.stringify(sent));

if (failed) { console.error(`\n✗ console-escape smoke: ${failed} problem(s).`); process.exit(1); }
