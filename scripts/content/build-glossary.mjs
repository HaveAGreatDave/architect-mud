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
  // Wells coinages in The Sleeper Awakes — invented words, so nothing else will
  // explain them and a reader stops dead on the first one.
  ['eadhamite', "Wells's invented road surface: a seamless artificial rubber the whole city is paved in."],
  ['babble machine', 'A street-corner speaking machine that shouts the news at passers-by, forever, whether or not there is any.', 'babble machines', 'babble-machine'],
  ['wind-vane', 'In Wells, not a weathercock but a giant power turbine — the wind-vane keepers are the men who run the city.', 'wind vane', 'wind-vanes'],
  ['aeronaut', 'A flyer — the pilot of an aircraft.', 'aeronauts'],

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

  // ── Second pass: swept the shelved books for words that (a) recur, (b)
  //    aren't in the 25k common-word list, and (c) actually halt a sentence.
  //    Proper names and merely-old spellings were left alone on the scope rule.

  // Candide — money, orders, places
  ['piastre', 'An Ottoman silver coin.', 'piastres'],
  ['sequin', 'A Venetian gold coin. It has nothing to do with dress spangles here.', 'sequins'],
  ['quarterings', 'The divisions of a coat of arms, one per noble ancestor — a countable measure of how well-born you are.', 'quartering'],
  ['anabaptist', 'A Protestant sect that rejected infant baptism and was persecuted by nearly everyone.', 'anabaptists'],
  ['theatin', 'A member of a Catholic order of priests.', 'theatins'],
  ['dervish', 'A member of a Muslim ascetic order, sought out for wisdom.', 'dervishes'],
  ['marchioness', 'A noblewoman ranking just below a duchess.', 'marchionesses'],
  ['eunuch', 'A castrated man, often employed as a guard or servant in a household.', 'eunuchs'],
  ['oreillons', 'Voltaire\'s invented tribe — the name means "big ears".', 'oreillon'],
  ['propontis', 'The Sea of Marmara, between the Aegean and the Black Sea.'],
  ['westphalia', 'A region of Germany, chosen by Voltaire for being provincial and unimportant.', 'westphalian'],
  ['pococurante', 'A Venetian noble whose name means "caring little" — bored by everything he owns.'],
  ['perigordian', 'From Périgord in south-west France.'],
  ['surinam', 'A Dutch colony on the north coast of South America, worked by slave labour.'],

  // De Quincey — pharmacy and dreams
  ['tincture', 'A drug dissolved in alcohol so it can be measured out in drops.', 'tinctures'],
  ['draught', 'A measured dose of liquid medicine — not a breeze, in this sense.', 'draughts'],
  ['ipecacuanha', 'A plant extract given to induce vomiting.', 'ipecac'],
  ['torpor', 'Heavy sluggishness; being unable to rouse yourself.', 'torpid'],
  ['piranesi', 'An engraver famous for prints of vast imaginary prisons with stairs that lead nowhere — De Quincey\'s image for his own dreams.'],
  ['opium-eating', 'Taking opium by mouth as a habit.', 'opium eating'],

  // The Iron Heel — London's political vocabulary
  ['philomath', 'A lover of learning. Everhard\'s audience use it for themselves; the book does not mean it kindly.', 'philomaths'],
  ['magnate', 'One of the industrial rich — in this book, a member of the ruling class itself.', 'magnates'],
  ['agents-provocateurs', 'Infiltrators paid to push a movement into violence so it can be crushed.', 'agent-provocateur', 'agents provocateurs'],
  ['labor-ghetto', 'London\'s term for the walled districts the unskilled workers are confined to.', 'labor-ghettos', 'labour-ghetto'],
  ['grab-sharing', 'Everhard\'s name for profit-sharing — the argument that letting workers keep a slice disguises who took the rest.'],
  ['serf', 'A labourer bound to an estate, unable to leave — the book\'s word for what workers become.', 'serfs', 'serfdom'],
  ['expropriate', 'To take property away from its owner, usually by law.', 'expropriated', 'expropriation'],
  ['asgard', 'The oligarchy\'s pleasure city, named for the home of the Norse gods.'],

  // Wells / London — sea, island and dialect
  ['schooner', 'A small fast sailing ship with two or more masts.', 'schooners'],
  ['dingey', 'A dinghy — a small open boat.', 'dingeys'],
  ['taffrail', 'The rail around the stern of a ship.'],
  ['gunwale', 'The upper edge of a boat\'s side.', 'gunwales'],
  ['hatchway', 'An opening in a ship\'s deck, and the way down through it.', 'hatchways'],
  ['staghound', 'A large hound bred to run down deer.', 'staghounds'],
  ['canebrake', 'A dense thicket of cane.', 'canebrakes'],
  ['kanaka', 'A Pacific Islander working as a labourer on a ship or plantation — a period term, and a demeaning one.', 'kanakas'],
  ['ambuscade', 'An ambush.', 'ambuscades'],
  ['quoits', 'A game of throwing rings over a peg.'],
  ['granser', 'Grandfather, in the dialect the survivors\' grandchildren speak.', 'grandsire'],
  ['vivisected', 'Operated on while alive.', 'vivisect'],

  // We — Zamyatin's institutional vocabulary
  ['unif', 'The uniform every citizen of the One State wears, identical to everyone else\'s.', 'unifs'],
  ['mephi', 'The name of the resistance beyond the Green Wall.', 'mephis'],
  ['well-doer', 'The translated title of the One State\'s ruler — the Benefactor.', 'well-doers'],
  ['vomitory', 'A passage in and out of a tiered hall, as in a Roman amphitheatre.', 'vomitories'],
  ['phono-lecture', 'A recorded lecture played to a hall, delivered by machine rather than a person.', 'phono-lecturer', 'phono-lectures'],

  // General reading friction, second sweep
  ['incontinently', 'At once, without delay. It has nothing to do with the modern medical sense.'],
  ['withal', 'Besides; as well.'],
  ['durst', 'Dared.'],
  ['perforce', 'Necessarily; because there was no choice.'],
  ['wherefore', 'Why, or for which reason.'],
  ['forbear', 'To hold back from doing something.', 'forbore', 'forbearance'],
  ['smote', 'Struck.', 'smite', 'smitten'],
  ['publick', 'An old spelling of "public".'],
  ['valise', 'A small travelling case.', 'valises'],
  ['livery', 'The uniform a household\'s servants wear, in its owner\'s colours.'],
  ['drawing-room', 'The room a household received guests in.', 'drawing room', 'drawing-rooms'],
  ['rapier', 'A light thrusting sword.', 'rapiers'],
  ['wench', 'A young woman — familiar at best, insulting at worst.', 'wenches'],
  ['rabble', 'A crowd, spoken of with contempt.'],
  ['nether', 'Lower.'],
  ['antediluvian', 'From before the Biblical Flood; impossibly old-fashioned.'],
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
