// THE RACER BAY: a hand of cards at the counter, and the yard at the shed door.
//
// The fourth depot on the shell (depot-shell.js), the marina's shape (marina-panel.js) for racers:
//
//   THE COUNTER (in the pane) is where you choose: your racers as cards, owned or hired, then a card
//       to buy one and a card to hire one. A card is `podracer take <id>`: the yard lets it down off
//       the blocks in the shed door and seats you in it.
//   THE PAINT SHOP (the counter's third screen) and the bay's Paint tab are the spray booth: a
//       scheme, or your own two colours and a finish, shown on the racer before it is bought. In the
//       bay it is shown on the racer itself (podracer-view.js podracerPreview); at the counter, on its
//       card. Either way the one button sends `podracer paint`.
//   THE BAY (an overlay on the racer seat's glass) is the yard at the shed door: the pod, both
//       turbines, the cables and the tank, and one key to put all of it right. "Drive out" folds it;
//       "Put it away" runs it back onto the blocks. The server opens and closes it as the racer stops
//       in the door and leaves it (plugins/podracer/seat.js svcTick).
//
// ⚠ A SKIN OVER THE TEXT. Every button sends a verb a player could type and every number is one the
// log prints (plugins/podracer/lot.js racerLine), so on the log rung nobody is stuck.
// ⚠ AND IT IS DEALT AGAIN AFTER EVERY CHANGE; nothing here guesses what changed.

import { drawWireframe3D, themeColor } from './wireframe-plane.js';
import { paintVehicleCard, paintSlotCard, cardStyleFor, cardSeed, ensureCardStyles } from './vehicle-card.js';
import { podracerServiceHost, podracerPreview, podracerKitPreview, podracerFrame } from './podracer-view.js';
import { SHOTS } from './camera-tween.js';
import { openColorPicker, closeColorPicker } from './color-picker.js';
import { ensureDepotStyles, headHtml, jobsHtml, mountBay, setBayOpen, bayHtml, leaveHtml, bayChipHtml,
  statsHtml, partsHtml, meterHtml, btnHtml, armHolds, shellClick, clearViewModes, noteAct, notePush,
  esc, money, clamp01, readyHtml, pickClass, pickAttr, choiceHtml, takeDeploy } from './depot-shell.js';
import { garageBed } from './garage-ambience.js';
import { PODRACER_TYPES, PODRACER_KIT, KIT_TIERS, cleanKit, kitValue, kitShare, kitQuote, podracerTuned, podracerStats, podracerLook, podracerLivery } from './podracer-model.js';

const SCREENS = [['lot', 'Your racers', '⟰'], ['fit', 'Fitting shop', '⚙'], ['paint', 'Paint shop', '🎨'], ['dealer', 'For sale', '⊕'], ['rent', 'Hire', '⟲']];

// The dealer's bars, off the racer's own physics row (podracer-model.js), on a scale with room for
// faster racers than this one. No second table of figures.
// The fitting shop shows three more: how it holds its heat, how much the pod takes, the binder.
const ROWS = [['speed', 'Speed'], ['pull', 'Pull'], ['turn', 'Turn'], ['cable', 'Cable'], ['tank', 'Range']];
const FIT_ROWS = [...ROWS, ['heat', 'Cooling'], ['tough', 'Pod'], ['binder', 'Binder']];
const racerStats = (id, kit = null) => (PODRACER_TYPES[id] ? podracerStats(podracerTuned(id, kit)) : null);

let st = null;   // the counter
let sv = null;   // the bay overlay

export function isPodracerDepotActive() { return !!st; }

export function openPodracerDepot(msg = {}) {
  if (msg.service) return openPodracerBay(msg);
  const host = msg.mount || document.getElementById('area-content');
  if (!host) return;
  ensureDepotStyles();
  ensureCardStyles();
  ensurePodDepotStyles();
  const before = st?.data?.credits;
  // A push that names a racer you just bought or hired lands on the hand, where its key is.
  const tab = msg.fresh ? 'lot' : st?.tab || 'lot';
  if (!st) window.dispatchEvent(new Event('pane:claimed'));
  st = { host, data: msg, tab, onSend: msg.onSend || st?.onSend || null, paintId: st?.paintId || null, work: null, kitWork: null };
  draw();
  if (before != null) notePush(st.host.querySelector('.ds-counter'), before, msg.credits);
  garageBed('shed');
}

export function closePodracerDepot() {
  if (!st) return;
  stopWireframes();
  clearViewModes();
  if (st.host) st.host.innerHTML = '';
  st = null;
  garageBed(null);
  window.dispatchEvent(new Event('pane:released'));
}

const send = (cmd) => { try { (st?.onSend || sv?.onSend)?.(cmd); } catch { /* the pane can outlive the socket */ } };
const pct = (v) => Math.round(clamp01(v ?? 0) * 100);

// ── The counter ──────────────────────────────────────────────────────────────
function draw() {
  if (!st) return;
  const d = st.data || {};
  st.host.innerHTML = `<div class="ds-root ds-counter pdd-root">
    ${headHtml({ ico: '⟰', title: d.name || 'Racers', credits: d.credits, screens: SCREENS, screen: st.tab })}
    <div class="pdd-flag" aria-hidden="true"></div>
    ${(d.exits || []).length ? `<div class="pdd-exits"><span class="ds-dim">Leave</span>${d.exits.map((x) =>
      `<button class="ds-btn ghost" type="button" data-cmd="${esc(x.dir)}">${esc(x.dir)} · ${esc(x.name)}</button>`).join('')}</div>` : ''}
    <div class="ds-body">${st.tab === 'dealer' ? dealerBody(d) : st.tab === 'rent' ? rentBody(d) : st.tab === 'paint' ? paintShopBody(d) : st.tab === 'fit' ? fitShopBody(d) : lotBody(d)}</div>
  </div>`;
  const root = st.host.querySelector('.pdd-root');
  root.addEventListener('click', onClick);
  armHolds(root, send);
  spinWireframes();
  requestAnimationFrame(paintCards);
}

