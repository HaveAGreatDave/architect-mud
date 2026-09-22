// interactions plugin regression suite — run by tests/regress.js, never loaded in production.
//
// WHY THIS EXISTS. This plugin declares twenty-three verbs — every posture in the game, every
// emote, `follow`, `watch`, `lean` and `examine` — and until now not one of them was exercised
// anywhere. A sweep of the whole tree found `kneel`, `stretch`, `shrug`, `nod`, `dance`, `pace`,
// `lean` and `reflect` appearing zero times in tests/regress.js and zero times in any other
// plugin's suite. The manifest sweep in layer 2 proves each verb is REGISTERED; nothing proved
// any of them did the right thing when you typed it.
//
// What is asserted here is deliberately the CONTRACT rather than the prose. The lines are content
// and will be rewritten; the four things below are what everything else in the game reads.
//
//   1. posture is a state, not a message. `sit`/`kneel`/`lie`/`stand` have to move
//      `player.posture`, because HP regen, stand-up triggers, scavenging, fishing and mining all
//      gate on it and none of them can see an emote line.
//   2. an emote is TWO different sentences. The self line is second person and the room line is
//      third; collapse them and every player in the room reads "You wave" about somebody else.
//   3. a refusal is a refusal, not a crash and not a success. Sitting on something that is not
//      there has to come back as a line, and must not move posture.
//   4. `follow` with nothing to follow says so rather than erroring, and clears itself.
//
// ⚠ IT STANDS THE PLAYER BACK UP AT THE END, and that is not tidiness — `disarm()` in
// tests/regress.js reports `posture=<x>` as a LEAK and hands it to whichever suite runs next, so a
// suite that sits down and walks away reddens somebody else's cases for reasons that name nothing
// to do with postures.
import { getPosture } from '../../server/engine/posture.js';

const NOT_FOUND = /unknown command/i;
const SECOND_PERSON = /\byou\b/i;

export default async function regress({ run, check, getPlayer }) {
	const player = getPlayer();
	const handle = player.handle;

	// ── 1. posture is a state ──────────────────────────────────────────────────
	// Bare `sit` with no furniture named sits you on the floor, which is the branch
	// every other posture verb shares.
	for (const [verb, want] of [['sit', 'sitting'], ['kneel', 'kneeling'], ['lie', 'lying'], ['stand', 'standing']]) {
		const r = await run(verb);
		check(`${verb}: routes to this plugin`, r && !NOT_FOUND.test(r.message || ''), JSON.stringify(r)?.slice(0, 120));
		check(`${verb}: moves posture to ${want}`, getPosture(player) === want, `posture=${getPosture(player)}`);
	}

	// Standing again from standing must not error — a verb people type twice.
	const again = await run('stand');
	check('stand: standing while already standing is not an error', again?.type !== 'error', JSON.stringify(again)?.slice(0, 120));
	check('stand: posture is still standing afterwards', getPosture(player) === 'standing', getPosture(player));

	// ── 2. an emote is two sentences ───────────────────────────────────────────
	// The reply is the SELF line. It has to read as second person, and it must never
	// carry the player's own handle — that is the room's copy, and the two crossing
	// over is the failure this catches.
	const EMOTES = ['wave', 'shrug', 'smile', 'frown', 'laugh', 'cry', 'sigh', 'nod', 'shake', 'dance', 'stretch', 'point'];
	for (const verb of EMOTES) {
		const r = await run(verb);
		const msg = r?.message || '';
		check(`${verb}: answers with a line`, !!msg && !NOT_FOUND.test(msg), JSON.stringify(r)?.slice(0, 120));
		check(`${verb}: the self line is second person`, SECOND_PERSON.test(msg), msg.slice(0, 80));
		check(`${verb}: the self line does not carry the room's copy`, !msg.includes(handle), msg.slice(0, 80));
	}

	// An emote must not move posture — `dance` and `stretch` read like they might.
	check('emotes: none of them moved posture', getPosture(player) === 'standing', getPosture(player));

	// ── 3. a refusal is a refusal ──────────────────────────────────────────────
	const nonsense = await run('sit on frobnicator');
	check('sit: naming something that is not here comes back as a line',
		!!nonsense?.message && !NOT_FOUND.test(nonsense.message), JSON.stringify(nonsense)?.slice(0, 120));
	check('sit: …and the refusal names what was asked for',
		/frobnicator/i.test(nonsense?.message || ''), (nonsense?.message || '').slice(0, 90));
	check('sit: …and a refused sit leaves you standing',
		getPosture(player) === 'standing', getPosture(player));

	const nobody = await run('wave at frobnicator');
	check('wave: waving at nobody is an error naming them',
		nobody?.type === 'error' && /frobnicator/i.test(nobody?.message || ''), JSON.stringify(nobody)?.slice(0, 120));

	// ── 4. follow says what it is doing ────────────────────────────────────────
	// ⚠ ASSERTED FROM A KNOWN STATE. `following` is not in disarm()'s list, so an
	// earlier suite could in principle leave one set; clearing first is what makes
	// the "aren't following anyone" case mean what it says.
	await run('follow');
	const idle = await run('follow');
	check('follow: with nobody followed, it says so rather than erroring',
		idle?.type === 'output' && /follow/i.test(idle?.message || ''), JSON.stringify(idle)?.slice(0, 120));

	const ghost = await run('follow frobnicator');
	check('follow: an unknown name is an error naming them',
		ghost?.type === 'error' && /frobnicator/i.test(ghost?.message || ''), JSON.stringify(ghost)?.slice(0, 120));
	check('follow: a failed follow leaves you following nobody',
		!getPlayer().following, String(getPlayer().following));

	// ── 5. examine belongs to this plugin ──────────────────────────────────────
	// ⚠ THREE THINGS DECLARE `examine`: the engine builtin, `plugins/flight` and this.
	// Plugins beat builtins and `flight` declares `after: [… interactions …]`, so
	// flight is the live owner in a cockpit and this one everywhere else. What is
	// asserted is only that the verb answers on the ground — which owner wins is
	// settled by the loader and by plugins.md, not here.
	const ex = await run('examine');
	check('examine: answers on foot rather than falling through to Unknown command',
		!!ex && !NOT_FOUND.test(ex.message || ''), JSON.stringify(ex)?.slice(0, 120));

	// ── leave the fixture as we found it ───────────────────────────────────────
	await run('stand');
	check('teardown: the player is left standing', getPosture(player) === 'standing', getPosture(player));
}
