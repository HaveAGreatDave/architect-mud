// WHAT AN INGREDIENT CARRIES ONTO THE PLATE.
//
// Plating built a dish out of `cook_quality`, `yield` and `doneness` and threw
// everything else away. The produced row is one generic `item_cooked_dish`, so
// the eat path in commands/inventory.js read ITS tags — which are the tags of a
// generic dish, not of anything that went into it. A stew of rat, mutagen and a
// measure of filth was mechanically identical to a stew of rat.
//
// That made the tag catalog wrong in writing: `bodily_filth` claims it "taints
// the whole dish — anything made with it carries the filth through to the
// plate", and nothing did that. This is the thing that does it.
//
// THE RULE: cooking changes how good a thing is, never what it IS. Heat is not
// a purifier here. Every hazard below carries at full strength, because the
// alternative — a well-cooked filth stew being safe — is the joke collapsing.
//
// Pure: rows in, a plain object out. No DB, no player, no clock.

// Read a tag off an ingredient row. Rows come from `vesselContents`, which
// selects `i.tags`, and an INTERMEDIATE (a paste, a dough) carries its own
// gathered hazards on custom_data — so a filth paste folded into a pie is still
// a filth pie. Without that second lookup the whole thing would launder itself
// through one intermediate step.
const tagsOf = r => (r?.tags && typeof r.tags === 'object') ? r.tags : {};
const carriedOf = r => {
  const cd = r?.custom_data;
  const h = (typeof cd === 'string' ? safeParse(cd) : cd)?.hazards;
  return (h && typeof h === 'object') ? h : null;
};
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

/**
 * Everything about a vessel's contents that should outlive the cook.
 * Returns null when there is nothing worth carrying, so the common case stamps
 * nothing and every dish that predates this is byte-identical.
 *
 * { status_chance?, disease_risk?, donors?, radiation?, sanity?, laced_drug?, laced_potency? }
 */
export function gatherHazards(rows = []) {
  const status = {};          // effect → worst chance seen
  const donors = new Set();
  let disease = false;
  let radiation = 0;
  let sanity = 0;
  let laced = null;
  let lacedPotency = 0;

  const mergeStatus = (table) => {
    if (!table || typeof table !== 'object') return;
    for (const [effect, chance] of Object.entries(table)) {
      const p = Number(chance);
      if (!(p > 0)) continue;
      // WORST, not sum and not average. Two risky ingredients don't make a
      // safer dish, and summing would push any two of them straight past 1.0.
      status[effect] = Math.max(status[effect] || 0, Math.min(1, p));
    }
  };

  for (const r of rows) {
    const t = tagsOf(r);
    const carried = carriedOf(r);

    mergeStatus(t.status_chance);
    mergeStatus(carried?.status_chance);

    if (t.disease_risk || carried?.disease_risk) disease = true;
    // Who it came out of. `depositIntoVessel` stamps this, and it is the only
    // reason disease_risk can ever be more than flavour text.
    const cd = typeof r?.custom_data === 'string' ? safeParse(r.custom_data) : r?.custom_data;
    if (cd?.donor_id) donors.add(cd.donor_id);
    for (const d of carried?.donors || []) donors.add(d);

    // Ingested properties that are about the SUBSTANCE rather than the cooking.
    // Summed, because two irradiated fillets really are twice the dose.
    radiation += Number(t.restore_radiation) || 0;
    radiation += Number(carried?.radiation) || 0;
    sanity += Number(t.restore_sanity) || 0;
    sanity += Number(carried?.sanity) || 0;

    // A laced ingredient makes a laced meal. First one in the pan owns the
    // dish — the drug path takes a single id, and picking a winner is honest
    // where silently dropping one is not.
    const drug = t.laced_drug || carried?.laced_drug;
    if (drug && !laced) {
      laced = drug;
      lacedPotency = Number(t.laced_potency ?? carried?.laced_potency) || 1;
    }
  }

  const out = {};
  if (Object.keys(status).length) out.status_chance = status;
  if (disease) out.disease_risk = true;
  if (donors.size) out.donors = [...donors];
  if (radiation) out.radiation = radiation;
  if (sanity) out.sanity = sanity;
  if (laced) { out.laced_drug = laced; out.laced_potency = lacedPotency; }
  return Object.keys(out).length ? out : null;
}
