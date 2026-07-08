/**
 * Data migration: convert plugins/flight/contracts.js's hardcoded JOB_TYPES array
 * into devpanel/VINE-editable `quests` rows (quest_type='flight_template').
 *
 * plugins/flight/contracts.js's topUp() now reads these templates instead of the
 * old in-code array, rolling a concrete 'flight' quest instance from one per field
 * board. Run once after `npm run db:schema` has added quests.quest_type/meta.
 *
 * Idempotent: ON CONFLICT DO UPDATE, so re-running re-applies edits.
 *
 *   Local:  node scripts/migrate-flight-job-types.js
 *   Prod:   node --env-file=.env.prod scripts/migrate-flight-job-types.js
 */
import { query } from '../server/models/db.js';

// The exact archetypes that used to live in plugins/flight/contracts.js's JOB_TYPES.
const TEMPLATES = [
  // ── Legal ──────────────────────────────────────────────────────────────────
  { id: 'freight',  label: 'Freight',          kind: 'cargo',     legal: true,  payMult: 1.0, risk: 0, wMin: 60, wMax: 260, mins: 30, names: ['a pallet of machine parts', 'crated electronics', 'a container of dry goods', 'a load of milled alloy', 'baled textiles'] },
  { id: 'courier',  label: 'Priority Courier', kind: 'cargo',     legal: true,  payMult: 1.4, risk: 0, wMin: 15, wMax: 55,  mins: 14, names: ['a bonded document pouch', 'a sealed courier case', 'a signature-only parcel'] },
  { id: 'pharma',   label: 'Cold-Chain Meds',  kind: 'cargo',     legal: true,  payMult: 1.4, risk: 1, wMin: 60, wMax: 160, mins: 18, names: ['a refrigerated medcrate', 'temperature-locked antivirals', 'a chilled organ box'] },
  { id: 'charter',  label: 'Passenger Charter', kind: 'passenger', legal: true, payMult: 1.1, risk: 0, wMin: 80, wMax: 80,  mins: 30, names: ['a corporate auditor', 'an off-duty ripperdoc', 'a family relocating out of the sprawl'] },
  { id: 'vip',      label: 'VIP Charter',      kind: 'passenger', legal: true, payMult: 1.9, risk: 1, wMin: 120, wMax: 120, mins: 24, names: ['a nervous executive and their bodyguard', 'a mid-tier corpo who tips well'] },
  { id: 'medevac',  label: 'Medevac (URGENT)', kind: 'passenger', legal: true, payMult: 1.7, risk: 1, wMin: 90, wMax: 90,  mins: 11, names: ['a wounded runner bleeding out', 'a crash survivor who needs a real clinic'] },
  { id: 'relief',   label: 'Relief Run',       kind: 'cargo',     legal: true,  payMult: 1.5, risk: 2, wMin: 120, wMax: 300, mins: 30, names: ['crates of relief supplies', 'water and rations for the wastes', 'a mobile clinic in flatpack'] },
  { id: 'survey',   label: 'Survey Drop',      kind: 'cargo',     legal: true,  payMult: 1.2, risk: 1, wMin: 40, wMax: 80,  mins: 26, names: ['sensor pods for recovery', 'a survey drone package', 'seismic charges (permitted)'] },
  // ── Illegal (contraband; fly dark) ─────────────────────────────────────────
  { id: 'smuggle',  label: 'Smuggling',        kind: 'cargo',     legal: false, payMult: 2.1, risk: 2, wMin: 40, wMax: 120, mins: 24, names: ['an unmarked crate that ticks', 'sealed bricks of something illegal', 'a case nobody will describe'] },
  { id: 'gunrun',   label: 'Gun-Running',      kind: 'cargo',     legal: false, payMult: 2.3, risk: 3, wMin: 80, wMax: 200, mins: 24, names: ['a crate of hot iron', 'oiled rifles in a fish shipment', 'a pallet of "agricultural parts"'] },
  { id: 'chopshop', label: 'Chop-Shop Parts',  kind: 'cargo',     legal: false, payMult: 2.1, risk: 2, wMin: 40, wMax: 100, mins: 20, names: ['stripped, still-warm cyberware', 'a VIN-scrubbed drive core', 'boxed black-market implants'] },
  { id: 'disposal', label: 'Disposal',         kind: 'cargo',     legal: false, payMult: 2.4, risk: 3, wMin: 90, wMax: 90,  mins: 30, names: ['a body that needs to disappear', 'a rolled tarp you were told not to open'] },
  { id: 'toxic',    label: 'Toxic Dump',       kind: 'cargo',     legal: false, payMult: 1.9, risk: 2, wMin: 150, wMax: 350, mins: 30, names: ['drums nobody will sign for', 'leaking canisters of something bright', 'unlabelled slurry'] },
  { id: 'exfil',    label: 'Exfil (HOT)',      kind: 'passenger', legal: false, payMult: 2.7, risk: 4, wMin: 90, wMax: 90,  mins: 20, names: ['a fugitive who can\'t use the front door', 'a witness who needs to vanish tonight'] },
  { id: 'datamule', label: 'Data Mule',        kind: 'passenger', legal: false, payMult: 2.4, risk: 3, wMin: 85, wMax: 85,  mins: 16, names: ['a courier wired with a case they can\'t open', 'a decker running from their last client'] },
];

async function main() {
  for (const t of TEMPLATES) {
    const id = `quest_flight_${t.id}`;
    const meta = { kind: t.kind, legal: t.legal, payMult: t.payMult, riskBase: t.risk, wMin: t.wMin, wMax: t.wMax, deadlineMins: t.mins, names: t.names };
    await query(
      `INSERT INTO quests (id,name,description,objectives,rewards,repeatable,quest_type,meta,updated_at)
       VALUES ($1,$2,$3,'[]','{}',1,'flight_template',$4,EXTRACT(EPOCH FROM NOW()))
       ON CONFLICT (id) DO UPDATE SET name=$2,description=$3,repeatable=1,quest_type='flight_template',
         meta=$4,updated_at=EXTRACT(EPOCH FROM NOW())`,
      [id, t.label, t.legal ? 'Legal charter/freight work.' : 'Contraband — fly it dark.', JSON.stringify(meta)]
    );
    console.log(`  flight_template  ${id.padEnd(24)} ${t.label}`);
  }
  console.log(`Done — ${TEMPLATES.length} flight contract templates migrated.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
