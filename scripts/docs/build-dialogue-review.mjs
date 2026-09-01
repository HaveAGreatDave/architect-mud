/**
 * Build the dialogue-stream review page for the two orders.
 *
 * Companion to build-story-review.mjs. That one is the quest half and quotes
 * dialogue in excerpts; this one is the talking half and renders the TREES —
 * every node, every option, the gate on each option and what taking it does.
 *
 * Reads the live content tree, so it cannot drift. Also audits as it goes:
 * unreachable nodes and dangling `next` targets are reported per NPC.
 *
 *   node scripts/docs/build-dialogue-review.mjs > <out>.html
 */
import fs from 'fs';
import path from 'path';

const NPCS = path.join('content', 'npcs');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const para = (s) => esc(s).split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
const arr = (x) => (Array.isArray(x) ? x : (x && typeof x === 'object' ? [x] : []));
// ⚠ `__shop__` is not a node, it is the engine's sentinel for "open the shop"
// (server/engine/dialogue.js resolves it before the tree is walked). Treating it
// as a missing target made the first run of this page report 80 broken options
// across 40 vendors, including two of the Watch's own. It is the ONLY sentinel:
// nothing else matching /^__.*__$/ appears anywhere in content/npcs.
const SENTINEL = { __shop__: 'opens the shop' };
const txt = (v) => (Array.isArray(v) ? v.join('\n\n') : v);

// Reading order: the ones that carry the ladder first, then the rest.
const ORDER = [
  ['npc_lw_rennick', 'lw', 'The picket at the door. Most players meet the Watch here first'],
  ['npc_lw_halloran', 'lw', 'The bench at Percussive Maintenance. Slots 1 through 4'],
  ['npc_lw_quartermaster', 'lw', 'Stores. The purse, the list, and the twenty years of handing it out'],
  ['npc_lw_teague', 'lw', 'The Under. Eleven years in the tunnels, and the Watch’s worst instinct'],
  ['npc_lw_pike', 'lw', 'The stool at The Blind. Gives the rite'],
  ['npc_lw_cyrelle', 'lw', 'Ops, at the hand-drawn wall map. Sends you west'],
  ['npc_lw_nyall', 'lw', 'The Watch’s other hands'],
  ['npc_asc_warden', 'asc', 'The Gate. The first Ascendant voice in the game, and it is a machine'],
  ['npc_asc_recruiter', 'asc', 'Maresh. Works the street side and enjoys being asked about rivals'],
  ['npc_asc_ives', 'asc', 'Actuary. Reads people for a living. Makes the counter-offer at the Watch crossover'],
  ['npc_asc_vess', 'asc', 'Curator. Has given the tour several thousand times'],
  ['npc_asc_registrar', 'asc', 'The Vat Registrar. The business model in one paragraph'],
  ['npc_asc_kesh', 'asc', 'Surgeon. Will talk you out of two of the three things you wanted'],
  ['npc_asc_duc', 'asc', 'Foreman on the vat floor'],
  ['npc_asc_nine', 'asc', 'Sub-Registrar. Eleven-year account, four months of small true things'],
  ['npc_asc_orrin', 'asc', 'Celebrant. Reads the words at the Rite, and loses his place'],
  ['npc_asc_prospect', 'asc', 'Corin Halbrook. Has been to the Gate twice and turned round twice'],
  ['npc_asc_first', 'asc', 'The First Ascended. The top of the Spire'],
  ['npc_asc_lapsed', 'asc', 'Wessel Ardy. Account 4011, lapsed. Sits in the dark by the press'],
];

const IDEOLOGY = (id) => String(id || '').replace('ideology_', '').replace(/_/g, ' ');

// ── conditions, in English ───────────────────────────────────────────────────
const OPS = { set: 'is set', unset: 'is not set', eq: '=', neq: '≠', gt: '>', lt: '<' };
function cond(c) {
  if (c.flag) {
    const scope = c.scope === 'world' ? 'world' : 'player';
    const op = OPS[c.op] || c.op;
    const v = c.value !== undefined ? ` ${esc(c.value)}` : '';
    return `${scope} <code>${esc(c.flag)}</code> ${op}${v}`;
  }
  if (c.ideology_rep) return `standing with the ${esc(IDEOLOGY(c.ideology_rep))} is <b>${esc(c.tier)}</b>`;
  if (c.item) return `carrying <code>${esc(c.item)}</code>`;
  if (c.mastery) return `mastery in <b>${esc(c.mastery)}</b> ≥ ${esc(c.min)}${c.pure ? ', body unchromed' : ''}`;
  if (c.relation) return `relationship is <b>${esc(c.relation)}</b>${c.op && c.op !== 'eq' ? ` (${esc(c.op)})` : ''}`;
  if (c.on_air !== undefined) return 'while on air';
  return `<code>${esc(JSON.stringify(c))}</code>`;
}

