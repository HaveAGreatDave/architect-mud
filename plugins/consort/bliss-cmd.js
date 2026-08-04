// B.L.I.S.S. by typing — `bliss` and its subcommands.
//
// The entire hire-and-place economy used to live behind three buttons in
// bliss-app.js: `place`, `release` and `reroll` were bound to no command anywhere,
// so a player who couldn't or didn't use the tablet could never acquire a consort
// at all. Not "acquire one awkwardly" — the register was unreachable.
//
// It calls hire.js and roster.js directly, the same modules the app calls, and the
// arrangement arithmetic lives in hire.js (`arrangementEntries`) so the two front
// ends can never quote different daily costs for the same people.
//
// THE GATE IS THE SAME ONE THE APP USES, and it matters more here. B.L.I.S.S. is
// MIS content: the app's tile does not exist for a player who hasn't opted in, and
// the verb must be equally invisible. So an unopted player gets the literal
// `Unknown command` the rest of the mature layer answers with
// (docs/systems-mis.md, the two-switch consent gate) — never a refusal, because a
// refusal tells you there is something there to be refused.
import { isMisActive } from '../../server/engine/mis.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { query } from '../../server/models/db.js';
import { generateRoster, listingCard, rerollState } from './roster.js';
import {
  privateSpacesOf, placeListing, releaseConsort, pairMembers, holdsPrivateSpace, arrangementEntries,
} from './hire.js';

const GEN_FLAG    = 'bliss_roster_gen';
const REROLL_FLAG = 'bliss_roster_rolled';

const link = (cmd, label) =>
  `<span class="action-link" data-action="cmd" data-cmd="${cmd}">${label || cmd}</span>`;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Identical to plugins/mis/index.js misGate — an unopted player must not learn
// this surface exists by probing for it.
function misGate(player, raw) {
  if (!isMisActive(player)) {
    const cmd = (raw || '').split(/\s+/)[0] || '';
    return { type: 'error', message: `Unknown command: "${cmd}". Type HELP for commands.` };
  }
  return null;
}

async function rosterFor(player) {
  const gen = Number(await getFlag('player', GEN_FLAG, player)) || 0;
  return { gen, listings: generateRoster(`${player.id}:${gen}`) };
}

const memberNames = (listing) => (listing.members || []).map(m => m.name).filter(Boolean);

// The register is addressed by POSITION (1..6), not by the internal listing id:
// the catalogue is regenerated from a seed rather than stored, so its ids are
// opaque — fine for a button to carry, useless for a person to type. A name works
// too, because that's what a player will actually reach for.
function pickListing(listings, arg) {
  const raw = String(arg || '').trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && String(n) === raw) return listings[n - 1] || null;
  const q = raw.toLowerCase();
  const named = (l, test) => memberNames(l).some(nm => test(String(nm).toLowerCase()));
  return listings.find(l => l.id === raw)
    || listings.find(l => named(l, nm => nm === q))
    || listings.find(l => named(l, nm => nm.startsWith(q)))
    || null;
}

// ── The register ─────────────────────────────────────────────────────────────

async function showRegister(player) {
  const { listings } = await rosterFor(player);
  const rolled = Number(await getFlag('player', REROLL_FLAG, player)) || 0;
  const state = rerollState(rolled);

  const lines = listings.map((l, i) => {
    const names = memberNames(l).map(esc).join(' &amp; ');
    const pair = l.kind === 'pairing' ? ' <span class="text-dim">(matched pair — inseparable)</span>' : '';
    return `  ${link(`bliss ${i + 1}`, String(i + 1))}. <b>${names}</b> <span class="text-dim">· ${l.rate}₵/day</span>${pair}`;
  });

  return {
    type: 'output',
    message: [
      `<span class="text-cyan">B.L.I.S.S.</span> <span class="text-dim">— Bonded Live-In Intimacy Subscription Service</span>`,
      ...lines,
      `<span class="text-dim">${link('bliss 1', 'bliss &lt;n&gt;')} for the full sheet · ${link('bliss arrangement', 'bliss arrangement')} for what you keep`
        + ` · ${state.ready ? link('bliss reroll', 'bliss reroll') : `register refreshes in ${state.remainingLabel}`}</span>`,
      `<span class="text-dim">Placements are subject to availability, a daily retainer, and clause 9.</span>`,
    ].join('\n'),
  };
}