function onClick(e) {
  if (shellClick(e, {
    screen: (s) => { if (st) { st.tab = s; draw(); } },
    close: () => { const s = st?.onSend; closePodracerDepot(); try { s?.('look'); } catch { /* socket gone */ } },
  })) return;
  const tab = e.target.closest?.('[data-tab]');
  if (tab && st) { st.tab = tab.dataset.tab; draw(); return; }
  const pick = e.target.closest?.('[data-pr]');
  if (pick && st) { st.paintId = pick.dataset.pr; st.work = null; st.kitWork = null; draw(); return; }
  if (fitClick(e, st, draw)) return;
  if (paintClick(e, st, draw)) return;
  const b = e.target.closest?.('[data-cmd]');
  if (b && !b.disabled && b.dataset.cmd) { noteAct(b); send(b.dataset.cmd); }
}

// One card per racer, owned or hired, then Buy and Hire. The card is the button that seats you,
// `podracer take`, when the racer is up on the blocks here; one somewhere else is shown faded.
function lotBody(d) {
  const fleet = d.fleet || [];
  const cards = fleet.map((r) => {
    const wrecked = r.hull <= 0 || r.eng.every((e) => e <= 0);
    const torn = r.binder === false;
    const ready = r.inYard && !r.aboard && !wrecked && !torn && r.fuel > 0;
    const badge = r.rental ? `<span class="vc-badge hired">HIRED · ${esc(r.rental.leftText)}</span>` : '<span class="vc-badge owned">OWNED</span>';
    const cut = r.cables.filter((c) => !c).length;
    const sub = r.aboard ? 'you are sitting in it'
      : !r.inYard ? (torn ? 'binder torn, stranded at ' + esc(r.where) : esc(r.where))
      : torn ? 'binder torn out: the yard can weld it'
      : wrecked ? 'needs the yard before it goes anywhere'
      : r.fuel <= 0 ? 'dry' : `pod ${pct(r.hull)}% · fuel ${pct(r.fuel)}%${cut ? ` · ${cut} cable${cut > 1 ? 's' : ''} cut` : ''}`;
    const cmd = `podracer take ${r.id}`;
    // Out on the waste, the yard can fetch it on the flatbed: the one way home for a torn binder.
    const fetch = !r.inYard && !r.aboard
      ? btnHtml(`Fetch it · ${money(r.recoverFee || 0)}`, { cmd: `podracer recover ${r.id}`, ico: '🚚', cls: 'vc-mini' + (torn ? ' primary' : ''),
        attrs: 'title="The yard sends the flatbed out and brings it back to the bay"' })
      : '';
    const acts = fetch || (r.inYard && !r.aboard ? [
      r.quote.total ? btnHtml(`Service · ${money(r.quote.total)}`, { cmd: `podracer service ${r.id}`, cls: 'vc-mini' }) : '',
      r.rental ? '' : `<button class="vc-mini" type="button" data-fitgo="${esc(r.id)}" title="The fitting shop: parts and looks">⚙ Fit</button>`,
      r.rental ? '' : `<button class="vc-mini" type="button" data-paintgo="${esc(r.id)}" title="The spray booth">🎨 Paint</button>`,
    ].filter(Boolean).join('') : '');
    const inHand = r.inYard && !r.aboard;
    const why = ready ? '' : sub;
    const choice = inHand ? choiceHtml({
      deploy: ready ? { cmd, title: 'Climb in and drive straight out' } : { why },
      maint: ready ? { cmd, title: 'Climb in with the shed opened up around it' } : { why },
      sell: r.rental ? { hold: `podracer return ${r.id}`, title: 'Hand it back early, no refund' } : { hold: `podracer sell ${r.id}`, title: 'The yard buys it back' },
      sellLabel: r.rental ? 'Hand it back' : `Sell · ${money(r.resale)}`,
    }) : '';
    return `<div class="vc-wrap${r.inYard ? '' : ' away'}${r.id === d.fresh ? ' fresh' : ''}${pickClass(r.id)}">
      <button class="vc-card ${cardStyleFor(r.id)}" ${inHand ? pickAttr(r.id) : 'disabled'}
          aria-label="${esc(`${r.name}, ${r.rental ? 'hired' : 'owned'}${inHand ? ': pick' : ''}`)}"
          title="${inHand ? 'Pick it: deploy, maintenance or sell' : esc(sub)}">
        <canvas class="vc-cv" data-card="${esc(r.id)}" aria-hidden="true"></canvas>
        ${badge}
        <span class="vc-plate"><b>${esc(r.name)}</b><span class="vc-sub">${sub}</span>
          <span class="vc-bar" title="pod ${pct(r.hull)}%"><i class="${r.hull < 0.3 ? 'bad' : r.hull < 0.6 ? 'warn' : 'ok'}" style="width:${pct(r.hull)}%"></i></span></span>
      </button>
      ${choice}${acts ? `<div class="vc-acts">${acts}</div>` : ''}
    </div>`;
  }).join('');
  const slot = (tab, label, sub) => `<div class="vc-wrap"><button class="vc-card slot" data-tab="${tab}" aria-label="${label}">
      <canvas class="vc-cv" data-slot="${tab}" aria-hidden="true"></canvas>
      <span class="vc-plate"><b>${label}</b><span class="vc-sub">${sub}</span></span></button></div>`;
  // The racer you just bought or hired, and one key into it: the card's own verb.
  const nu = fleet.find((r) => r.id === d.fresh && r.inYard && !r.aboard && r.fuel > 0 && r.hull > 0);
  const ready = nu ? readyHtml({ title: nu.rental ? `${nu.name}, yours for ${nu.rental.leftText}.` : `The ${nu.name} is yours.`,
    sub: 'Up on the blocks, both turbines sound.', label: 'Climb in', cmd: `podracer take ${nu.id}` }) : '';
  return `${ready}${fleet.length ? '' : '<p class="ds-hint">Nothing of yours on the blocks. Buy a racer, or hire one for the afternoon.</p>'}
    <div class="vc-hand">${cards}${slot('dealer', 'Buy a racer', `${(d.stock || []).length} in the bay`)}${slot('rent', 'Hire a racer', d.hasRental ? 'one out already' : 'for two hours')}</div>`;
}

