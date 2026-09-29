# submersible

The Drake goes under. A salvage frontier on a procedural seabed.

## Verbs

- `submerge`: go down to 5 m (or the bottom, if shallower). `submerge <metres>` trims to a depth, `submerge floor` sits her just off the bottom, and a bare `submerge` while under reads the gauges.
- `surface`: blow the ballast. Taking BOAT on the mode selector sends it; nothing else in the cockpit surfaces her. Flown up on the planes she holds at 1 m (`SUB_CEIL`) rather than broaching. Running out of air or drifting over a shoal still forces her up.
- `sonar`: the bottom under her and what is lying on it within 20 tiles, as bearings and ranges. Works on the surface too.

`dive` is flight's nose-down verb, which is why this one is `submerge`.

## How it works

- The seabed is `client/shared/seabed.js`, one deterministic function of position. Nothing is stored. The gate is `npm run gl:seabed`; the picture is `/seabed.html` in the Modelshop.
- `sub.js` is the dive as pure arithmetic: five hull tiers (25 m to 1100 m, 4 to 18 minutes of air), descent and ascent rates, air warnings, the emergency blow, and crush damage past the rating.
- **The air supply belongs to the Drake, not to the dive.** A dive starts with what is in the tanks and spends it; they refill only while she is up (not submerged) and her engine is running, full from empty in 90 s. She will not go under below 15%. The figure lives in RAM (`live.subAir`) and is banked to `custom_data.sub_air`, so a restart does not hand out full tanks. `sonar` shows it on the surface.
- `index.js` reads the live aircraft from `plugins/flight/state.js`, steps every submerged Drake once a second, and narrates. Crush is ordinary `row.damage`; at 1 it is flight's `crash(live, 'imploded')`.
- The client is told with a `drake_sub` message, and `drake-water.js` puts her in a `submerged` phase: in SUB mode the tail rotor drives her (up to 14 kt), and no wave touches her. She can only dive from BOAT mode, in 3 m of water or more.

State is RAM only. A restart surfaces every Drake.

## Not built yet

- The rendered underwater view (phase 3).
- Salvage from wrecks, lift bags, underwater rooms for divers, fauna, and the Sub Standard yard where hulls are refitted.
- **What lives in the Deep.** The water is built (below); what happens in it is not. The intent is that it is SEEDED DETERMINISTICALLY off position the way the seabed and the wrecks are — events, scavenging, monsters and the rest, the specifics still to be decided — so two players diving the same spot meet the same things and nothing has to be stored.

## The Deep

A tile with no zone is open sea when it lies north of a column whose northernmost authored tile is water (`isLandTile` in index.js). That is the renderer's own off-map rule (windshield.js `fillOffMap`), so the sea you see past the bay is the sea the seabed is measured against. Shore distance then grows past the harbour mouth and seabed.js's shelf and drop-off appear on their own: about 5 m at the harbour edge, 20 m six tiles out, the 42 m shelf by 28 tiles, and 800 m and more past 40. The client's copy of the rule is the render LUT (seabed-scene.js `landFromLUT`), so the two must change together.