// One placement's sheet. Renders the SAME listingCard the app renders, so the two
// describe a person identically — the explicit half included, since reaching this
// at all means MIS is on.
async function showListing(player, arg) {
  const { listings } = await rosterFor(player);
  const l = pickListing(listings, arg);
  if (!l) return { type: 'error', message: `Nothing at that slot on the register. ${link('bliss', 'bliss')} lists them.` };
  const slot = listings.indexOf(l) + 1;
  const card = listingCard(l);

  const out = [];
  if (card.pairing) {
    out.push(`<span class="text-cyan">${esc(card.pairing.label || 'A matched pair')}</span> <span class="text-dim">· ${card.rate}₵/day · inseparable</span>`);
    if (card.pairing.blurb) out.push(esc(card.pairing.blurb));
  } else {
    out.push(`<span class="text-cyan">${memberNames(l).map(esc).join(' &amp; ')}</span> <span class="text-dim">· ${card.rate}₵/day</span>`);
  }

  for (const m of card.members) {
    out.push('');
    out.push(`<b>${esc(m.name)}</b> <span class="text-dim">· ${esc(m.sex || '')}</span>`);
    if (m.headline) out.push(`  ${esc(m.headline)}`);
    if (m.says) out.push(`  <span class="ambient">"${esc(m.says)}"</span>`);
    if (m.note) out.push(`  <span class="text-dim">${esc(m.note)}</span>`);
    for (const line of [m.physical, m.intimate].flat().filter(Boolean)) {
      out.push(`  <span class="text-dim">${esc(typeof line === 'string' ? line : (line.value ?? ''))}</span>`);
    }
  }

  const spaces = await privateSpacesOf(player);
  out.push('');
  out.push(spaces.length
    ? `<span class="text-dim">Place at:</span> ${spaces.map(s => link(`bliss place ${slot} ${s.name}`, s.name)).join(' <span class="text-dim">·</span> ')}`
    : '<span class="text-dim">B.L.I.S.S. requires a private address on file. Acquire a residence or premises first.</span>');

  return { type: 'output', message: out.join('\n') };
}

// ── place ────────────────────────────────────────────────────────────────────

async function cmdPlace(player, rest) {
  const [slot, ...addr] = rest.split(/\s+/).filter(Boolean);
  const { listings } = await rosterFor(player);
  const l = pickListing(listings, slot);
  if (!l) return { type: 'error', message: `Place which? ${link('bliss', 'bliss')} lists the register.` };

  const spaces = await privateSpacesOf(player);
  if (!spaces.length) {
    return { type: 'error', message: 'B.L.I.S.S. requires a private address on file. Acquire a residence or premises first.' };
  }

  const want = addr.join(' ').trim().toLowerCase();
  let space = null;
  if (want) {
    space = spaces.find(s => String(s.name || '').toLowerCase() === want)
      || spaces.find(s => String(s.name || '').toLowerCase().startsWith(want))
      || spaces.find(s => s.id === addr.join(' ').trim());
    if (!space) return { type: 'error', message: `You hold no address called "${esc(addr.join(' '))}". Yours: ${spaces.map(s => `<b>${esc(s.name)}</b>`).join(', ')}` };
  } else if (spaces.length === 1) {
    space = spaces[0];                    // one address needs no argument
  } else {
    const n = listings.indexOf(l) + 1;
    return { type: 'error', message: `Place them where? ${spaces.map(s => link(`bliss place ${n} ${s.name}`, s.name)).join(' <span class="text-dim">·</span> ')}` };
  }

  if (!(await holdsPrivateSpace(player, space.id))) {
    return { type: 'error', message: 'That address is not one you hold.' };
  }

  // First day up front — the retainer is prepaid, then billed nightly.
  const cost = l.rate;
  if (!(await chargeUpFront(player, cost))) {
    return { type: 'error', message: `Declined. The first day's retainer is ${cost}₵ and your accounts do not cover it.` };
  }
  const created = await placeListing(player, l, space.id);
  // Burn the listing so it can't be ordered twice out of the same catalogue. The
  // app does exactly this; skipping it would make the verb a duplication exploit
  // the buttons don't have.
  await setFlag('player', GEN_FLAG, (Number(await getFlag('player', GEN_FLAG, player)) || 0) + 1, player);

  const names = created.map(c => c.name).join(' and ');
  return {
    type: 'output',
    message: `<span class="msg-system">${esc(names)} placed at ${esc(space.name)}. First day's retainer of ${cost}₵ drawn.</span>`,
  };
}

