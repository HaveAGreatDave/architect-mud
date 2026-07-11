// Drug-war plugin regression suite — run by tests/regress.js (never in production).
// Drives the PURE turf-move decision so every branch is deterministic and there
// are NO DB side effects (the live tick just applies computeTurfMove + emits).
import { computeTurfMove, ZONE_HOLDER, DRUGWAR_ZONES, isDrugWarZone, architectDelta } from './index.js';

export default async function regress({ check }) {
  const row = (over = {}) => ({ zone_id: 'zone_district_912_909', org_id: 'faction_franchise', influence: 60, challenger_org_id: null, ...over });
  const never = () => 1;   // rng that never triggers a challenge
  const always = () => 0;  // rng that always triggers a challenge

  // Guard: a zone held by nobody, or by a player corp, is left alone.
  check('unclaimed zone → untouched', computeTurfMove(row({ org_id: null }), 'faction_franchise') === null);
  check('player-corp-held zone → untouched', computeTurfMove(row({ org_id: 'corp_players' }), 'faction_franchise') === null);

  // Uncontested NPC hold consolidates toward 100, bounded by CONSOLIDATE (=4).
  const con = computeTurfMove(row({ influence: 60 }), 'faction_franchise', never);
  check('uncontested consolidates by +4', con.influence === 64, `influence=${con?.influence}`);
  check('uncontested consolidation drew no challenger', con.challenger_org_id === null);
  check('influence clamps at 100', computeTurfMove(row({ influence: 99 }), 'faction_franchise', never).influence === 100);

  // A rival can make a play on an uncontested zone (rng always) — challenger is a rival, never the holder.
  const play = computeTurfMove(row({ influence: 60 }), 'faction_franchise', always);
  check('rival makes a play (challenger set)', !!play.challenger_org_id);
  check('challenger is not the controller', play.challenger_org_id !== 'faction_franchise');

  // A zone held by a NON-natural faction gets challenged by its home faction (reclaim path).
  const reclaim = computeTurfMove(row({ org_id: 'faction_breakers', influence: 70 }), 'faction_franchise', always);
  check('home faction pushes to reclaim its turf', reclaim.challenger_org_id === 'faction_franchise', `challenger=${reclaim?.challenger_org_id}`);

  // Contested zone erodes toward a flip, bounded by ERODE (=6), no flip while grip remains.
  const ero = computeTurfMove(row({ influence: 50, challenger_org_id: 'faction_breakers' }), 'faction_franchise');
  check('contested erodes by 6', ero.influence === 44, `influence=${ero?.influence}`);
  check('contested (grip remains) does not flip', ero.flipTo === null);

  // Grip at/below the erode step flips the zone to the challenger at START_INFLUENCE (=50).
  const flip = computeTurfMove(row({ influence: 4, challenger_org_id: 'faction_breakers' }), 'faction_franchise');
  check('grip ≤ erode → flips to challenger', flip.flipTo === 'faction_breakers', `flipTo=${flip?.flipTo}`);
  check('winner inherits START_INFLUENCE', flip.influence === 50);
  check('flipped zone clears its challenger', flip.challenger_org_id === null);

  // Zone universe sanity — the three districts are covered, spawn/hub stay neutral.
  check('drug-war zones cover all three districts',
    isDrugWarZone('zone_district_912_909') && isDrugWarZone('zone_mq_pigeon_bar') && isDrugWarZone('zone_district_908_908'));
  check('spawn + safe hub are NOT drug-war zones', !isDrugWarZone('zone_start') && !isDrugWarZone('zone_district_918_904'));
  check('every drug-war zone has a natural holder',
    DRUGWAR_ZONES.every(z => ['faction_franchise', 'faction_breakers', 'faction_glitch'].includes(ZONE_HOLDER[z])));

  // Invisible Architect-alignment ledger: buying from a faction's dealer pushes
  // you their way; killing their people pushes you the other. Pro-Architect
  // factions read positive, the anti-tech Breakers negative.
  check('buying from the Glitch pulls toward the Architect', architectDelta('faction_glitch', true) === 2);
  check('buying from the Breakers pushes away from the Architect', architectDelta('faction_breakers', true) === -2);
  check('killing a Breaker pulls toward the Architect', architectDelta('faction_breakers', false) === 2);
  check('killing a Glitch pushes away from the Architect', architectDelta('faction_glitch', false) === -2);
  check('the Franchise reads as a mild Architect-license lean', architectDelta('faction_franchise', true) === 1);
  check('a stance-less faction gives no signal', architectDelta('faction_archivists', true) === 0);
}