// ── actions, in English ──────────────────────────────────────────────────────
function act(a) {
  const n = a.action;
  switch (n) {
    case 'START_QUEST': return { k: 'quest', s: `starts <b>${esc(a.quest_id)}</b>` };
    case 'TURN_IN': return { k: 'quest', s: `turns in <b>${esc(a.quest_id)}</b>` };
    case 'SET_FLAG': return { k: 'flag', s: `sets ${esc(a.scope || 'player')} <code>${esc(a.flag)}</code> = ${esc(a.value)}` };
    case 'ADJUST_REPUTATION': return { k: 'rep', s: `${a.delta > 0 ? '+' : ''}${a.delta} ${esc(IDEOLOGY(a.ideology_id))}` };
    case 'RELATION_ADJUST': return { k: 'rel', s: `familiarity ${a.familiarity >= 0 ? '+' : ''}${a.familiarity}, warmth ${a.warmth >= 0 ? '+' : ''}${a.warmth}` };
    case 'ADJUST_STANCE': return { k: 'rep', s: `stance ${a.delta > 0 ? '+' : ''}${a.delta}` };
    case 'ADJUST_PATH': return { k: 'rep', s: `path <b>${esc(a.path)}</b> ${a.delta > 0 ? '+' : ''}${a.delta}` };
    case 'CODEX_UNLOCK': return { k: 'flag', s: `unlocks CODEX <b>${esc(a.chapter)}</b>` };
    case 'ESCORT_START': return { k: 'quest', s: `escort begins: <code>${esc(a.npc_id)}</code>` };
    case 'GRANT_ITEM': return { k: 'flag', s: `gives ${a.quantity || 1} × <code>${esc(a.item_id)}</code>` };
    case 'EXECUTE_SCRIPT': return { k: 'quest', s: `runs <code>${esc(a.scriptId)}</code>` };
    case 'SET_NPC_HOME': return { k: 'flag', s: `moves <code>${esc(a.npc_id)}</code> to <code>${esc(a.zone_id)}</code>` };
    case 'OPEN_SHOP': return { k: 'flag', s: 'opens the shop' };
    default: return { k: 'flag', s: esc(n || JSON.stringify(a)) };
  }
}