// ── The spray booth ──────────────────────────────────────────────────────────
// A working livery (`ctx.work`) over the racer's own: a scheme sets it whole, a colour chip or a
// finish changes one part of it. The paint button sends what it holds, as a scheme's id when it is
// one and as base=/trim=/finish= when it is not; nothing is spent until then.
const FACTORY_PAINT = { base: '#aa1a14', trim: '#eec84c', finish: 'candy' };
// The inside's choices as the booth shows them (the cockpit's own materials are in
// client/shared/interior-podracer.js INSIDE; these are only the dots on the buttons).
const INSIDE_SHOW = {
  leather: { oxblood: '#601c18', tan: '#966034', black: '#1c1a1a', cream: '#d6c8aa', green: '#204830', blue: '#243468' },
  strip: { blue: '#46beff', red: '#ff4034', green: '#50ff8c', amber: '#ffb028', violet: '#b060ff', white: '#ecf2ff' },
  dash: { carbon: '#1e2026', gunmetal: '#343840', cream: '#cec6b2', billet: '#aab0ba' },
};
const INSIDE_LABEL = { leather: 'Leather', strip: 'Lights', dash: 'Dash' };
const outOf = (l) => (l && l.base ? { base: l.base, trim: l.trim, finish: l.finish } : null);
const sameOut = (a, b) => (a?.base || null) === (b?.base || null) && (a?.trim || null) === (b?.trim || null) && (a?.finish || null) === (b?.finish || null);
const sameIn = (a, b) => JSON.stringify(a?.inside || {}) === JSON.stringify(b?.inside || {});
const sameLiv = (a, b) => sameOut(a, b) && sameIn(a, b);
const withInside = (out, inside) => (out || inside ? { ...(out || {}), ...(inside ? { inside } : {}) } : null);
function schemeIdOf(d, l) {
  if (!l || !l.base) return 'factory';
  const m = (d.schemes || []).find((x) => x.livery && sameOut(x.livery, l));
  return m ? m.id : null;
}
// The verb for what the booth holds: the outside only if it changed (a scheme's word when it is
// one), and each inside choice that changed.
function paintCmdOf(d, r, work, own) {
  const t = [];
  if (!sameOut(work, own)) { const id = schemeIdOf(d, work); t.push(id || `base=${work.base} trim=${work.trim} finish=${work.finish || 'gloss'}`); }
  for (const k of ['leather', 'strip', 'dash']) if ((work?.inside?.[k] || null) !== (own?.inside?.[k] || null) && work?.inside?.[k]) t.push(`${k}=${work.inside[k]}`);
  return `podracer paint ${r.id} ${t.join(' ')}`;
}
// The booth as { main, till }: the bay pins the till under its page; the counter runs them together.
function paintPanelHtml(d, r, ctx, where) {
  const own = r.livery || null, work = ctx.work !== undefined && ctx.work !== null ? ctx.work : own;
  const cur = work && work.base ? work : (r.factory || FACTORY_PAINT);
  const sid = schemeIdOf(d, work);
  const sw = (d.schemes || []).map((x) => {
    const b = x.livery?.base || (r.factory || FACTORY_PAINT).base, t = x.livery?.trim || (r.factory || FACTORY_PAINT).trim;
    return `<button class="pdd-swatch${sid === x.id ? ' on' : ''}${schemeIdOf(d, own) === x.id ? ' mine' : ''}" type="button" data-sch="${esc(x.id)}" title="${esc(x.label)}">
      <i style="background:linear-gradient(135deg, ${b} 0 58%, ${t} 58% 100%)"></i><span>${esc(x.label)}</span></button>`;
  }).join('');
  const chip = (k, label) => `<button class="pdd-chip" type="button" data-cp="${k}" title="Pick the ${label} colour"><i style="background:${cur[k]}"></i>${label}<span class="ds-dim">${cur[k]}</span></button>`;
  const fin = (d.finishes || []).map((f) => `<button class="pdd-fin${(cur.finish || 'gloss') === f ? ' on' : ''}" type="button" data-fin="${f}">${f}</button>`).join('');
  const ins = (k) => (d.inside?.[k] || Object.keys(INSIDE_SHOW[k])).map((id, i) => {
    const on = (work?.inside?.[k] || (i === 0 ? id : null)) === id;
    return `<button class="pdd-chip${on ? ' on' : ''}" type="button" data-ins="${k}:${esc(id)}"><i style="background:${INSIDE_SHOW[k][id] || '#888'}${k === 'strip' ? ';box-shadow:0 0 8px ' + (INSIDE_SHOW[k][id] || '#888') : ''}"></i>${esc(id)}</button>`;
  }).join('');
  const outDirty = !sameOut(work, own), dirty = outDirty || !sameIn(work, own);
  const price = outDirty ? (work?.base ? r.paintPrice : Math.round(r.paintPrice / 2)) : r.insidePrice;
  const main = `<div class="ds-panel"><div class="ds-panel-head"><b>Schemes</b><span class="ds-dim">${where}</span></div>
      <div class="pdd-swatches">${sw}</div></div>
    <div class="ds-panel"><div class="ds-panel-head"><b>Your own</b><span class="ds-dim">the pod and the trim; the metal stays metal</span></div>
      <div class="pdd-chips">${chip('base', 'Pod')}${chip('trim', 'Trim')}</div>
      <div class="pdd-fins">${fin}</div></div>
    <div class="ds-panel"><div class="ds-panel-head"><b>Inside</b><span class="ds-dim">${ctx === sv ? 'shown in the pod now' : 'seen from the seat'} · ${money(r.insidePrice)} on its own</span></div>
      ${['leather', 'strip', 'dash'].map((k) => `<div class="pdd-insrow"><span class="ds-dim">${INSIDE_LABEL[k]}</span><div class="pdd-chips">${ins(k)}</div></div>`).join('')}</div>`;
  const till = `<div class="ds-acts">${btnHtml(`${outDirty ? 'Spray it' : 'Fit it out'} · ${money(price)}`, { cmd: dirty ? paintCmdOf(d, r, work, own) : '', ico: '🎨', cls: 'primary', disabled: !dirty, why: dirty ? '' : 'Nothing changed' })}
      <button class="ds-btn ghost" type="button" data-unpaint="1" ${dirty ? '' : 'disabled'}>Put it back</button></div>`;
  return { main, till };
}
// Clicks inside a booth panel: scheme, colour chip, finish, put back. Changes `ctx.work` and redraws.
function paintClick(e, ctx, redraw) {
  const sch = e.target.closest?.('[data-sch]');
  const held = () => (ctx.work !== undefined && ctx.work !== null ? ctx.work : paintRacerOf(ctx)?.livery || null);
  if (sch) { const x = (ctx.data?.schemes || []).find((y) => y.id === sch.dataset.sch); if (x) ctx.work = withInside(x.livery ? { ...x.livery } : null, held()?.inside || null); redraw(); return true; }
  const insb = e.target.closest?.('[data-ins]');
  if (insb) { const [k, v] = insb.dataset.ins.split(':'); const h = held(); ctx.work = withInside(outOf(h), { ...(h?.inside || {}), [k]: v }); redraw(); return true; }
  const fin = e.target.closest?.('[data-fin]');
  const fac = () => paintRacerOf(ctx)?.factory || FACTORY_PAINT;
  if (fin) { const h = held(); ctx.work = withInside({ ...(outOf(h) || fac()), finish: fin.dataset.fin }, h?.inside || null); redraw(); return true; }
  const cp = e.target.closest?.('[data-cp]');
  if (cp) {
    const k = cp.dataset.cp, base = outOf(held()) || fac();
    openColorPicker({ key: 'pdd:' + k, anchor: cp, value: base[k], title: k === 'base' ? 'the pod' : 'the trim',
      // Every drag frame: the chip and the preview only. A redraw would pull the picker's anchor out
      // from under it; the panel is dealt again once, when the picker closes.
      onChange: (hex) => {
        const h = held();
        ctx.work = withInside({ ...(outOf(h) || fac()), [k]: hex }, h?.inside || null);
        const dot = cp.querySelector('i'), txt = cp.querySelector('span');
        if (dot) dot.style.background = hex;
        if (txt) txt.textContent = hex;
        if (ctx === sv) podracerPreview(ctx.work); else requestAnimationFrame(paintCards);
      },
      onClose: () => redraw() });
    return true;
  }
  if (e.target.closest?.('[data-unpaint]')) { ctx.work = null; closeColorPicker?.(); redraw(); return true; }
  const go = e.target.closest?.('[data-paintgo]');
  if (go && ctx === st) { st.tab = 'paint'; st.paintId = go.dataset.paintgo; st.work = null; draw(); return true; }
  return false;
}
// The racer the booth is working on: the bay's own, or the one picked at the counter.
function paintRacerOf(ctx) {
  const fleet = ctx.data?.fleet || [];
  if (ctx === sv) return fleet.find((x) => x.id === ctx.data.serviceId) || null;
  const here = fleet.filter((r) => r.inYard && !r.aboard && !r.rental);
  return here.find((r) => r.id === ctx.paintId) || here[0] || null;
}
function paintShopBody(d) {
  const mine = (d.fleet || []).filter((r) => !r.rental);
  if (!mine.length) return '<p class="ds-hint">You own no racer to paint. A hire goes back the colour it came.</p>';
  const r = paintRacerOf(st);
  // Every racer you own, as a pick: the ones up on the blocks here can be done now, the rest say why.
  const why = (x) => (x.aboard ? 'you are sitting in it: the bay\'s Paint tab' : !x.inYard ? 'out at ' + x.where : '');
  const pick = `<div class="pdd-picks">${mine.map((x) => {
    const w = why(x);
    return `<button class="pdd-fin${r && x.id === r.id ? ' on' : ''}" type="button" ${w ? 'disabled' : `data-pr="${esc(x.id)}"`} title="${esc(w || 'Paint this one')}">${esc(x.name)}${w ? ' · ' + esc(w) : ''}</button>`;
  }).join('')}</div>`;
  if (!r) {
    const away = mine.filter((x) => !x.inYard && !x.aboard);
    return pick + `<p class="ds-hint">None of yours is up on the blocks here. The booth works on a racer in the bay: fetch one in, or bring yours into the shed door and use the bay's Paint tab.</p>`
      + (away.length ? `<div class="ds-acts">${away.map((x) => btnHtml(`Fetch the ${x.name} · ${money(x.recoverFee || 0)}`, { cmd: `podracer recover ${x.id}`, ico: '🚚' })).join('')}</div>` : '');
  }
  return `${pick}<div class="pdd-booth">
      <div class="vc-card ${cardStyleFor(r.id)} static pdd-boothcard"><canvas class="vc-cv" data-booth="${esc(r.id)}" aria-hidden="true"></canvas>
        <span class="vc-plate"><b>${esc(r.name)}</b><span class="vc-sub">as it would come out of the booth</span></span></div>
      <div class="pdd-boothctl">${joined(paintPanelHtml(d, r, st, 'shown on the card'))}</div>
    </div>`;
}

