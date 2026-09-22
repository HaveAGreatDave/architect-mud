/**
 * FAIRWEATHER MARINA, batch 2 — telling the boatyard where the boats go.
 *
 *   node scripts/content/marina/batch2.mjs [--dry-run]
 *
 * Three flags, and every one of them is a CAPACITY rather than a boolean, because the yard counts
 * occupancy against the `boats` rows themselves (`WHERE berth_zone = $1`) and has to have something
 * to count it against. Run after batch0 and batch1.
 *
 * ⚠ THE NUMBERS AGREE WITH THE PROSE ON PURPOSE. The Hall's own description says four cradles of
 * six are occupied and the Hardstanding's says four of six — those four are other people's boats
 * and are scenery, so what is authored here is what is actually LETTABLE. Author the full six and
 * the berth board reads "0 of 6 taken" in a room the player can see is two-thirds full.
 */
import { loadContentStore } from '../../../tools/lib/content-store.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const set = (id, flags) => {
  const z = store.get('zones', id);
  if (!z) throw new Error(`no zone ${id} — run batch0 and batch1 first`);
  store.patch('zones', id, { flags: { ...(z.flags || {}), ...flags } });
};

// The covered hall: two bays lettable, a hoist, and the shipwright. `boat_dealer` is what makes
// `boat` list a stock list here — deliberately a SEPARATE flag from the berth, because selling
// hulls and keeping them are two different trades and a broker in an office should be able to do
// one without the other.
set('zone_consv_hall', { boat_covered: 2, boat_dealer: true });

// The open apron behind the fence: two cradles free, no roof, and no hoist worth the name.
set('zone_district_892_902', { boat_hardstanding: 2 });

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN — ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}`);
for (const p of written) console.log('  ' + p.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', ''));