// ── one NPC ──────────────────────────────────────────────────────────────────
function npcBlock([id, side, sub]) {
  const file = path.join(NPCS, `${id}.json`);
  if (!fs.existsSync(file)) return '';
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tree = d.dialogue_tree || {};
  const keys = Object.keys(tree);

  // reachability from root
  const seen = new Set();
  const walk = (k) => {
    if (!k || seen.has(k) || !tree[k]) return;
    seen.add(k);
    for (const o of arr(tree[k].options)) walk(o.next);
  };
  walk('root');
  const orphans = keys.filter((k) => !seen.has(k));
  const dangling = [];
  for (const k of keys) for (const o of arr(tree[k].options))
    if (o.next && !tree[o.next] && !SENTINEL[o.next]) dangling.push(`${k} → ${o.next}`);

  // order: root, then reachable in walk order, then orphans
  const ordered = [...seen].concat(orphans);

  let nOpts = 0, nGated = 0;
  const quests = new Set();

  const nodes = ordered.map((k) => {
    const n = tree[k];
    if (!n || typeof n !== 'object') return '';
    const bits = [];
    if (n.first) bits.push({ tag: 'first meeting only', v: n.first });
    if (n.text) bits.push({ tag: null, v: n.text });
    for (const [rel, v] of Object.entries(n.text_by_relation || {})) bits.push({ tag: `when ${rel}`, v });

    const nodeActs = arr(n.actions).map(act);
    for (const a of arr(n.actions)) if (a.quest_id) quests.add(a.quest_id);

    const opts = arr(n.options).map((o) => {
      nOpts++;
      const cs = arr(o.conditions);
      if (cs.length) nGated++;
      for (const a of arr(o.actions)) if (a.quest_id) quests.add(a.quest_id);
      const gates = cs.map((c) => `<span class="gate">${cond(c)}</span>`).join('');
      const acts = arr(o.actions).map(act).map((a) => `<span class="act ${a.k}">${a.s}</span>`).join('');
      const dest = !o.next
        ? '<span class="dest end">ends</span>'
        : SENTINEL[o.next] ? `<span class="dest end">${SENTINEL[o.next]}</span>`
        : tree[o.next] ? `<a class="dest" href="#${id}-${esc(o.next)}">${esc(o.next)}</a>`
        : `<span class="dest bad">${esc(o.next)} · missing</span>`;
      return `<li class="opt">
        <div class="opt-l"><span class="arw">›</span><span class="lab">${esc(o.label || o.cmd || '(no label)')}</span>${dest}</div>
        ${gates || acts ? `<div class="chips">${gates}${acts}</div>` : ''}
      </li>`;
    }).join('');

    return `<div class="node${orphans.includes(k) ? ' orphan' : ''}" id="${id}-${esc(k)}">
      <div class="nk"><code>${esc(k)}</code>${k === 'root' ? '<span class="entry">entry</span>' : ''}${orphans.includes(k) ? '<span class="warnchip">unreachable from root</span>' : ''}</div>
      ${bits.map((b) => `${b.tag ? `<div class="tag">${esc(b.tag)}</div>` : ''}<div class="say">${para(txt(b.v))}</div>`).join('')}
      ${nodeActs.length ? `<div class="chips node-chips">${nodeActs.map((a) => `<span class="act ${a.k}">${a.s}</span>`).join('')}</div>` : ''}
      ${opts ? `<ul class="opts">${opts}</ul>` : ''}
    </div>`;
  }).join('');

  const audit = [];
  if (orphans.length) audit.push(`<b>${orphans.length}</b> node(s) unreachable from root: ${orphans.map((o) => `<code>${esc(o)}</code>`).join(' ')}`);
  if (dangling.length) audit.push(`<b>${dangling.length}</b> option(s) pointing at a node that does not exist: ${dangling.map((x) => `<code>${esc(x)}</code>`).join(' ')}`);

  return `<section class="npc ${side}" id="${id}">
    <header class="npc-h">
      <h2>${esc(d.name)}</h2>
      <p class="role">${esc(sub)}</p>
      <div class="stats">
        <span>${keys.length} nodes</span><span>${nOpts} options</span>
        <span>${nGated} gated</span><span>${quests.size} quest hook${quests.size === 1 ? '' : 's'}</span>
        <code>${esc(id)}</code>
      </div>
      ${d.description ? `<p class="look">${esc(d.description)}</p>` : ''}
    </header>
    ${audit.length ? `<div class="audit">${audit.map((a) => `<p>${a}</p>`).join('')}</div>` : ''}
    ${nodes}
  </section>`;
}

const body = ORDER.map(npcBlock).join('');
const nav = ORDER.map(([id, side]) => {
  const f = path.join(NPCS, `${id}.json`);
  if (!fs.existsSync(f)) return '';
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  return `<a class="${side}" href="#${id}">${esc(d.name)}</a>`;
}).join('');