// ── The fitting shop ─────────────────────────────────────────────────────────
// A working kit (`ctx.kitWork`) over the racer's own: each button sets one slot of it, the figures
// show the racer with it fitted against the racer as it stands, and the one button sends
// `podracer fit` with the slots that changed. Nothing is spent until then. The bill is the yard's
// own sum (podracer-model.js kitQuote), so it is the number the verb charges.
const KIT_GROUPS = [['tiers', 'Performance', 'each part from stock to pro'], ['choice', 'Setup', 'no better or worse, only different'], ['look', 'Looks', 'the outside only']];
const kitOf = (ctx, r) => cleanKit(ctx.kitWork != null ? ctx.kitWork : r.kit);
const rgbCss = (c) => (Array.isArray(c) ? `rgb(${c.join(',')})` : c);
function fitCmdOf(r, own, work) {
  const t = Object.keys(PODRACER_KIT).filter((k) => kitValue(own, k) !== kitValue(work, k)).map((k) => `${k}=${kitValue(work, k)}`);
  return `podracer fit ${r.id} ${t.join(' ')}`;
}
// The parts are a garage's parts menu (depot-shell.js partsHtml): the three groups, the open group's
// slots with what each has now, and the open slot's options as cards, so only one slot's worth of
// buttons is ever out. `ctx.kitGroup` and `ctx.kitSlot` say which are open.
const kitWord = (s, v) => (s.kind === 'tiers' ? KIT_TIERS[v] : s.choices[v]?.label || String(v));
// The fitting shop as { figures, main, till }: the bay puts the figures in its rail beside the racer
// and pins the till under its page; the counter runs all three together.
function fitPanelHtml(d, r, ctx, where) {
  const price = PODRACER_TYPES[r.typeId]?.price || 0;
  const own = cleanKit(r.kit), work = kitOf(ctx, r), q = kitQuote(price, own, work);
  const pNow = podracerTuned(r.typeId, own), pNext = podracerTuned(r.typeId, work);
  const group = KIT_GROUPS.some(([k]) => k === ctx.kitGroup) ? ctx.kitGroup : 'tiers';
  const inGroup = Object.entries(PODRACER_KIT).filter(([, s]) => s.kind === group);
  const slot = inGroup.some(([id]) => id === ctx.kitSlot) ? ctx.kitSlot : inGroup[0]?.[0];
  const moved = (id) => kitValue(work, id) !== kitValue(own, id);
  const s = PODRACER_KIT[slot];
  const cur = s ? kitValue(work, slot) : null, mine = s ? kitValue(own, slot) : null;
  const options = !s ? [] : (s.kind === 'tiers' ? KIT_TIERS.map((w, i) => [i, w, s.cost[i], '', null])
    : Object.entries(s.choices).map(([cid, c]) => [cid, c.label, c.cost, c.blurb || '', c.rgb || null]))
    .map(([v, label, cost, blurb, rgb]) => ({
      label, blurb: [blurb, cost ? `${money(cost * price)} in all` : ''].filter(Boolean).join(' · '),
      on: cur === v, mine: mine === v, dot: rgb ? rgbCss(rgb) : '',
      price: cost ? money(cost * price) : 'factory', attrs: `data-kit="${slot}:${v}"`,
    }));
  // What the open slot does: a performance part's own line, or the picked choice's.
  const tip = s ? (s.kind === 'tiers' ? s.blurb : s.choices[cur]?.blurb) || '' : '';
  const parts = partsHtml({
    groups: KIT_GROUPS.map(([k, head]) => {
      const n = Object.keys(PODRACER_KIT).filter((id) => PODRACER_KIT[id].kind === k && moved(id)).length;
      return { id: k, label: n ? `${head} · ${n}` : head };
    }),
    group,
    slots: inGroup.map(([id, x]) => ({ id, label: x.label, value: kitWord(x, kitValue(work, id)), changed: moved(id), tip: id === slot ? tip : '' })),
    slot,
    options,
  });
  const sub = KIT_GROUPS.find(([k]) => k === group)?.[2] || '';
  const main = `<div class="ds-panel-head pdd-parthead"><b>Parts</b><span class="ds-dim">${sub}</span></div>${parts}`;
  const dirty = q.slots > 0;
  const bill = !dirty ? 'Nothing changed'
    : `parts ${money(q.parts)} · labour ${money(q.labour)}${q.back ? ` · less ${money(q.back)} for the old parts` : ''}`;
  const label = !dirty ? 'Fit it' : q.total >= 0 ? `Fit it · ${money(q.total)}` : `Fit it · ${money(-q.total)} back`;
  const short = dirty && q.total > Number(d.credits || 0);
  const top0 = Math.round(pNow.topSpeed), top1 = Math.round(pNext.topSpeed);
  const figures = `<div class="ds-panel"><div class="ds-panel-head"><b>The figures</b><span class="ds-dim">${where}</span></div>
      ${statsHtml(FIT_ROWS, podracerStats(pNext), podracerStats(pNow))}
      <div class="ds-dim ds-small">Flat out <b>${top0}${top1 !== top0 ? ' → ' + top1 : ''} mph</b> launched · boost ×${pNext.boost.toFixed(1)} · cables ${Math.round(pNext.cableLen * 42)} m</div></div>`;
  const till = `<div class="ds-dim ds-small pdd-bill">${bill}</div>
    <div class="ds-acts">${btnHtml(label, { cmd: dirty && !short ? fitCmdOf(r, own, work) : '', ico: '⚙', cls: 'primary', disabled: !dirty || short, why: !dirty ? 'Nothing changed' : short ? "You can't afford it" : '' })}
      <button class="ds-btn ghost" type="button" data-unkit="1" ${ctx.kitWork != null ? '' : 'disabled'}>Put it back</button>
      <button class="ds-btn ghost" type="button" data-kitstock="1" ${Object.keys(work).length ? '' : 'disabled'} title="Every part back to the factory's; the yard gives part exchange for what comes off">Strip to stock</button></div>`;
  return { figures, main, till };
}
const joined = (p) => [p.figures, p.main, p.till].filter(Boolean).join('');
// Clicks inside a fitting panel: a group, a slot, a part, put back, strip. Changes the open group and
// slot or `ctx.kitWork`, and redraws.
function fitClick(e, ctx, redraw) {
  const g = e.target.closest?.('[data-ds-group]');
  if (g) { ctx.kitGroup = g.dataset.dsGroup; ctx.kitSlot = null; redraw(); return true; }
  const sl = e.target.closest?.('[data-ds-slot]');
  if (sl) { ctx.kitSlot = sl.dataset.dsSlot; redraw(); return true; }
  const r = paintRacerOf(ctx);
  const kb = e.target.closest?.('[data-kit]');
  if (kb && r) {
    const [k, v] = kb.dataset.kit.split(':');
    ctx.kitWork = cleanKit({ ...kitOf(ctx, r), [k]: PODRACER_KIT[k]?.kind === 'tiers' ? +v : v });
    if (ctx === sv) podracerKitPreview(ctx.kitWork);
    redraw(); return true;
  }
  if (e.target.closest?.('[data-unkit]')) { ctx.kitWork = null; if (ctx === sv) podracerKitPreview(null); redraw(); return true; }
  if (e.target.closest?.('[data-kitstock]')) { ctx.kitWork = {}; if (ctx === sv) podracerKitPreview({}); redraw(); return true; }
  const go = e.target.closest?.('[data-fitgo]');
  if (go && ctx === st) { st.tab = 'fit'; st.paintId = go.dataset.fitgo; st.kitWork = null; draw(); return true; }
  return false;
}
function fitShopBody(d) {
  const mine = (d.fleet || []).filter((r) => !r.rental);
  if (!mine.length) return '<p class="ds-hint">You own no racer to fit. The yard does not fit parts to its own hire stock.</p>';
  const r = paintRacerOf(st);
  const why = (x) => (x.aboard ? "you are sitting in it: the bay's Fit tab" : !x.inYard ? 'out at ' + x.where : '');
  const pick = `<div class="pdd-picks">${mine.map((x) => {
    const w = why(x);
    return `<button class="pdd-fin${r && x.id === r.id ? ' on' : ''}" type="button" ${w ? 'disabled' : `data-pr="${esc(x.id)}"`} title="${esc(w || 'Fit this one')}">${esc(x.name)}${w ? ' · ' + esc(w) : ''}</button>`;
  }).join('')}</div>`;
  if (!r) return pick + "<p class=\"ds-hint\">None of yours is up on the blocks here. The fitting shop works on a racer in the bay: fetch one in, or bring yours into the shed door and use the bay's Fit tab.</p>";
  return `${pick}<div class="pdd-booth">
      <div class="vc-card ${cardStyleFor(r.id)} static pdd-boothcard"><canvas class="vc-cv" data-fitcard="${esc(r.id)}" aria-hidden="true"></canvas>
        <span class="vc-plate"><b>${esc(r.name)}</b><span class="vc-sub">as it would come off the stands</span></span></div>
      <div class="pdd-boothctl">${joined(fitPanelHtml(d, r, st, 'with the parts you have picked'))}</div>
    </div>`;
}

