// Every panel either asks the Display Mode rung or says why it doesn't.
//
// At the `log` rung a graphical panel is useless unless what it shows reaches the
// log too (docs/systems-display-mode.md). Every gap an audit found on 2026-10-18
// had the same shape: a plugin sent a panel and never asked which rung the player
// was on, and nothing noticed, because a new panel starts ungated by default.
//
// So: a client handler in dispatch.js that calls an `open…(` function is a panel.
// Any server or plugin file that sends that message type must mention one of the
// rung helpers, or be listed in ALLOW below with a reason. A `GAP:` reason is a
// known hole waiting for a fix, kept here so the list is the backlog.
//
// It's a file-level check, so it can't prove each send is gated, only that the
// file has been thought about. That's the failure it exists for.
//
// Run: node scripts/a11y/rung-sweep.mjs   (in the a11y group of the gate manifest)

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

const RUNG = /\b(textRender|logRender|prefersLoggedPanels\w*|prefersTextMinigames\w*|loggedPanelsSync|textMinigamesSync|wantsDrugFx|prefersTextTravel)\b/;

const ALLOW = {
  'server/engine/commands/housing.js': 'lightview is staff-only (STAFF_ROLES)',
  'plugins/audio/index.js': 'sound_picker is .createsound, admin roles only',
  'plugins/freelook/index.js': 'free look is staff-only',
  'plugins/yacht/index.js': 'the Echelon helm is admin-only',
  'server/engine/vendor.js': 'list_dialog is only sent at the log rung, by commerce, with its own record line',
  'plugins/graffiti/index.js': 'the spray editor has a typed equivalent, tag <dir> <text>',
  'plugins/quests/index.js': 'quest_task is appended to the log by its client handler',
  'plugins/podracer/lot.js': 'the depot is only pushed when seat.js says the rung wants it',
  'plugins/consort/index.js': 'its npc.talk dialogue is written out at the log rung by social.js',
  'plugins/cooking/index.js': 'GAP: bare cookbook opens a list dialog with no log record; cookbook text works',
  'server/engine/graph.js': 'GAP: the OPEN_SHOP graph action sends dialogue_shop with no log-rung branch',
  'plugins/tablet/quests-app.js': 'GAP: the turn-in sends a dialogue frame without setLogTalk/renderTalkLog',
  'plugins/insurance/index.js': 'GAP: the policy panel has no written form; insure/claim by name work',
  'plugins/jail/index.js': 'GAP: the arrest palm search is a timed panel with no log or text path',
  'plugins/trucking/resume.js': 'GAP: a reconnect restores the 3D cab even for a text driver',
  'plugins/voidwalking/index.js': 'GAP: staging is panel-only; ready / voidwalk cancel are never named in the log',
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.claude') walk(p, out); }
    else if (e.name.endsWith('.js') && e.name !== 'regress.js') out.push(p);
  }
  return out;
}

// The handlers that open a panel. Each is a top-level `  name: (msg) => …` entry
// in the handlers table; its body runs to the next entry.
const dispatch = fs.readFileSync(path.join(ROOT, 'client/game/js/dispatch.js'), 'utf8');
const heads = [...dispatch.matchAll(/^ {2}([a-z_][a-z0-9_]*): (?:async )?\(?[a-z, ]*\)? =>/gm)];
const panelTypes = new Set();
heads.forEach((m, i) => {
  const body = dispatch.slice(m.index, heads[i + 1]?.index ?? dispatch.length);
  if (/\bopen[A-Z]\w*\(/.test(body)) panelTypes.add(m[1]);
});

let failed = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failed++; };

if (panelTypes.size < 40) fail(`only ${panelTypes.size} panel handlers found in dispatch.js; the scan has stopped matching its shape`);

const seen = new Set();
for (const file of [...walk(path.join(ROOT, 'server')), ...walk(path.join(ROOT, 'plugins'))]) {
  const src = fs.readFileSync(file, 'utf8');
  const types = new Set([...src.matchAll(/type:\s*'([a-z_0-9]+)'/g)].map(m => m[1]).filter(t => panelTypes.has(t)));
  if (!types.size) continue;
  const name = rel(file);
  if (RUNG.test(src)) continue;
  if (ALLOW[name]) { seen.add(name); continue; }
  fail(`${name} sends ${[...types].join(', ')} and never asks the Display Mode rung. Gate it (textRender, logRender, prefersLoggedPanels…) or add it to ALLOW with a reason.`);
}
for (const name of Object.keys(ALLOW)) {
  if (!seen.has(name)) fail(`ALLOW lists ${name}, which no longer needs it (it asks the rung, sends no panel, or is gone). Take it off the list.`);
}

if (failed) { console.error(`rung-sweep: ${failed} problem(s)`); process.exit(1); }