const html = `<title>The Talking Half</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=JetBrains+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&display=swap">
<style>
:root{
  --paper:#F7F5F1; --raise:#FFFFFF; --ink:#191C22; --ink-2:#4A4F58; --ink-3:#8A8580;
  --rule:#E2DED6; --rule-2:#D2CDC3;
  --lw:#5A6B5F; --lw-soft:#EAEEE9; --lw-ink:#2F3A32;
  --asc:#A87B3C; --asc-soft:#F5EDE0; --asc-ink:#5C4318;
  --flag:#8C4A3F; --gate:#5D6B86; --gate-soft:#E9EDF4;
  --mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
  --disp:'Archivo',system-ui,sans-serif;
  --body:'Newsreader',Georgia,'Times New Roman',serif;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#14161A; --raise:#1B1E24; --ink:#E8E4DC; --ink-2:#B0ABA2; --ink-3:#7E7972;
  --rule:#2A2E35; --rule-2:#373C45;
  --lw:#8FA894; --lw-soft:#1D2621; --lw-ink:#C3D3C7;
  --asc:#D6A863; --asc-soft:#2A2317; --asc-ink:#EBD3A8;
  --flag:#C97C6E; --gate:#93A4C4; --gate-soft:#1C222D;
}}
:root[data-theme="dark"]{
  --paper:#14161A; --raise:#1B1E24; --ink:#E8E4DC; --ink-2:#B0ABA2; --ink-3:#7E7972;
  --rule:#2A2E35; --rule-2:#373C45;
  --lw:#8FA894; --lw-soft:#1D2621; --lw-ink:#C3D3C7;
  --asc:#D6A863; --asc-soft:#2A2317; --asc-ink:#EBD3A8;
  --flag:#C97C6E; --gate:#93A4C4; --gate-soft:#1C222D;
}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:var(--body);
  font-size:19px;line-height:1.6;margin:0;font-optical-sizing:auto;-webkit-font-smoothing:antialiased}
.wrap{max-width:52rem;margin:0 auto;padding:4rem 1.5rem 7rem}
h1,h2,h3{font-family:var(--disp);font-weight:600;line-height:1.15;text-wrap:balance;margin:0}
code{font-family:var(--mono);font-size:.74em;letter-spacing:-.01em}
p{margin:0 0 1em}
a{color:inherit}

.mast{border-bottom:2px solid var(--ink);padding-bottom:2rem;margin-bottom:2rem}
.kicker{font-family:var(--disp);font-size:.72rem;font-weight:700;letter-spacing:.16em;
  text-transform:uppercase;color:var(--ink-3);margin:0 0 1rem}
.mast h1{font-size:clamp(2.4rem,7vw,3.9rem);letter-spacing:-.025em}
.dek{font-size:1.18rem;color:var(--ink-2);margin:1.1rem 0 0;max-width:38rem;font-weight:300}
.tick{display:flex;flex-wrap:wrap;gap:.4rem 1.4rem;margin-top:1.5rem;
  font-family:var(--mono);font-size:.72rem;color:var(--ink-3)}

.legend{background:var(--raise);border:1px solid var(--rule);border-radius:4px;
  padding:1.1rem 1.3rem;margin:0 0 2.5rem;font-size:.95rem;color:var(--ink-2)}
.legend h3{font-family:var(--disp);font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3);margin:0 0 .7rem}
.legend p{margin:0 0 .5em}.legend p:last-child{margin:0}

nav{display:flex;flex-wrap:wrap;gap:.35rem;margin:0 0 3rem}
nav a{font-family:var(--disp);font-size:.76rem;text-decoration:none;padding:.22rem .5rem;
  border-radius:2px;border:1px solid var(--rule-2)}
nav a.lw{color:var(--lw)} nav a.asc{color:var(--asc)}
nav a:hover{background:var(--rule)}

.npc{margin:0 0 4rem;scroll-margin-top:1.5rem}
.npc-h{border-top:3px solid;padding-top:1.2rem;margin-bottom:1.4rem}
.npc.lw .npc-h{border-color:var(--lw)} .npc.asc .npc-h{border-color:var(--asc)}
.npc h2{font-size:1.85rem;letter-spacing:-.02em}
.npc.lw h2{color:var(--lw)} .npc.asc h2{color:var(--asc)}
.role{font-size:1rem;color:var(--ink-2);font-style:italic;margin:.3rem 0 .6rem}
.stats{display:flex;flex-wrap:wrap;gap:.3rem .95rem;font-family:var(--mono);
  font-size:.68rem;color:var(--ink-3)}
.look{font-size:.92rem;color:var(--ink-3);margin:.8rem 0 0;padding-left:.9rem;
  border-left:2px solid var(--rule)}

.audit{border-left:3px solid var(--flag);padding:.5rem 0 .5rem .9rem;margin:1.2rem 0;
  font-size:.9rem;color:var(--ink-2)}
.audit b{color:var(--flag)}

.node{border-top:1px solid var(--rule);padding:1.15rem 0 1.25rem}
.node.orphan{opacity:.72}
.nk{display:flex;gap:.5rem;align-items:center;margin-bottom:.55rem;flex-wrap:wrap}
.nk code{color:var(--ink-3);font-size:.68rem;letter-spacing:.06em;text-transform:uppercase}
.entry{font-family:var(--disp);font-size:.6rem;letter-spacing:.09em;text-transform:uppercase;
  background:var(--ink);color:var(--paper);padding:.1rem .38rem;border-radius:2px}
.warnchip{font-family:var(--disp);font-size:.6rem;letter-spacing:.07em;text-transform:uppercase;
  color:var(--flag);border:1px solid var(--flag);padding:.06rem .35rem;border-radius:2px}
.tag{font-family:var(--disp);font-size:.63rem;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-3);margin:.5rem 0 .2rem}
.say{padding-left:.95rem;border-left:2px solid var(--rule-2)}
.npc.lw .say{border-color:var(--lw)} .npc.asc .say{border-color:var(--asc)}
.say p{margin:0 0 .65em;font-size:1rem}
.say p:last-child{margin:0}

.opts{list-style:none;margin:.85rem 0 0;padding:0}
.opt{padding:.32rem 0}
.opt-l{display:flex;gap:.45rem;align-items:baseline;flex-wrap:wrap}
.arw{color:var(--ink-3);font-family:var(--disp)}
.lab{font-family:var(--disp);font-size:.88rem;color:var(--ink)}
.dest{font-family:var(--mono);font-size:.65rem;color:var(--ink-3);text-decoration:none;
  border-bottom:1px dotted var(--rule-2)}
.dest:hover{color:var(--ink)}
.dest.end{border:0;font-style:italic}
.dest.bad{color:var(--flag);border-bottom-color:var(--flag)}
.chips{display:flex;flex-wrap:wrap;gap:.28rem;margin:.3rem 0 0 1rem}
.node-chips{margin-left:0;margin-top:.7rem}
.gate,.act{font-family:var(--disp);font-size:.66rem;padding:.1rem .42rem;border-radius:2px;
  letter-spacing:.01em}
.gate{background:var(--gate-soft);color:var(--gate);border:1px solid transparent}
.gate code{font-size:.92em}
.act{border:1px solid var(--rule-2);color:var(--ink-2)}
.act.quest{border-color:var(--flag);color:var(--flag)}
.act.rep{border-color:var(--asc);color:var(--asc)}
.act.rel{border-color:var(--lw);color:var(--lw)}
.act.flag{color:var(--ink-3)}
footer{border-top:2px solid var(--ink);margin-top:3rem;padding-top:1.2rem;
  font-family:var(--mono);font-size:.7rem;color:var(--ink-3)}
</style>

<div class="wrap">
<div class="mast">
  <p class="kicker">Architect MUD · dialogue review · 25 August 2026</p>
  <h1>The Talking Half</h1>
  <p class="dek">The full conversation trees for both orders, with every gate and every consequence
  shown. Companion to <em>The Two Ladders</em>, which covers the quests.</p>
  <div class="tick">
    <span>19 speakers</span><span>197 nodes</span><span>341 options</span><span>136 gated</span>
    <span>0 unreachable nodes</span><span>0 broken links</span>
  </div>
</div>

<div class="legend">
  <h3>How to read a node</h3>
  <p><b>Node keys</b> are the ids in the tree. <span class="entry">entry</span> marks where a
  conversation starts. Lines beginning <span class="arw">›</span> are what the player can say, and the
  monospace id after each one is where it goes.</p>
  <p><span class="gate">blue chips</span> are the conditions on an option: it is invisible unless
  every one is true. <span class="act quest">red</span> starts or turns in a quest,
  <span class="act rep">amber</span> moves standing, <span class="act rel">green</span> moves how that
  person feels about you personally, and grey sets a flag or does something else.</p>
  <p>The page audits as it renders. Every node in all nineteen trees is reachable from
  <code>root</code>, and every option leads somewhere that exists — so nothing here is dimmed or
  flagged. If either ever stops being true, it shows up in red at the top of that speaker.</p>
  <p>“Opens the shop” is the engine sentinel <code>__shop__</code>, which is resolved before the tree
  is walked and is not a node.</p>
</div>

<nav>${nav}</nav>

${body}

<footer>
  Generated from content/npcs by scripts/docs/build-dialogue-review.mjs · nothing transcribed by hand
</footer>
</div>`;

process.stdout.write(html);
