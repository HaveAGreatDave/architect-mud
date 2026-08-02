// THE COILS — which sleeve you take, and whether that slot has any left.
//
// A vending machine you can't choose from is a button. The whole feel of standing
// at one is picking the column, so the machine carries real per-slot stock: nine
// coils, each with its own count, each capable of running out. Choosing is HONEST
// about what it buys you — every sealed sleeve is identical, and the roll still
// happens at `openpack` — so the choice is which physical object you walk away
// with, not a secret odds lever. That is worth saying plainly on the panel rather
// than implying otherwise, because a machine that pretended the coil mattered
// would be lying to a player who could test it in an evening.
//
// WHERE THIS STATE LIVES: in memory, never the DB. Stock is a cosmetic-economic
// detail of one fixture, it changes on every purchase, and per architecture.md's
// persistence tiers a per-purchase write for something a restock erases nightly
// is exactly the write not to make. So the BASE layout is DERIVED — a hash of
// (machine id, game date, slot code) — which makes it stateless, identical for
// every player looking at the same machine on the same day, and self-restocking
// as the date rolls without a tick to run it. Only the day's SALES are held in
// RAM, and a restart forgetting that a stranger emptied coil B2 an hour ago is
// the correct amount of memory for a vending machine.

export const ROWS = ['A', 'B', 'C'];
export const COLS = ['1', '2', '3'];
export const SLOT_CODES = ROWS.flatMap(r => COLS.map(c => r + c));

// Cap is what a coil HOLDS, not what it has. The panel draws stock against it,
// so it doubles as the fill-bar denominator.
export const SLOT_CAP = 8;

// machineId -> { day, sold: Map(code -> n) }
const soldByMachine = new Map();

// FNV-1a. Deterministic, cheap, and stable across restarts — which is the whole
// requirement: two players at the same machine on the same day must see the same
// coils, with no shared state between them to make it so.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// A slot's stock before anybody bought from it today. Roughly a fifth of coils
// come up empty, because a machine with every column full reads as a menu — the
// bare coil next to a stacked one is what makes the stacked one look like goods.
export function baseStock(machineId, day, code) {
  const h = hash(`${machineId}|${day}|${code}`);
  if (h % 5 === 0) return 0;
  return 3 + (h % (SLOT_CAP - 2));   // 3..8
}

function ledger(machineId, day) {
  const cur = soldByMachine.get(machineId);
  if (cur && cur.day === day) return cur;
  const fresh = { day, sold: new Map() };   // the date rolled: restocked, for free
  soldByMachine.set(machineId, fresh);
  return fresh;
}

// The whole face, as the panel draws it. `left` is what a player can actually
// take; `cap` is the coil's depth, so the fill bar means something.
export function slotsFor(machine, day) {
  const l = ledger(machine.id, day);
  return SLOT_CODES.map(code => ({
    code,
    cap: SLOT_CAP,
    left: Math.max(0, baseStock(machine.id, day, code) - (l.sold.get(code) || 0)),
  }));
}

export function slotLeft(machine, day, code) {
  return slotsFor(machine, day).find(s => s.code === code)?.left ?? 0;
}

// Nothing left anywhere. A machine can genuinely be emptied by a busy room, and
// it has to say so rather than vending out of an empty coil.
export function totalLeft(machine, day) {
  return slotsFor(machine, day).reduce((n, s) => n + s.left, 0);
}

// The default pick when somebody types `buypack confirm` with no slot: the
// fullest coil. A typed verb must never fail for want of a choice the panel
// would have made for you.
export function fullestSlot(machine, day) {
  return slotsFor(machine, day).filter(s => s.left > 0)
    .sort((a, b) => b.left - a.left || a.code.localeCompare(b.code))[0]?.code || null;
}

// ── the sleeve's seed ─────────────────────────────────────────────────────────
// THE COIL DECIDES THE SLEEVE. Each physical sleeve on a coil has its outcome
// fixed before anybody touches it, exactly like a real pack sitting on a shelf:
// the third sleeve down coil B2 is a specific sleeve, and taking it gets you
// what was in it. So the player's choice genuinely determines the result, and
// somebody who swears by the middle column is not fooling themselves — they are
// just wrong or right at random, which is what a superstition is.
//
// It costs ONE INTEGER, not a stored card list, because every roller in
// builder.js already takes a `rand` function: the seed and `mulberry32` rebuild
// the identical sleeve at tear time. The seed rides on the inventory row, so it
// survives a restart, a trade, and a month in a coat pocket.
//
// SALT: mixed in once per process, so the mapping from (machine, day, coil,
// depth) to an outcome is unpredictable rather than something a player could
// recompute from public content ids and pre-scout the whole city's machines. A
// restart re-salts, which only ever changes sleeves nobody has bought — a bought
// sleeve already carries its own seed and is immune.
const SALT = (Math.random() * 0xffffffff) >>> 0;

export function sleeveSeed(machineId, day, code, depth) {
  return hash(`${SALT}|${machineId}|${day}|${code}|${depth}`);
}

// Take one. Returns null if the coil was empty — the caller must not charge
// anybody until this has succeeded — otherwise the taken sleeve's identity:
// which coil, how deep in the stack it was, and the seed that IS its contents.
export function takeFromSlot(machine, day, code) {
  if (!SLOT_CODES.includes(code)) return null;
  if (slotLeft(machine, day, code) < 1) return null;
  const l = ledger(machine.id, day);
  const depth = l.sold.get(code) || 0;      // how many already came off this coil
  l.sold.set(code, depth + 1);
  return { coil: code, depth, seed: sleeveSeed(machine.id, day, code, depth) };
}

export const normaliseSlot = (s) => String(s || '').trim().toUpperCase();

export const _test = { hash, soldByMachine };