function rentBody(d) {
  const cards = (d.rentStock || []).map((t) => {
    const why = d.hasRental ? 'You already have one out on hire' : t.afford ? '' : "You can't afford it";
    return `<div class="vc-wrap">
      <div class="vc-card ${cardStyleFor('hire:' + t.id)} static">
        <canvas class="vc-cv" data-rent="${esc(t.id)}" aria-hidden="true"></canvas>
        <span class="vc-badge hired">FOR HIRE</span>
        <span class="vc-plate"><b>${esc(t.name)}</b><span class="vc-sub">${t.hours} hours · tank full</span></span>
      </div>
      <div class="vc-acts">${btnHtml(`Hire · ${money(t.fee)}`, { cmd: `podracer hire ${t.id}`, cls: 'primary', disabled: !!why, why })}</div>
    </div>`;
  }).join('');
  return `<p class="ds-hint">A hire comes off the blocks fuelled and sound, and goes back on its own when the time is up. One at a time.</p>
    <div class="vc-hand">${cards}</div>`;
}

function dealerBody(d) {
  const afford = Number(d.credits || 0);
  return `<div class="pdd-lots">${(d.stock || []).map((t) => `<div class="ds-panel pdd-lot">
      <div class="ds-panel-head"><b>${esc(t.name)}</b>
        ${btnHtml(`Buy · ${money(t.price)}`, { cmd: `podracer buy ${t.id}`, cls: 'primary', disabled: t.price > afford, why: t.price > afford ? "You can't afford it" : '' })}</div>
      <canvas class="pdd-wf" data-wf-cls="podracer" data-wf-variant="${esc(t.id)}" aria-label="${esc(t.name)}, schematic"></canvas>
      <p class="pdd-blurb ds-dim">${esc(t.blurb || '')}</p>
      ${statsHtml(ROWS, racerStats(t.id))}
      <div class="ds-dim ds-small">Off the blocks: <b>pod sound</b> · <b>turbines true</b> · <b>cables spliced</b> · <b>tank full</b></div>
    </div>`).join('') || '<p class="ds-hint">The bay is empty.</p>'}</div>`;
}