// Bank first, then pocket — the same order the nightly retainer draws in.
async function chargeUpFront(player, amount) {
  const { rows } = await query('SELECT credits, bank_credits FROM players WHERE id=$1', [player.id]);
  const p = rows[0] || {};
  const bank = Number(p.bank_credits) || 0;
  const cash = Number(p.credits) || 0;
  if (bank + cash < amount) return false;
  const fromBank = Math.min(bank, amount);
  const fromCash = amount - fromBank;
  await query('UPDATE players SET bank_credits = bank_credits - $1, credits = credits - $2 WHERE id=$3',
    [fromBank, fromCash, player.id]);
  if (fromCash) player.credits = cash - fromCash;
  return true;
}

// ── arrangement / release ────────────────────────────────────────────────────

async function showArrangement(player) {
  const entries = await arrangementEntries(player.id);
  if (!entries.length) {
    return { type: 'output', message: `You keep nobody. ${link('bliss', 'bliss')} opens the register.` };
  }
  const total = entries.reduce((s, e) => s + e.todayRate, 0);
  const lines = entries.map(e => {
    const names = e.names.map(esc).join(' and ');
    const tier = e.tier?.label ? ` · ${esc(e.tier.label)}` : '';
    const saving = e.saving ? ` <span class="text-dim">(−${e.saving}₵)</span>` : '';
    // A house placement carries no retainer and can't be released — say so where
    // the release link would otherwise be, rather than offering a dead button.
    const act = e.house
      ? '<span class="text-dim">not a Syndicate placement</span>'
      : link(`bliss release ${e.names[0] || ''}`, 'release');
    return `  <b>${names}</b> <span class="text-dim">· ${e.todayRate}₵/day${tier}</span>${saving}  ${act}`;
  });
  return {
    type: 'output',
    message: [`<span class="text-cyan">YOUR ARRANGEMENT</span> <span class="text-dim">— ${total}₵/day</span>`, ...lines].join('\n'),
  };
}

async function cmdRelease(player, rest) {
  const q = rest.trim().toLowerCase();
  if (!q) return { type: 'error', message: `Release whom? ${link('bliss arrangement', 'bliss arrangement')} lists them.` };

  const entries = await arrangementEntries(player.id);
  const hit = entries.find(e => e.names.some(n => String(n).toLowerCase() === q))
    || entries.find(e => e.names.some(n => String(n).toLowerCase().startsWith(q)));
  if (!hit) return { type: 'error', message: `No such placement on your account. ${link('bliss arrangement', 'bliss arrangement')} lists them.` };

  if (hit.house) {
    return {
      type: 'error',
      message: `${hit.names.map(esc).join(' and ')} are not a Syndicate placement. B.L.I.S.S. cannot collect what it did not place.`,
    };
  }

  const members = await pairMembers(hit.row);
  await releaseConsort(hit.row, 'released');
  const names = members.map(m => esc(m.name)).join(' and ');
  return {
    type: 'output',
    message: members.length > 1
      ? `<span class="msg-system">${names} released. A matched pair goes together; the Syndicate does not sever one.</span>`
      : `<span class="msg-system">${names} released. The retainer ends tonight.</span>`,
  };
}

async function cmdReroll(player) {
  const rolled = Number(await getFlag('player', REROLL_FLAG, player)) || 0;
  const state = rerollState(rolled);
  if (!state.ready) return { type: 'error', message: `The register refreshes in ${state.remainingLabel}.` };
  await setFlag('player', GEN_FLAG, (Number(await getFlag('player', GEN_FLAG, player)) || 0) + 1, player);
  await setFlag('player', REROLL_FLAG, Date.now(), player);
  return showRegister(player);
}

// ── The verb ─────────────────────────────────────────────────────────────────

export async function cmdBliss(args, raw, player) {
  const gate = misGate(player, raw || 'bliss');
  if (gate) return gate;

  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1).join(' ').trim();

  if (!sub) return showRegister(player);
  if (sub === 'place' || sub === 'hire') return cmdPlace(player, rest);
  if (sub === 'release') return cmdRelease(player, rest);
  if (sub === 'reroll' || sub === 'refresh') return cmdReroll(player);
  if (sub === 'arrangement' || sub === 'kept' || sub === 'account') return showArrangement(player);
  if (sub === 'register' || sub === 'list') return showRegister(player);
  // `bliss 3` / `bliss Marisol` — a slot on the register.
  return showListing(player, args.join(' '));
}

export const _test = { pickListing, misGate };
