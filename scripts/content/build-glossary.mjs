// build-glossary — emit content/glossary/*.json, one file per term.
//
//   node scripts/content/build-glossary.mjs
//
// The Library's gloss layer. Rather than MODERNISING the books — which would cost
// a rewrite of ~300k words and destroy the thing that makes them worth shelving —
// the archaic vocabulary stays exactly as written and gets annotated in the
// reader. Tap a word, get one line of plain English, carry on.
//
// Scope rule: gloss what a reader would STOP at, not everything old-fashioned.
// A word that's merely quaint but transparent in context ("thrice") earns
// nothing; a word that halts the sentence ("phthisis", "assignat") earns a line.
// Glosses are one sentence, present tense, no etymology — this is a reading aid,
// not an OED.
//
// Terms are matched case-insensitively on whole words, longest-first, so
// "opium-eater" wins over "opium". Aliases carry inflections the matcher would
// otherwise miss (plurals, -ed/-ing, period spellings).
import { writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'content', 'glossary');

// [term, gloss, ...aliases]
const TERMS = [
  // ── De Quincey / opium ──
  ['laudanum', 'Opium dissolved in alcohol — legal, cheap, and sold over the counter for everything from toothache to grief.'],
  ['opium-eater', 'Someone who takes opium by mouth rather than smoking it.', 'opium eater', 'opium-eaters'],
  ['apothecary', 'A chemist — someone who mixes and sells drugs.', 'apothecaries'],
  ['druggist', 'A pharmacist.', 'druggists'],
  ['phthisis', 'Tuberculosis — a wasting lung disease.'],
  ['ague', 'A fever with violent shivering, usually malaria.', 'agues'],
  ['dropsy', 'Swelling from fluid retention, usually a sign of heart or kidney failure.'],
  ['paregoric', 'A weak opium tincture given for pain and diarrhoea, including to infants.'],
  ['stimulant', 'Anything taken to rouse the body — in this period the word covers alcohol and opium alike.'],
  ['reverie', 'A waking dream; being lost in thought.', 'reveries'],
  ['sensibility', 'Capacity for feeling — being easily and deeply moved.'],
  ['physic', 'Medicine, or the practice of it.'],

  // ── Period life / class ──
  ['periwig', 'A powdered wig worn by gentlemen.', 'periwigs', 'peruke'],
  ['phaeton', 'A light open carriage, fast and fashionable — the sports car of its day.', 'phaetons'],
  ['brougham', 'A small enclosed carriage for one or two passengers.', 'broughams'],
  ['hansom', 'A two-wheeled cab for hire, driver seated behind.', 'hansoms'],
  ['scullery', 'The back kitchen where dishes and dirty work were done.', 'sculleries'],
  ['charwoman', 'A woman hired by the day to clean.', 'charwomen'],
  ['costermonger', 'A street seller of fruit and vegetables from a barrow.', 'costermongers'],
  ['victuals', 'Food supplies.', 'victual'],
  ['repast', 'A meal.', 'repasts'],
  ['garret', 'A cramped room in the roof space — the cheapest lodging in the house.', 'garrets'],
  ['lodging-house', 'A building of rented rooms, let by the week.', 'lodging house', 'lodging-houses'],
  ['workhouse', 'A state institution where the destitute were housed and made to labour for their keep.', 'workhouses'],
  ['parish', 'The local unit responsible for its own poor — your parish was who you fell back on.', 'parishes'],
  ['almsgiving', 'Charity to the poor.', 'alms'],
  ['guinea', 'A coin worth twenty-one shillings — slightly more than a pound, and the polite way to price things.', 'guineas'],
  ['crown', 'A coin worth five shillings.', 'half-crown', 'crowns'],
  ['farthing', 'A quarter of a penny — the smallest coin there was.', 'farthings'],
  ['assignat', 'French revolutionary paper money, which lost almost all its value.', 'assignats'],
  ['pistole', 'A Spanish gold coin, widely used across Europe.', 'pistoles'],
  ['ducat', 'A gold trade coin used across Europe.', 'ducats'],

  // ── Voltaire / Candide ──
  ['auto-da-fe', 'A public ceremony of the Inquisition at which heretics were sentenced and often burned.', 'auto-da-fé', 'autos-da-fe'],
  ['inquisitor', 'An official of the Inquisition, empowered to try and punish heresy.', 'inquisitors'],
  ['metaphysico', 'Mock-scholarly jargon — Voltaire is making fun of philosophers who name their subject rather than explain it.'],
  ['optimism', 'The doctrine that this world, suffering included, is the best one possible — the belief the book exists to demolish.'],
  ['bulgarians', 'Voltaire\'s thin disguise for the Prussians.', 'bulgarian'],
  ['abares', 'Voltaire\'s thin disguise for the French.', 'abare'],
  ['seraglio', 'The private quarters of a household where women lived, or the harem itself.', 'seraglios'],
  ['janissary', 'An elite Ottoman soldier, taken as a child and raised to the army.', 'janissaries'],
  ['galley', 'A ship rowed by convicts and slaves chained to the oars — a sentence, not a job.', 'galleys'],
  ['baron', 'A titled landowner, the lowest rank of nobility — and in this book, insufferable about it.', 'baroness', 'baronet'],

  // ── London / Wells / Forster ──
  ['oligarchy', 'Rule by a small group of the very rich.', 'oligarchs', 'oligarch'],
  ['plutocrat', 'Someone whose power comes from wealth.', 'plutocrats', 'plutocracy'],
  ['proletariat', 'The working class, who own nothing but their labour.', 'proletarian'],
  ['bourgeoisie', 'The property-owning middle class.', 'bourgeois'],
  ['trust', 'A combine of companies acting as one to fix prices and crush competitors.', 'trusts'],
  ['scab', 'A worker who crosses a picket line during a strike.', 'scabs'],
  ['vivisection', 'Surgery performed on living animals for research.'],
  ['puma', 'A cougar — a large American cat.', 'pumas'],
  ['carbolic', 'A harsh disinfectant; the smell of Victorian surgery.'],
  ['pneumatic', 'Driven by compressed air.'],
  ['airship', 'A steerable powered balloon.', 'air-ship', 'airships', 'air-ships'],
  ['respirator', 'A breathing mask.', 'respirators'],
  ['homelessness', 'In Forster, a punishment: expulsion to the surface, which is assumed to be fatal.'],

  // ── General reading friction ──
  ['hitherto', 'Until now.'],
  ['whither', 'To where.'],
  ['whence', 'From where.'],
  ['thither', 'To there.'],
  ['betimes', 'Early, or in good time.'],
  ['forthwith', 'Immediately.'],
  ['notwithstanding', 'Despite that.'],
  ['peradventure', 'Perhaps.'],
  ['succour', 'Help given in hardship.', 'succor'],
  ['countenance', 'A person\'s face, or their expression.', 'countenances'],
  ['visage', 'A face.', 'visages'],
  ['import', 'Meaning or significance — not goods, in this sense.'],
  ['want', 'Lack, or poverty — not desire, in this sense.'],
  ['presently', 'Soon, or shortly afterwards.'],
  ['directly', 'At once.'],
  ['sensible', 'Aware of something; able to perceive it.'],
  ['prodigious', 'Enormous.', 'prodigiously'],
  ['odious', 'Hateful.'],
  ['perfidy', 'Treachery.', 'perfidious'],
  ['calumny', 'A damaging lie told about someone.', 'calumnies'],
  ['importunate', 'Persistently demanding.', 'importune', 'importuned'],
  ['effrontery', 'Shameless nerve.'],
  ['dissemble', 'To hide your real feelings or intentions.', 'dissembled', 'dissembling'],
  ['expostulate', 'To argue or protest.', 'expostulated', 'expostulation'],
  ['ejaculated', 'Exclaimed — said something suddenly. It only means that here.'],
  ['gainsay', 'To deny or contradict.', 'gainsaid'],
  ['abjure', 'To renounce something under oath.', 'abjured'],
  ['inculcate', 'To drill an idea into someone by repetition.', 'inculcated'],
  ['propitiate', 'To appease someone angry.', 'propitiated', 'propitiation'],
  ['temporise', 'To stall for time.', 'temporize', 'temporised', 'temporized'],
  ['manichean', 'Holding that good and evil are two equal warring powers.', 'manichaean', 'manicheism'],
  ['casuistry', 'Clever moral reasoning used to justify what you wanted anyway.', 'casuist'],
  ['sophistry', 'Argument that sounds valid and isn\'t.'],
  ['erudition', 'Deep book-learning.', 'erudite'],
  ['pedant', 'Someone obsessed with small points of correctness.', 'pedantry', 'pedantic'],
];

function slug(term) {
  return 'gloss_' + term.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function main() {
  await mkdir(OUT, { recursive: true });
  // Rewrite cleanly: a term removed from the list above should lose its file too,
  // otherwise the deleted entry lingers and the deploy never drops the row.
  for (const f of await readdir(OUT).catch(() => [])) {
    if (f.endsWith('.json')) await unlink(join(OUT, f));
  }
  const seen = new Set();
  for (const [term, gloss, ...aliases] of TERMS) {
    const id = slug(term);
    if (seen.has(id)) throw new Error(`duplicate glossary term: ${term}`);
    seen.add(id);
    const row = { id, term, gloss, aliases };
    await writeFile(join(OUT, `${id}.json`), JSON.stringify(row, null, 2) + '\n', 'utf8');
  }
  const aliasCount = TERMS.reduce((n, t) => n + t.length - 2, 0);
  console.log(`✓ ${TERMS.length} glossary terms (+${aliasCount} aliases) → content/glossary/`);
}

await main();