// ── The cards, painted, once per draw ────────────────────────────────────────
// A racer on a card wears its kit: the bolt-ons on their mesh channels, the casing in its livery.
const cardLook = (livery, kit) => { const l = podracerLivery(livery, kit); return { ...(l ? { livery: l } : {}), anim: podracerLook(kit).anim }; };
function paintCards() {
  if (!st) return;
  const fleet = st.data?.fleet || [];
  for (const cv of st.host.querySelectorAll('canvas[data-card]')) {
    const r = fleet.find((x) => x.id === cv.dataset.card);
    if (!r) continue;
    paintVehicleCard(cv, { style: cardStyleFor(r.id), seed: cardSeed(r.id), dim: !r.inYard,
      v: { cls: 'podracer', variant: r.typeId, yaw: 0.7, fit: 2.1, elev: 0.3, ...cardLook(r.livery, r.kit) } });
  }
  for (const cv of st.host.querySelectorAll('canvas[data-booth]')) {
    const r = fleet.find((x) => x.id === cv.dataset.booth);
    if (!r) continue;
    const l = st.work !== undefined && st.work !== null ? st.work : r.livery;
    paintVehicleCard(cv, { style: cardStyleFor(r.id), seed: cardSeed(r.id), v: { cls: 'podracer', variant: r.typeId, yaw: 0.9, fit: 2.0, elev: 0.28, ...cardLook(l, r.kit) } });
  }
  // The fitting shop's card: seen from behind, where the kit's pipes and fins are.
  for (const cv of st.host.querySelectorAll('canvas[data-fitcard]')) {
    const r = fleet.find((x) => x.id === cv.dataset.fitcard);
    if (!r) continue;
    paintVehicleCard(cv, { style: cardStyleFor(r.id), seed: cardSeed(r.id), v: { cls: 'podracer', variant: r.typeId, yaw: 2.4, fit: 2.0, elev: 0.28, ...cardLook(r.livery, kitOf(st, r)) } });
  }
  for (const cv of st.host.querySelectorAll('canvas[data-rent]')) {
    paintVehicleCard(cv, { style: cardStyleFor('hire:' + cv.dataset.rent), seed: cardSeed('hire:' + cv.dataset.rent),
      v: { cls: 'podracer', variant: cv.dataset.rent, yaw: 0.7, fit: 2.1, elev: 0.3 } });
  }
  for (const cv of st.host.querySelectorAll('canvas[data-slot]')) {
    const buy = cv.dataset.slot === 'dealer';
    paintSlotCard(cv, { style: buy ? 'showroom' : 'sunburst', seed: buy ? 5 : 9, glyph: buy ? '+' : '⟲' });
  }
}

