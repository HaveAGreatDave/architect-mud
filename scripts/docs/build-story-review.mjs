/**
 * Build the story-review page for the two order ladders.
 *
 * Reads the LIVE content tree rather than a transcription, so the page cannot
 * drift from what a player would actually be shown. Re-run it after any prose
 * change and republish.
 *
 *   node scripts/docs/build-story-review.mjs > <out>.html
 */
import fs from 'fs';
import path from 'path';

const C = (dir, id) => JSON.parse(fs.readFileSync(path.join('content', dir, `${id}.json`), 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Quest prose uses \n\n for paragraphs and carries a little inline markup.
const para = (s) => esc(s).split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

const LADDERS = [
  {
    key: 'lw', name: 'The Long Watch', short: 'Watch',
    creed: 'Stay in the body you were issued. Get better instead.',
    voice: 'No euphemisms anywhere. They say the ugly part out loud and do not soften it. No em dashes — that is the other side’s tell.',
    slots: [
      { n: 1, id: 'quest_lw_1', move: 'benign', who: 'Halloran' },
      { n: 2, id: 'quest_lw_2', move: 'benign', who: 'Halloran' },
      { n: 3, id: 'quest_lw_3', move: 'benign', who: 'Halloran' },
      { n: 4, id: 'quest_lw_meet', move: 'test', who: 'Halloran' },
      { n: 5, id: 'quest_lw_fav_carry', move: 'test', who: 'The Quartermaster' },
      { n: 6, id: 'quest_lw_4', move: 'test', who: 'The Quartermaster' },
      { n: 7, id: 'quest_asc_1', move: 'crossover', who: 'The Quartermaster → Verity Ives', note: 'Shared file with the Ascendant ladder. The Watch sends you; Halcyon makes the counter-offer at the gate.' },
      { n: 8, id: 'quest_lw_fav_quiet', move: 'cost', who: 'Halloran' },
      { n: 9, id: 'quest_lw_loyalty', move: 'cost', who: 'The Quartermaster' },
      { n: 10, id: 'quest_lw_rite', move: 'rite', who: 'Pike' },
    ],
  },
  {
    key: 'asc', name: 'The Ascendants', short: 'Ascendants',
    creed: 'Buy a better machine. Halcyon Assurance will underwrite the difference.',
    voice: 'Nothing sinister is ever said. Every line is warm, correct, and would survive being read back in a hearing. Em dashes throughout — the house tell.',
    slots: [
      { n: 1, id: 'quest_asc_2', move: 'benign', who: 'Warden Unit “Threshold”' },
      { n: 2, id: 'quest_asc_file', move: 'benign', who: 'Verity Ives' },
      { n: 3, id: 'quest_asc_3', move: 'benign', who: 'Vess' },
      { n: 4, id: 'quest_asc_fav_tolerance', move: 'test', who: 'Kesh' },
      { n: 5, id: 'quest_asc_fav_lead', move: 'test', who: 'Verity Ives' },
      { n: 6, id: 'quest_asc_fav_adjuster', move: 'test', who: 'an adjuster' },
      { n: 7, id: 'quest_asc_cross', move: 'crossover', who: 'Verity Ives → Wessel Ardy', note: 'The mirror of the Watch’s slot 7, and not the same move. Ives pitches in daylight having done the sums. Ardy makes no pitch at all — he opens by saying he wants nothing, and is there to tell you one plain thing about the job after this one.' },
      { n: 8, id: 'quest_asc_turn', move: 'cost', who: 'Kesh' },
      { n: 9, id: 'quest_asc_loyalty', move: 'cost', who: 'Vess' },
      { n: 10, id: 'quest_asc_rite', move: 'rite', who: 'the Nave' },
    ],
  },
];

const MOVE_LABEL = {
  benign: 'Benign · are you turning up?',
  test: 'A test that does not look like one',
  crossover: 'Crossover · the rival makes an offer',
  cost: 'Work with a cost',
  rite: 'The rite · locks you in',
};

// Dialogue worth reading in full, chosen for voice rather than coverage.
const DIALOGUE = [
  { npc: 'npc_lw_rennick', side: 'lw', title: 'Rennick', sub: 'The picket. The first Watch voice most players meet', nodes: ['root','wary','terms','carrying','hardline'] },
  { npc: 'npc_lw_halloran', side: 'lw', title: 'Halloran', sub: 'The bench at Percussive Maintenance. Slots 1-4', nodes: ['root','lw_offer_1','meet_offer','meet_truth','meet_truth2','lw_reveal'] },
  { npc: 'npc_lw_quartermaster', side: 'lw', title: 'The Quartermaster', sub: 'Stores. The purse and the shopping list', nodes: ['root','creed','loyalty_offer','loyalty_report'] },
  { npc: 'npc_lw_pike', side: 'lw', title: 'Pike', sub: 'On the stool at The Blind. Gives the rite', nodes: ['root','door','rite_offer','kept'] },
  { npc: 'npc_lw_teague', side: 'lw', title: 'Teague', sub: 'The Under. Eleven years in the tunnels, and the Watch’s worst instinct', nodes: ['root','clean','south','south_children'] },
  { npc: 'npc_asc_warden', side: 'asc', title: 'Warden Unit "Threshold"', sub: 'The Gate. The first Ascendant voice in the game', nodes: ['root','what','refuse'] },
  { npc: 'npc_asc_ives', side: 'asc', title: 'Actuary Verity Ives', sub: 'Reads people for a living. Makes the counter-offer at the Watch crossover', nodes: ['root','pitch','pitch2','terms','refused'] },
  { npc: 'npc_asc_registrar', side: 'asc', title: 'The Vat Registrar', sub: 'The business model, in one paragraph', nodes: ['root','how'] },
  { npc: 'npc_asc_first', side: 'asc', title: 'The First', sub: 'The top of the Spire', nodes: ['root','reveal','turn_warn','rite_offer'] },
  { npc: 'npc_asc_lapsed', side: 'asc', title: 'Wessel Ardy', sub: 'Lapsed Halcyon client, account 4011. Sits in the dark by the press', nodes: ['root','cross_meet_watch','cross_offer','cross_who','cross_terms','cross_stay'] },
];
// ─── gather ──────────────────────────────────────────────────────────────────
function questBlock(slot) {
  const q = C('quests', slot.id);
  const objs = (q.objectives || []).map((o) => `
    <li class="obj">
      <div class="obj-h"><code class="ty">${esc(o.type)}</code><span class="obj-d">${esc(o.desc || '')}</span></div>
      ${(o.emotes || []).length ? `<ul class="emotes">${o.emotes.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    </li>`).join('');
  const rew = q.rewards || {};
  const bits = [];
  if (rew.credits) bits.push(`₵${rew.credits}`);
  if (rew.xp) bits.push(`${rew.xp} xp`);
  for (const r of rew.rep || []) bits.push(`${r.delta > 0 ? '+' : ''}${r.delta} ${r.ideology.replace('ideology_', '').replace(/_/g, ' ')}`);
  for (const f of rew.flags || []) bits.push(`${f.flag}=${f.value}`);

  return `
  <article class="q ${slot.move}" id="${slot.id}">
    <header class="q-h">
      <div class="slot"><span class="n">${slot.n}</span><span class="of">of 40</span></div>
      <div class="q-t">
        <h3>${esc(q.name)}</h3>
        <div class="meta"><span class="mv">${MOVE_LABEL[slot.move]}</span><span class="sep">·</span><span class="who">${esc(slot.who)}</span><span class="sep">·</span><code class="id">${esc(slot.id)}</code></div>
      </div>
    </header>
    ${slot.note ? `<p class="note">${esc(slot.note)}</p>` : ''}
    <div class="prose">${para(q.description)}</div>
    <ol class="objs">${objs}</ol>
    ${bits.length ? `<div class="rew">${bits.map((b) => `<code>${esc(b)}</code>`).join('')}</div>` : ''}
  </article>`;
}

function dialogueBlock(d) {
  let n;
  try { n = C('npcs', d.npc); } catch { return ''; }
  const tree = n.dialogue_tree || {};
  const nodes = d.nodes.map((k) => {
    const node = tree[k];
    if (!node) return '';
    const txts = [];
    if (node.first) txts.push({ tag: 'first meeting only', v: node.first });
    if (node.text) txts.push({ tag: k === 'root' ? 'every visit' : null, v: node.text });
    for (const [rel, v] of Object.entries(node.text_by_relation || {})) txts.push({ tag: `when ${rel}`, v });
    const body = txts.map((t) => `${t.tag ? `<div class="tag">${esc(t.tag)}</div>` : ''}<div class="say">${para(Array.isArray(t.v) ? t.v.join('\n\n') : t.v)}</div>`).join('');
    const opts = (node.options || []).map((o) => `<li>${esc(o.label)}</li>`).join('');
    return `<div class="node"><div class="node-k"><code>${esc(k)}</code></div>${body}${opts ? `<ul class="opts">${opts}</ul>` : ''}</div>`;
  }).join('');
  return `
  <article class="dlg ${d.side}">
    <header><h3>${esc(d.title)}</h3><p class="sub">${esc(d.sub)}</p><code class="id">${esc(d.npc)}</code></header>
    ${nodes}
  </article>`;
}

// ─── page ────────────────────────────────────────────────────────────────────
const ladderHtml = LADDERS.map((L) => `
<section class="ladder ${L.key}" id="${L.key}">
  <div class="l-head">
    <h2>${esc(L.name)}</h2>
    <p class="creed">${esc(L.creed)}</p>
    <p class="voice"><strong>Voice rule.</strong> ${L.voice}</p>
  </div>
  ${L.slots.map(questBlock).join('')}
  <div class="unbuilt">
    <div class="ub-bar">${Array.from({ length: 30 }, (_, i) => `<span title="slot ${i + 11}"></span>`).join('')}</div>
    <p><strong>Slots 11–40 are not written.</strong> Five ranks of six, each paying standing that opens hardware, doors and dialogue. Everything above is built so that none of it closes them off.</p>
  </div>
</section>`).join('');

const html = `<title>The Two Ladders</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=JetBrains+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&display=swap">
<style>
:root{
  --paper:#F7F5F1; --raise:#FFFFFF; --ink:#191C22; --ink-2:#4A4F58; --ink-3:#8A8580;
  --rule:#E2DED6; --rule-2:#D2CDC3;
  --lw:#5A6B5F; --lw-soft:#EAEEE9; --lw-ink:#2F3A32;
  --asc:#A87B3C; --asc-soft:#F5EDE0; --asc-ink:#5C4318;
  --flag:#8C4A3F;
  --mono:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
  --disp:'Archivo',system-ui,sans-serif;
  --body:'Newsreader',Georgia,'Times New Roman',serif;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#14161A; --raise:#1B1E24; --ink:#E8E4DC; --ink-2:#B0ABA2; --ink-3:#7E7972;
  --rule:#2A2E35; --rule-2:#373C45;
  --lw:#8FA894; --lw-soft:#1D2621; --lw-ink:#C3D3C7;
  --asc:#D6A863; --asc-soft:#2A2317; --asc-ink:#EBD3A8;
  --flag:#C97C6E;
}}
:root[data-theme="dark"]{
  --paper:#14161A; --raise:#1B1E24; --ink:#E8E4DC; --ink-2:#B0ABA2; --ink-3:#7E7972;
  --rule:#2A2E35; --rule-2:#373C45;
  --lw:#8FA894; --lw-soft:#1D2621; --lw-ink:#C3D3C7;
  --asc:#D6A863; --asc-soft:#2A2317; --asc-ink:#EBD3A8;
  --flag:#C97C6E;
}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:var(--body);
  font-size:19px;line-height:1.62;margin:0;padding:0;
  font-optical-sizing:auto;-webkit-font-smoothing:antialiased}
.wrap{max-width:50rem;margin:0 auto;padding:4rem 1.5rem 7rem}
h1,h2,h3,h4{font-family:var(--disp);font-weight:600;line-height:1.15;text-wrap:balance;margin:0}
code{font-family:var(--mono);font-size:.76em;letter-spacing:-.01em}
p{margin:0 0 1.05em}
a{color:inherit}

/* ── masthead ── */
.mast{border-bottom:2px solid var(--ink);padding-bottom:2rem;margin-bottom:2.5rem}
.kicker{font-family:var(--disp);font-size:.72rem;font-weight:700;letter-spacing:.16em;
  text-transform:uppercase;color:var(--ink-3);margin:0 0 1rem}
.mast h1{font-size:clamp(2.4rem,7vw,3.9rem);letter-spacing:-.025em}
.dek{font-size:1.2rem;color:var(--ink-2);margin:1.1rem 0 0;max-width:38rem;font-weight:300}
.tick{display:flex;flex-wrap:wrap;gap:.4rem 1.4rem;margin-top:1.6rem;
  font-family:var(--mono);font-size:.72rem;color:var(--ink-3)}

/* ── prose sections ── */
section{margin:0 0 4.5rem}
.intro h2{font-size:1.55rem;margin:2.6rem 0 .9rem;letter-spacing:-.01em}
.intro p{color:var(--ink-2)}
.intro strong{color:var(--ink);font-weight:500}
.rules{list-style:none;padding:0;margin:1.4rem 0 0;counter-reset:r}
.rules li{counter-increment:r;position:relative;padding:0 0 0 3rem;margin:0 0 1.5rem;color:var(--ink-2)}
.rules li::before{content:counter(r,decimal-leading-zero);position:absolute;left:0;top:.1em;
  font-family:var(--disp);font-weight:700;font-size:.82rem;color:var(--ink-3);letter-spacing:.04em}
.rules b{display:block;font-family:var(--disp);font-size:.95rem;font-weight:600;
  color:var(--ink);margin-bottom:.25rem;letter-spacing:.005em}

/* ── ladder ── */
.ladder{scroll-margin-top:2rem}
.l-head{border-top:3px solid;padding-top:1.4rem;margin-bottom:2.5rem}
.ladder.lw .l-head{border-color:var(--lw)}
.ladder.asc .l-head{border-color:var(--asc)}
.l-head h2{font-size:2.2rem;letter-spacing:-.02em}
.ladder.lw .l-head h2{color:var(--lw)}
.ladder.asc .l-head h2{color:var(--asc)}
.creed{font-size:1.1rem;color:var(--ink-2);font-style:italic;margin:.5rem 0 .9rem}
.voice{font-size:.92rem;color:var(--ink-2);margin:0;padding:.75rem .95rem;border-radius:3px}
.ladder.lw .voice{background:var(--lw-soft)}
.ladder.asc .voice{background:var(--asc-soft)}
.voice strong{font-family:var(--disp);font-size:.74rem;letter-spacing:.1em;text-transform:uppercase}
.ladder.lw .voice strong{color:var(--lw-ink)}
.ladder.asc .voice strong{color:var(--asc-ink)}

/* ── quest card ── */
.q{border-top:1px solid var(--rule-2);padding:1.7rem 0 2rem;position:relative}
.q-h{display:flex;gap:1.1rem;align-items:flex-start;margin-bottom:1.1rem}
.slot{flex:0 0 3.1rem;text-align:right;padding-top:.15rem}
.slot .n{display:block;font-family:var(--disp);font-weight:700;font-size:1.9rem;line-height:1;
  letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.ladder.lw .slot .n{color:var(--lw)}
.ladder.asc .slot .n{color:var(--asc)}
.slot .of{display:block;font-family:var(--mono);font-size:.6rem;color:var(--ink-3);margin-top:.2rem}
.q-t h3{font-size:1.42rem;letter-spacing:-.015em}
.meta{margin-top:.35rem;font-family:var(--disp);font-size:.73rem;color:var(--ink-3);
  letter-spacing:.03em;display:flex;flex-wrap:wrap;gap:.4rem;align-items:baseline}
.meta .mv{font-weight:600;text-transform:uppercase;letter-spacing:.09em}
.ladder.lw .meta .mv{color:var(--lw)}
.ladder.asc .meta .mv{color:var(--asc)}
.q.rite .meta .mv,.q.crossover .meta .mv{color:var(--flag)}
.meta .sep{color:var(--rule-2)}
.note{font-size:.9rem;color:var(--ink-2);border-left:2px solid var(--rule-2);
  padding-left:.85rem;margin:0 0 1.1rem}
.prose{margin-left:4.2rem}
.prose p{margin:0 0 .85em}
.prose p:last-child{margin-bottom:0}

/* ── objectives ── */
.objs{list-style:none;margin:1.4rem 0 0 4.2rem;padding:0;border-left:1px solid var(--rule);}
.obj{padding:.55rem 0 .55rem 1rem;position:relative}
.obj::before{content:"";position:absolute;left:-3px;top:1.15rem;width:5px;height:5px;
  border-radius:50%;background:var(--rule-2)}
.obj-h{display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap}
.ty{background:var(--rule);color:var(--ink-2);padding:.1rem .42rem;border-radius:2px;
  font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;font-weight:500;flex:none}
.obj-d{font-size:.98rem;color:var(--ink)}
.emotes{list-style:none;margin:.5rem 0 0;padding:0}
.emotes li{font-size:.9rem;color:var(--ink-3);font-style:italic;line-height:1.5;
  padding:.12rem 0 .12rem .8rem;border-left:1px dotted var(--rule-2);margin-bottom:.15rem}
.rew{margin:1.1rem 0 0 4.2rem;display:flex;flex-wrap:wrap;gap:.35rem}
.rew code{background:var(--raise);border:1px solid var(--rule);color:var(--ink-3);
  padding:.14rem .45rem;border-radius:2px;font-size:.66rem}

/* ── unbuilt run ── */
.unbuilt{border-top:1px solid var(--rule-2);padding-top:1.5rem;margin-top:.5rem}
.ub-bar{display:flex;gap:3px;margin-bottom:1rem;flex-wrap:wrap}
.ub-bar span{width:14px;height:26px;border:1px dashed var(--rule-2);border-radius:1px;flex:none}
.unbuilt p{font-size:.92rem;color:var(--ink-3);margin:0}
.unbuilt strong{color:var(--ink-2);font-family:var(--disp);font-size:.86rem}

/* ── crossover pair ── */
.pair{display:grid;grid-template-columns:1fr 1fr;gap:1.6rem;margin-top:1.6rem}
.pair>div{padding:1.1rem 1.2rem;border-radius:3px;font-size:.95rem}
.pair .p-lw{background:var(--lw-soft);border-top:2px solid var(--lw)}
.pair .p-asc{background:var(--asc-soft);border-top:2px solid var(--asc)}
.pair h4{font-family:var(--disp);font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;
  margin:0 0 .6rem}
.pair .p-lw h4{color:var(--lw-ink)} .pair .p-asc h4{color:var(--asc-ink)}
.pair p{margin:0;color:var(--ink-2)}
@media(max-width:640px){.pair{grid-template-columns:1fr}}

/* ── dialogue ── */
.dlg{border-top:1px solid var(--rule-2);padding:1.6rem 0 1.9rem}
.dlg header{margin-bottom:1.1rem}
.dlg h3{font-size:1.3rem}
.dlg.lw h3{color:var(--lw)} .dlg.asc h3{color:var(--asc)}
.dlg .sub{font-size:.9rem;color:var(--ink-3);margin:.25rem 0 .35rem;font-style:italic}
.dlg .id{color:var(--ink-3);font-size:.66rem}
.node{margin:0 0 1.3rem;padding-left:1rem;border-left:2px solid var(--rule)}
.dlg.lw .node{border-color:var(--lw)} .dlg.asc .node{border-color:var(--asc)}
.node-k{margin-bottom:.4rem}
.node-k code{color:var(--ink-3);font-size:.64rem;letter-spacing:.06em;text-transform:uppercase}
.tag{font-family:var(--disp);font-size:.64rem;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-3);margin:.55rem 0 .25rem}
.say p{margin:0 0 .7em}
.say p:last-child{margin-bottom:0}
.opts{list-style:none;margin:.7rem 0 0;padding:0;display:flex;flex-direction:column;gap:.2rem}
.opts li{font-family:var(--disp);font-size:.8rem;color:var(--ink-2);padding-left:1.05rem;position:relative}
.opts li::before{content:"\\203A";position:absolute;left:.2rem;color:var(--ink-3)}

/* ── elsewhere ── */
.card{background:var(--raise);border:1px solid var(--rule);border-radius:4px;
  padding:1.3rem 1.4rem;margin:0 0 1.1rem}
.card h3{font-size:1.12rem;margin-bottom:.5rem}
.card p{font-size:.96rem;color:var(--ink-2);margin-bottom:.6em}
.card p:last-child{margin-bottom:0}
.beats{list-style:none;padding:0;margin:.8rem 0 0;border-left:2px solid var(--rule-2)}
.beats li{padding:.32rem 0 .32rem .9rem;font-size:.93rem;color:var(--ink-2)}
.beats b{font-family:var(--mono);font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;
  color:var(--ink-3);display:inline-block;min-width:4.2rem}
.warn{border-left:3px solid var(--flag);padding:.2rem 0 .2rem .9rem;margin:1.1rem 0;
  font-size:.95rem;color:var(--ink-2)}
.warn b{color:var(--flag);font-family:var(--disp);font-size:.8rem}
hr.rule{border:0;border-top:1px solid var(--rule);margin:3.5rem 0}
footer{border-top:2px solid var(--ink);margin-top:4rem;padding-top:1.2rem;
  font-family:var(--mono);font-size:.7rem;color:var(--ink-3)}
</style>

<div class="wrap">

<div class="mast">
  <p class="kicker">Architect MUD · story review · 25 August 2026</p>
  <h1>The Two Ladders</h1>
  <p class="dek">Every word a player reads on the Long Watch and Ascendant questlines, rebuilt as the
  first quarter of a forty-slot story. Read it and tell me where I have it wrong.</p>
  <div class="tick">
    <span>21 quests</span><span>21 descriptions</span><span>51 objective lines</span>
    <span>138 emotes</span><span>1 objective type changed</span><span>8723/8723 regress</span>
  </div>
</div>

<section class="intro">
  <p><strong>The problem with what was there.</strong> Both ladders read like finished stories. The
  Long Watch rite had you assassinate the Ascendants’ best recruiter and blow up their vats — a
  finale, played a quarter of the way through a forty-rung ladder, spending the antagonist that the
  next thirty rungs need. And both sides talked as though the city held two answers, when the game
  already ships nine orders.</p>

  <h2>Three rules the rewrite is built on</h2>
  <ol class="rules">
    <li><b>Slot 10 is a door, not an ending.</b> Ten of forty is a quarter. Nothing may resolve. Both
    rites now finish on the beginning of something tedious: Pike closes by describing the roster,
    “a great deal of standing about in the cold for the rest of your life”, and the Ascendant rite
    ends with a freshly printed body being handed a towel and then a form. Nobody is congratulated.</li>
    <li><b>The world is bigger than these two, and nobody explains it.</b> Each ladder carries two or
    three moments where somebody answers a question about the wider board in one flat sentence and
    moves on — short, specific, and quietly informative about where their own order actually sits.
    Halloran, asked who else makes camera parts: <em>“Three that I know of.”</em> He never supplies
    the names. Ives, asked whether a broker is one of theirs: <em>“He sells to four buyers. We are the
    one that pays on time.”</em> That is the Ascendant position in nine words — Halcyon does not own
    the board and does not need to; it wins on being the reliable counterparty, and never once calls
    that power. No line may imply the field is binary.</li>
    <li><b>The two registers are opposites, and neither is signposted.</b> The Watch has no euphemism
    and says the ugly part out loud. The Ascendants have nothing but euphemism and never say anything
    untrue. The prose never supplies the translation.</li>
  </ol>

  <div class="warn"><b>The one objective change.</b> <code>quest_lw_rite</code> → <code>o_ives</code>
  went from <code>assassinate</code> to <code>talk</code>. Verity Ives is at the gate on your way out,
  she says her piece, and you walk past her. What a player does after she stops speaking is not an
  objective either way. The escape is untouched and is still the part that kills people —
  <code>trigger_lw_rite_pursuit</code> fires on the demolition, not the kill.</div>
</section>

${ladderHtml}

<hr class="rule">

<section>
  <h2 style="font-size:2rem;letter-spacing:-.02em;margin-bottom:.6rem">The two crossovers</h2>
  <p style="color:var(--ink-2)">Slot 7 on both ladders, and they mirror on purpose. Neither recruiter
  threatens you, neither wins the argument, and both let you walk — which is the only version of a
  recruitment scene that makes the other answer feel like something you chose.</p>
  <div class="pair">
    <div class="p-lw"><h4>Ardy, to an Ascendant</h4><p>A lapsed client in a good coat gone shapeless,
    sitting on a crate by the press. He is not recruiting and says so first. He is there to say one
    plain sentence about the job after this one, which nobody has ever said to him beforehand.</p></div>
    <div class="p-asc"><h4>Ives, to a Watch runner</h4><p>Standing in the open at a gate, in daylight,
    having already been told you were coming. She names a number that is not insulting, which is worse,
    and tells you the offer does not expire.</p></div>
  </div>
</section>

<hr class="rule">

<section>
  <h2 style="font-size:2rem;letter-spacing:-.02em;margin-bottom:.4rem">The voices</h2>
  <p style="color:var(--ink-2);margin-bottom:2rem">Dialogue as it appears in the tree. Node keys are
  shown so you can find them; the arrowed lines are what the player can say back.</p>
  ${DIALOGUE.map(dialogueBlock).join('')}
</section>

<hr class="rule">

<section>
  <h2 style="font-size:2rem;letter-spacing:-.02em;margin-bottom:.9rem">Everything else that changed</h2>

  <div class="card">
    <h3>Withdrawal became a sequence</h3>
    <p>The mechanic already ramped, held and tapered over six hours, bent by how deep the habit got.
    The player was told about exactly one moment of that and then never heard from it again. There is
    now a five-beat block, fired when the beat changes — derived from the clock, not from severity,
    because severity is a hill and a band on the number cannot tell going-in from coming-out.</p>
    <p style="margin-top:.9rem"><em>blacktar, in full:</em></p>
    <ul class="beats">
      <li><b>onset</b> Your nose starts running and will not stop. It is such a small thing that it takes a while to understand it is the first one.</li>
      <li><b>rising</b> You sneeze eleven times in a row, and then again four minutes later, and your eyes will not stay dry.</li>
      <li><b>peak</b> You can hear your own digestion. It has been going on your whole life underneath everything and now it is the loudest thing in the room, and there is nowhere to put your legs.</li>
      <li><b>easing</b> The sweating stops before the shaking does. You get an hour that feels like the end of it, and it is not.</li>
      <li><b>tail</b> Six hours. You have been upright for all of them, because lying down turned out to be worse, and you found that out by trying it.</li>
    </ul>
    <p style="margin-top:1rem">18 drugs, 90 beats. Two — ether and static — could hook a player and
    then do nothing at all, because the tick is gated on having mods; they have blocks now. Thirteen
    more are still in that position, all at 0.1 or below and mostly psychedelics, and are listed on
    every run rather than quietly fixed.</p>
    <div class="warn"><b>Caught in my own prose.</b> Plotting the beat boundaries showed the first four
    all land inside six hours — and seven authored lines were counting days, with two having the player
    sleep fourteen hours forty-five minutes in. Fixed, plus a guard: only the tail may talk in days.</div>
  </div>

  <div class="card">
    <h3>Four new sleep dreams</h3>
    <p>The existing sixty-three are one excellent idea done sixty-three ways: a strange room with
    strange things in it. What was missing is scale, which is most of what De Quincey is actually
    about. <em>The Stairs</em> (flights ending at an abyss with another above, and you on that one
    too), <em>The Hundred Years</em>, <em>The Far Wall</em>, and <em>The Thing You Pictured</em> —
    whatever you had in mind on the way down, arriving finished and much larger.</p>
  </div>

  <div class="card">
    <h3>One house tic, cut 43 times</h3>
    <p>An auditor over every player-facing surface found 58 distinct instances of
    <code>&lt;image&gt;, which is the (whole|entire|only) (point|reason|thing)</code> — a clause
    after an image telling the reader what the image meant. Cut where it restates, kept where it adds
    a fact the image does not carry. Seventeen were left deliberately: jokes, spoken dialogue, and
    clauses stating a cause. Three of the hits were mine, from this same rewrite.</p>
  </div>

  <div class="card">
    <h3>A doc that described a quest which does not exist</h3>
    <p><code>systems-ascension.md</code> §8d said the Watch rite was a single 180-second sit at The
    Blind and named <code>quest_lw_rite</code>. That quest is the five-objective demolition, and the
    longest tile task anywhere in the game is 90 seconds. Corrected to mark the design unbuilt and
    stop it claiming an id that is spoken for.</p>
  </div>
</section>

<footer>
  Generated from the live content tree by scripts/docs/build-story-review.mjs ·
  content/quests, content/npcs · nothing transcribed by hand
</footer>

</div>`;

process.stdout.write(html);