let spinRaf = 0;
function stopWireframes() { if (spinRaf) { cancelAnimationFrame(spinRaf); spinRaf = 0; } }
function spinWireframes() {
  stopWireframes();
  if (!st || st.tab !== 'dealer') return;
  const accent = themeColor('--accent', '#ffb070');
  const loop = () => {
    const cards = st?.host?.querySelectorAll?.('.pdd-wf');
    if (!cards || !cards.length) { spinRaf = 0; return; }
    const yaw = performance.now() / 2600;
    for (const cv of cards) {
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
      const ctx = cv.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWireframe3D(ctx, { cls: 'podracer', variant: cv.dataset.wfVariant || '', w: r.width, h: r.height, accent, yaw, fill: 0.94 });
    }
    spinRaf = requestAnimationFrame(loop);
  };
  spinRaf = requestAnimationFrame(loop);
}

// ── The bay overlay, on the racer seat's glass ───────────────────────────────
export function openPodracerBay(msg) {
  ensureDepotStyles();
  ensurePodDepotStyles();
  const host = podracerServiceHost();
  if (!host) return;
  const was = sv;
  sv = { data: msg, onSend: was?.onSend || msg.onSend || null, open: was ? was.open : !takeDeploy(), tab: was?.tab || 'service', work: null, kitWork: null,
    kitGroup: was?.kitGroup || null, kitSlot: was?.kitSlot || null, shot: was?.shot || null };
  garageBed('shed');
  drawBay();
  if (was) notePush(document.getElementById('pdd-bay'), was.data?.credits, msg.credits);
}
export function closePodracerBay() {
  if (!sv) return;
  podracerPreview(null);
  podracerKitPreview(null);
  podracerFrame(null);
  document.getElementById('pdd-bay')?.remove();
  garageBed(null);
  sv = null;
}

function drawBay() {
  if (!sv) return;
  const host = podracerServiceHost();
  if (!host) return;
  const el = mountBay(host, 'pdd-bay', { click: onBayClick });
  setBayOpen(el, sv.open);
  const d = sv.data;
  const r = (d.fleet || []).find((x) => x.id === d.serviceId) || null;
  // Folded, the driver has the camera back; opened again, the shot is taken again.
  if (!sv.open) { if (sv.shot) { podracerFrame(null); sv.shot = null; } el.innerHTML = bayChipHtml('⟰ the shed door'); return; }
  // A truck shed keeps racers and does nothing else to them (`sells` false): the way in, the way
  // out, and where the work is done.
  if (d.sells === false) {
    podracerPreview(null);
    el.innerHTML = bayHtml({
      ico: '⟰', title: r?.name || 'the racer', sub: d.hereName || 'the shed door', credits: d.credits,
      actions: btnHtml('Put it away', { cmd: 'podevent park', ico: '⟰', attrs: 'title="Leave it in the shed and climb out (Esc)"' }) + leaveHtml('Drive out'),
      jobs: '', body: '<p class="ds-hint">This shed keeps racers. Service and paint are done at the racer bay at the Deadleg.</p>',
      foot: 'Put it away and it stays here until you come back for it. Open the levers and it leaves the door.',
    });
    armHolds(el, send);
    return;
  }
  const tab = (sv.tab === 'paint' || sv.tab === 'fit') && r && !r.rental ? sv.tab : 'service';
  const fitted = r ? Object.keys(cleanKit(r.kit)).length : 0;
  const jobs = r ? jobsHtml([{ id: 'service', label: 'Service', ico: '🔧', ...jobState(r) },
    ...(r.rental ? [] : [{ id: 'fit', label: 'Fit', ico: '⚙', sub: fitted ? `${fitted} part${fitted > 1 ? 's' : ''} on` : 'factory spec', tone: 'ok' },
      { id: 'paint', label: 'Paint', ico: '🎨', sub: r.scheme === 'custom' ? 'your own' : ((d.schemes || []).find((x) => x.id === r.scheme)?.label || ''), tone: 'ok' }])], tab, 'data-svtab') : '';
  // The booth shows its working paint, and the fitting shop its working kit, on the racer you are
  // sitting in; any other tab takes them off.
  podracerPreview(tab === 'paint' && sv.work ? sv.work : null);
  podracerKitPreview(tab === 'fit' && sv.kitWork ? sv.kitWork : null);
  // The camera goes to what the tab works on: the showroom 3/4 for the service, the back of it for
  // the parts (the pipes, the fins, the turbines' tails), the flank for the paint.
  const shot = { service: 'quarter', fit: 'rear', paint: 'side' }[tab];
  if (shot !== sv.shot) { podracerFrame(SHOTS[shot], sv.shot ? 700 : 900); sv.shot = shot; }
  const page = !r ? { main: '<p class="ds-hint">It is not on the yard\'s books.</p>' }
    : tab === 'paint' ? paintPanelHtml(d, r, sv, 'shown on it now')
    : tab === 'fit' ? fitPanelHtml(d, r, sv, 'shown on it now')
    : { main: `<div class="ds-panel">
        <div class="ds-panel-head"><b>The racer</b><span class="ds-dim">${esc(r.typeName)}</span></div>
        ${meterHtml('pod', r.hull)}${meterHtml('left turbine', r.eng[0])}${meterHtml('right turbine', r.eng[1])}${meterHtml('tank', r.fuel)}
        <div class="ds-dim ds-small">Cables: ${r.cables.map((c, i) => `${i ? 'right' : 'left'} ${c ? 'whole' : '<b>cut</b>'}`).join(', ')} · Binder: ${r.binder === false ? '<b>torn out</b>' : 'holding'}</div>
      </div>`,
      till: `<div class="ds-acts">${btnHtml(r.quote.total ? `Put it right · ${money(r.quote.total)}` : 'Nothing to do',
        { cmd: 'podracer service', cls: r.quote.total ? 'primary' : '', disabled: !r.quote.total, why: r.quote.total ? '' : 'Sound and full' })}</div>` };
  el.innerHTML = bayHtml({
    ico: '⟰', title: r?.name || 'the racer', sub: 'the shed door', credits: d.credits,
    actions: btnHtml('Put it away', { cmd: 'podevent park', ico: '⟰', attrs: 'title="Run it back onto the blocks in the racer bay and climb out (Esc)"' }) + leaveHtml('Drive out'),
    notes: r?.rental ? `<div class="ds-note hire">Hire · ${esc(r.rental.leftText)} left · put it away and <b>podracer return</b> to hand it back</div>` : '',
    jobs, side: page.figures || '', body: page.main, till: page.till || '',
    foot: 'Put it away and the yard has it back up on the blocks. Open the levers instead and it leaves the door; stop in it again and the yard comes back.',
  });
  armHolds(el, send);
}

function jobState(r) {
  const cut = r.cables.filter((c) => !c).length;
  if (r.hull <= 0 || r.eng.some((e) => e <= 0)) return { sub: 'wrecked', tone: 'bad' };
  if (r.binder === false) return { sub: 'binder torn', tone: 'bad' };
  if (cut) return { sub: `${cut} cable${cut > 1 ? 's' : ''} cut`, tone: 'bad' };
  if (r.quote.total) return { sub: money(r.quote.total), tone: 'warn' };
  return { sub: 'all good', tone: 'ok' };
}

function onBayClick(e) {
  if (!sv) return;
  if (shellClick(e, { fold: () => { sv.open = false; drawBay(); }, open: () => { sv.open = true; drawBay(); } })) return;
  const t = e.target.closest?.('[data-svtab]');
  if (t) { sv.tab = t.dataset.svtab; sv.work = null; sv.kitWork = null; drawBay(); return; }
  if (fitClick(e, sv, drawBay)) return;
  if (paintClick(e, sv, drawBay)) return;
  const b = e.target.closest?.('[data-cmd]');
  if (b && !b.disabled && b.dataset.cmd) { noteAct(b); send(b.dataset.cmd); }
}

// ── The styles: the shell's chrome, and the bay's own furniture ──────────────
function ensurePodDepotStyles() {
  const el = document.getElementById('pdd-styles') || document.createElement('style');
  el.id = 'pdd-styles';
  el.textContent = `
    /* THE RACER BAY'S OWN LOOK: a racing orange for the shell's one accent (every tint derives from
       it), a chequered band under the head, and red-rock dust in the floor of the hand. */
    .pdd-root, #pdd-bay{ --ds-accent:#ff6a2b; }
    .pdd-root .ds-body{ background:radial-gradient(ellipse at 50% 120%, rgba(150,58,20,.22) 0%, transparent 62%); }
    .pdd-flag{ flex:0 0 auto; height:8px; opacity:.85;
      background:repeating-conic-gradient(#f2efe6 0 25%, #16130f 0 50%) 0 0 / 8px 8px;
      border-top:1px solid color-mix(in srgb, var(--ds-accent) 60%, transparent);
      border-bottom:1px solid color-mix(in srgb, var(--ds-accent) 60%, transparent); }
    .pdd-root .ds-title-ico, #pdd-bay .ds-title-ico{ color:var(--ds-accent); text-shadow:0 0 10px color-mix(in srgb, var(--ds-accent) 60%, transparent); }
    .pdd-root .vc-card:not(.slot){ box-shadow:0 0 0 1px color-mix(in srgb, var(--ds-accent) 25%, transparent); }
    .pdd-booth{ display:grid; grid-template-columns:minmax(220px,1fr) minmax(260px,1.3fr); gap:10px; align-items:start; }
    @media (max-width:640px){ .pdd-booth{ grid-template-columns:1fr; } }
    .pdd-boothcard{ width:100%; }
    .pdd-swatches{ display:grid; grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:6px; }
    .pdd-swatch{ display:flex; align-items:center; gap:6px; font-size:12px; line-height:1.2; font-family:inherit; padding:5px; cursor:pointer; text-align:left;
      color:var(--ds-fg); background:var(--ds-surf-lo); border:1px solid color-mix(in srgb, var(--ds-accent) 22%, transparent); border-radius:6px; }
    .pdd-swatch i{ width:22px; height:22px; border-radius:4px; flex:none; border:1px solid rgba(255,255,255,.2); }
    .pdd-swatch.on, .pdd-fin.on{ border-color:var(--ds-accent); box-shadow:0 0 10px color-mix(in srgb, var(--ds-accent) 35%, transparent); }
    .pdd-swatch.mine span::after{ content:' ✓'; color:var(--ds-gain); }
    .pdd-fin.mine::after{ content:' ✓'; color:var(--ds-gain); }
    .pdd-parthead{ margin:0 0 8px; }
    .pdd-bill{ margin:0; }
    .pdd-insrow{ display:grid; grid-template-columns:64px 1fr; align-items:center; gap:6px; margin-top:4px; font-size:12px; }
    .pdd-chip.on{ border-color:var(--ds-accent); box-shadow:0 0 10px color-mix(in srgb, var(--ds-accent) 35%, transparent); }
    .pdd-chips, .pdd-fins, .pdd-picks{ display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; }
    .pdd-picks{ margin:0 0 8px; }
    .pdd-chip{ display:flex; align-items:center; gap:6px; font:inherit; font-size:12px; padding:5px 8px; cursor:pointer; color:var(--ds-fg);
      background:var(--ds-surf-lo); border:1px solid color-mix(in srgb, var(--ds-accent) 22%, transparent); border-radius:6px; }
    .pdd-chip i{ width:18px; height:18px; border-radius:50%; border:1px solid rgba(255,255,255,.3); }
    .pdd-fin{ font:inherit; font-size:11.5px; padding:4px 9px; cursor:pointer; text-transform:capitalize; color:var(--ds-fg);
      background:var(--ds-surf-lo); border:1px solid color-mix(in srgb, var(--ds-accent) 22%, transparent); border-radius:999px; }
    .pdd-exits{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:6px 12px; flex:0 0 auto; font-size:11px;
      border-bottom:1px solid color-mix(in srgb, var(--ds-accent) 20%, transparent); }
    .pdd-exits .ds-btn{ text-transform:capitalize; padding:4px 8px; font-size:11px; }
    .pdd-lots{ display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:10px; }
    .pdd-lot{ margin:0; }
    .pdd-blurb{ margin:2px 0; font-size:12.5px; }
    .pdd-wf{ display:block; width:100%; height:168px; border-radius:7px;
      background:radial-gradient(ellipse at 50% 62%, #1d130d 0%, #0a0705 72%);
      border:1px solid color-mix(in srgb, var(--ds-accent) 22%, transparent); box-shadow:inset 0 2px 10px rgba(0,0,0,.45); }`;
  if (!el.parentNode) document.head.appendChild(el);
}
