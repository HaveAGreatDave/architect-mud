# Cluster Puck in GLASS 2

**Status: design. Nothing is built.** A plan for giving Rinkside what Deadball got in
[deadball-glass2.md](deadball-glass2.md): skinned players with keyed motion, a lit barn with a crowd
in it, a broadcast graphics package, and a sound bank to match. It comes after
[cluster-puck-free-play.md](cluster-puck-free-play.md), which has the server play each featured game
and Rinkside play it back, and it sits beside [cluster-puck-ai.md](cluster-puck-ai.md), which covers
how the men decide what to do and how a person takes over a team.

Read with [systems-broadcast.md](../systems-broadcast.md#the-rink-sub-screen-rinkside-as-built)
(Rinkside as built), [systems-hockey-sound.md](../systems-hockey-sound.md) (the current soundset),
[slush-fund.md](slush-fund.md) (the barn, Golden Goose Gardens) and [glass-notes.md](../reference/glass-notes.md) (GLASS 2's
traps).

## Decided on 2026-10-18

- **The look:** a modern TV broadcast, today's network hockey look. Not Deadball's 1990s arcade
  presentation.
- **Motion:** procedural skating, with keyed clips layered over it for everything else.
- **The barn:** one barn, Golden Goose Gardens, the league's own, dressed for the home club. The booth stops describing a
  club's own barn, but still nods to home ice now and then, lightly.
- **Home ice in the sim:** an invisible momentum meter in the manner of NBA Jam, which helps the side
  that's behind and holds back the side that's ahead, with a lean to the home side. It belongs to
  [the AI plan](cluster-puck-ai.md#momentum); nothing on screen shows it.
- **Sound:** a new high-fidelity bank to match the picture. The NHL '96-style FM set stays as a
  setting.
- **Violence:** more graphic than today.
- **People playing, later:** one person controls a whole team and switches between men, as in NHL '94
  head to head. Two people a game.

## The short version

- **Players:** one skinned body per role (skater, goalie, official) on Deadball's GPU skinning, at
  about 15,000 triangles up close and 6,000 at broadcast distance, with the street-figure heads, kit
  from the club seam, twill numbers and fabric in normal maps, and a damage mask that shows the game
  on a man's face and sweater.
- **Motion:** the rink's procedural skating drives the legs and hips. Shots, passes, checks, punches,
  saves, celebrations and injuries are clips keyed in the Pose Lab and layered over the upper body,
  with short wind-ups that can be cut off, because a person will be driving these men one day.
- **The barn:** Golden Goose Gardens built from a venue record: the bowl, KSAB's gantry, a centre-hung
  videoboard, a ring of lights over the ice, boards and glass, benches and boxes. The home club
  dresses it each night.
- **The picture:** clean, bright broadcast HD. The arena's lights cast real shadows, the ice keeps
  the game as it does now at higher resolution, and a home goal sets off a light show.
- **The graphics:** a slim modern score bug, glass-panel lower thirds with a live portrait of the
  man, goal and penalty cards, a fight's tale of the tape, intermission stat panels, tracking
  readouts (shot speed, a breakaway's speed), and replays with the play drawn on the ice.
- **Sound:** a high-fidelity SIREN bank (skates, stick, puck, boards, glass, crowd, horn, organ and
  the PA) under the announcer, mixed as Deadball's is. The '96 set is a viewer setting.
- **Violence:** cuts, a broken nose, blood that pools and gets skated through, severed limbs with
  ends to them, and injury motion: a man clutching what's hurt.
- **The shape:** Rinkside's, unchanged: the same view shell, the same camera, replays and governor,
  and the 2-D renderer as the fallback.

## What exists today

### Rinkside

Bodies are rebuilt on the CPU every frame from a 21-joint procedural rig: about 1,000 triangles at
broadcast distance and 2,000 close up, with gauntlets, a ridged helmet, shoulder caps, a curved
blade and a goalie's trapper in the close detail. Heads are the street figures' with their faces,
under a helmet with a cage or a visor, and each keeper wears a mask moulded to his head with his
club's art on it. Jerseys are slots in a 1024² atlas. The ice is a painted canvas that keeps every
stroke, stop and smear, reflected through a mirrored camera. The lit shader is one key light, a
hemisphere and a Blinn-Phong highlight, with no shadows, HDR or ambient occlusion. The camera is
NHL 99's high near-side framing, solved so the puck and the net stay in shot. There's an instant
replay, a glow puck, a fullscreen button (`view-fullscreen.js`) and a 2-D renderer for browsers
without WebGL2. The HUD asks for Saira Condensed, which the client doesn't ship, so it falls back to
Arial Narrow.

### What Deadball built that hockey can use

| Piece | What it does | For hockey |
|---|---|---|
| [gl/skin.js](../../client/game/js/panels/gl/skin.js) | GPU skinning from a palette texture of bone transforms | Every body on the ice |
| [diamond/rig.js](../../client/game/js/panels/diamond/rig.js) | A pose language solved by IK, 22 bones, a bat held in two hands | The skeleton, with the stick held as the bat is |
| [diamond/anim.js](../../client/game/js/panels/diamond/anim.js), `clip-schema.js`, `bake-clips.mjs` and the Pose Lab | Keyed clips as content, baked, sampled on curves, with contact moments | The upper-body library |
| [gl/spotshadow.js](../../client/game/js/panels/gl/spotshadow.js) | Shadows from several spotlights at once | The light ring over the ice |
| [gl/crowd.js](../../client/game/js/panels/gl/crowd.js) | An instanced crowd that sits, stands and cheers by the roar | The bowl |
| `gl/hdr.js`, `gl/ssao.js`, `gl/spectacle.js` | The float target, bloom, the tone curve, occlusion, additive effects | The picture and the goal light show |
| [diamond/quality.js](../../client/game/js/panels/diamond/quality.js) | Tiers and a governor that steps down when frames come slow | The same rungs, retuned |

### What hockey needs that baseball didn't

Skating: locomotion that's continuous, fast and on edges, with feet that glide by design. Contact at
speed between bodies, and with the boards and the glass. A stick that's always in play and always
in contact with the ice or the puck. Goalies who drop and recover in a fraction of a second. Fights.
Twelve men moving at once, all the time.

## The look: a modern broadcast

Two layers, as in Deadball's plan: the game drawn as well as the engine can draw it, and a
presentation around it in the manner of a modern network hockey broadcast. Every graphic is
original; nothing copies a network's or a league's marks.

### The graphics package

- **The score bug:** a slim bar at the bottom of the picture. Each club's crest and three-letter code
  in its colour, the score, the period and its clock, shots on goal, and the strength: a power play
  shows the man advantage and its clock, an empty net shows as such. The rivalry chip stays. A goal
  bumps the score, and a penalty slides its strip out of the bar. It keeps the network's tag as its
  header: the KSAB-7 Sports package being built for both shows (the tag over the bug, the opens and
  the themes, in the sports section of [systems-broadcast.md](../systems-broadcast.md)) is the frame
  this package sits in, not something it replaces.
- **Lower thirds:** frosted glass panels with a live portrait of the man (his head from the
  generator, lit), his number, position and season line. They go up at stoppages, never over a
  rush.
- **The goal:** no card over the celebration, as now; the lamp, the horn and the light show carry
  it. After the replay, a lower third names the scorer, the assists and his goals this season.
- **Penalties:** the man, the infraction and the minutes, with the power play's clock in the bug.
- **Fights:** a tale of the tape as they square up: fights and penalty minutes this season, counted
  from the league's games the way the scoring race is. The health bars stay.
- **A death:** a plain black panel with the name and number, and nothing else.
- **Intermissions:** full-screen stat panels over the Zamboni: shots by period, the scoring
  summary, faceoffs, hits, penalty minutes, casualties. The numbers are counted from what aired, as
  now.
- **Tracking:** the shot's speed on a hard one, a breakaway man's speed, and the glow puck as a
  viewer's option, as now.
- **Replays:** the pass and the shot drawn on the ice in the replay, the way a broadcast's
  telestrator does, and the league's wipe in and out, as now.
- **Standings and leaders:** the same panels, between periods and before the drop.
- **Type:** Big Shoulders Display (shipped) for names and numbers, and Saira Condensed (OFL, to be
  shipped) for labels.
- **Motion:** quick slides and wipes, a quarter of a second or so. Reduced motion turns them into
  cuts.

### The cameras

- **The game camera** is the current one: high on the near side, side-on, solved to keep the puck
  and the net in shot. Modern broadcasts frame hockey the same way, so it stays.
- **The vertical camera** (built) is the NHL 96 one, a toggle on the picture beside the glowing puck: high and steep behind the play, the ice's width across the screen and its length running up it. It's the camera's one yaw (`view = 'vertical'`, in rink/camera.js), so only GLASS 2 draws it; the 2-D fallback shows the broadcast view.
- **At stoppages** the picture cuts close: the scorer and the bench fly-by, the goalie, the man in
  the box, the bench, the crowd.
- **Replays** come from the in-net camera, the high end-zone camera and an overhead, in slow motion.
- **Fights and deaths** keep their own framings.

### The picture

Bright, clean HD. HDR with a filmic tone curve, bloom only on what's actually bright (the lamp, the
horn's lights, the videoboard), ambient occlusion under the bodies and along the boards, and a long
lens's depth of field only on the close cameras at stoppages. No period effects. Golden Goose
Gardens' ice has been slush since the ownership change, so the sheet reads wet and grey even on a modern
broadcast, and it chops up faster than good ice would.

## Models

### Players

- **One body per role.** Skater, goalie and official, each one topology with blend shapes for build
  chosen from the name, built and skinned the way the ballplayers are, at about 15,000 triangles for
  the close cameras, 6,000 at broadcast distance and 1,500 far off.
- **Skaters:** the sweater with its fight strap, cut loose over the shoulder pads; pants with the
  club's stripe; socks with bands over the shin pads; skates with the boot, the tendon guard, the
  holder and the steel; gauntlets; a helmet with a visor or a cage, chosen from the name, with the
  club's decal; the stick with its tape.
- **Goalies:** pads, blocker, trapper, the chest and arm protector, wide pants, and the mask that
  exists now, with its club art, carried over.
- **Officials:** striped sweaters, the referees' orange armbands, helmets, whistles.
- **Kit:** from the club seam, as now: home colours at home, white on the road. Twill numbers and
  names, the sweater's mesh and the crest's stitching as normal maps.
- **Heads and faces:** the street-figure heads, as now, at all three levels. The close cameras and
  the lower thirds' portraits are where the faces have to hold up.
- **The damage mask:** a per-man mask over the face, the sweater and the gloves, raised by hits,
  fights and injuries, the way Deadball's dirt mask is raised by slides. A man who fought in the
  first is still cut in the third.

### The barn

Golden Goose Gardens, built from a venue record by a new `gl/barn-mesh.js` the way
`ballpark-mesh.js` builds the park: the seating bowl, KSAB's gantry over the ice, the centre-hung
videoboard, the ring of lights, the boards with their dasher ads, the glass (panels that flex and
shatter, as now), the benches, the boxes, the Zamboni's gate, and the rafters. The fixtures the
booth's general chatter pool names are there to be seen: the goal judge's booth with the lamp,
section nine and its man, the frank stand. The clubs' shields hang on the east stand, as they do in
the building on the map (`client/shared/cphl-crests.js`). The building's scoreboard is a television
tuned to channel 7, so the videoboard shows KSAB's own picture.

**Home dress** for each night: the home club's colours on the videoboard and the ribbon boards round
the bowl, its crest on the boards, its shield on the east stand lit, its bench nearest the camera,
its banners hung for the night, a crowd mostly in its colours, its horn (the horns are per club
already), and a goal light show in its colours. Centre ice is an open question below.

### The ice

The painted canvas stays: it's the part of the rink that most shows a game being played. It goes to
4096² on the full tier (2048² otherwise), gains roughness and wetness maps so slush and fresh flood
read differently under the lights, and reflects at full resolution on the full tier.

## Animation

- **The skeleton:** Deadball's pose language and bones, with the stick held in two hands the way
  the bat is, and the skates as feet that glide along their blades.
- **Locomotion is procedural.** The rink's strides, crossovers, stops, glides and backward skating
  (rink/rig.js's cadence and stride) drive the pose's feet and hips. It responds at once and always
  fits the speed the man is going.
- **Everything else is keyed** in the Pose Lab and layered over the upper body:
  - *shots:* wrist, snap, slap, one-timer, backhand, tip, wraparound, each with the release moment
    the sim already uses (`releaseAt`);
  - *passes:* forehand, backhand, saucer, drop; receiving on the forehand and the backhand;
  - *carrying:* stickhandling, dekes, protecting the puck;
  - *contact:* shoulder, hip, from behind, into the glass; taking a hit, which hands the man to the
    ragdoll as now;
  - *fights:* grabbing on, jabs, uppercuts, the sweater pulled over, the takedown;
  - *goalies:* the butterfly, glove and blocker saves, the pad stack, the poke check, playing the
    puck;
  - *celebrations:* the fist pump, the knee slide, the bench fly-by;
  - *injuries:* clutching a knee, a face, a stump; rolling on the ice; the stretcher lift;
  - *between plays:* the faceoff stance and the draw, the walk to the box, coming over the boards.
- **Wind-ups that can be cut off.** A clip's commitment before its contact moment is short, and a
  clip can be abandoned before it, so a person's input can take over a man mid-motion later.
- **IK for every contact:** the blade on the puck at release, both hands on the stick, the skates on
  their edges, the fists in a fight.
- **From the track:** the server's chunks carry an action code per man ([free play](cluster-puck-free-play.md#the-picture)),
  and the client picks the clip and lays it on.

## Lighting

A ring of lights over the ice, as a modern arena has: bright and even, four banks casting soft
shadows on the full tier and two on the phone tier (`spotshadow.js`). The ice's highlights streak
from the same banks, as they do now. On a home goal the bowl dims and the lights run through the
club's colours for a few seconds. The crowd is lit from the ice and the ribbon boards.

## Sound

A new bank, built the way Deadball's is ([systems-deadball-sound.md](../systems-deadball-sound.md)):
procedural SIREN cues, no samples, mixed under the announcer and ducked while he speaks.

- **On the ice:** strides that change with speed, a hard stop's spray, the puck on the blade, passes
  by kind, each shot by type, the slapshot's crack, the puck off the boards, the glass and the post,
  bodies into the boards, glass that flexes and breaks, sticks breaking.
- **The building:** a crowd that follows the play and leans to the home side (louder for the home
  club, boos for the visitors' penalties drawn), the per-club horn kept from today's seeds, an organ
  between whistles, and a PA announcer for goals and penalties in an ORACLE voice of his own.
- **The '96 set** stays whole, as a viewer setting next to the new bank.

## Violence

More graphic than today, as decided:

- **On the body:** cuts and bruises on faces that stay for the game, a broken nose that stays broken
  for his injury span, blood down the face and on the sweater's front and the gloves (the damage
  mask).
- **On the ice:** blood that pools, spreads and gets skated through and smeared across the sheet
  (the canvas already takes blood); teeth after a fight; a stick snapped in two.
- **Severed limbs** come off with modelled ends, with a spray for a few seconds and a man who goes
  down and then clutches what's left, rather than lying still.
- **A death** stays where it fell: the body doesn't twitch, the pool spreads, the players kneel and
  take their helmets off, the crowd goes quiet and the colour drains, as now.

The booth's lines already describe all of it, so the text stays complete for anyone who isn't
watching the picture.

## The barn's chatter

The booth's `chatter.<club>` pools in `data/scripts/hockey.bsm` describe each club's own building:
31 lines across eight pools, three to six each. With one barn on screen they get rewritten. Lines
about a club's crowd and its habits stay as nods to home ice ("half this crowd came straight off a
shift" is about the Wharf Rats' fans, not a building). Lines about a building of its own (the
Waterfront barn's flood line, the cranes heard through the roof) go. A few new lines nod to the home
crowd and the home bench, lightly. The general `chatter` pool describes Golden Goose Gardens and stays.

Two docs change with it: [slush-fund.md](slush-fund.md) says every club plays at its own barn, and
the clubs section of [systems-broadcast.md](../systems-broadcast.md#hockey-specifics-as-built)
describes the barn pools.

## People playing, later

[The AI plan](cluster-puck-ai.md#people-in-the-seat) has the design. What it asks of the picture:

- a marker under the man a person is driving, in his club's colour, and a quick cue when the control
  switches to another man;
- the same game camera, which already follows the puck and so the man who has it;
- input from the keyboard or a gamepad;
- motion that a person's input can interrupt, which the wind-ups above allow for.

## Performance

Deadball's tiers and governor, retuned: about seventeen skinned bodies at broadcast distance (about
100,000 triangles), the crowd instanced, four shadow maps on the full tier. The governor steps down
through the same kinds of rung: resolution, the reflection's size, shadow banks, occlusion, the
crowd's share, then the bodies' level of detail. The 2-D renderer stays as the floor, and Rinkside
starts releasing its GL context when it's closed and stops drawing while hidden, which Deadball's
plan noted it didn't.

## Gates

- `arena-smoke` grows to the skinned bodies: every role, kit and body state builds finite and inside
  its triangle budget, and the skin's CPU sum matches the rig.
- A hockey clip smoke on the pattern of `anim-smoke`: the blade within an inch of the puck at
  release, both hands on the stick, no foot slipping sideways off its edge (gliding along the blade
  is allowed), fists on target in a fight.
- The barn through `shapes:smoke`'s pattern: the venue builds, home dress for all eight clubs.
- The rink smoke as reworked for playback in the free-play plan.

## Phases

The order follows the free-play plan: the visual work starts once Rinkside plays back the server's
game (free-play Phase 4), because the clips are picked from the track's action codes.

- **Phase 0: look-dev.** Renders of a skater close up, the broadcast frame with the score bug, a
  lower third with a portrait, and the home goal's light show. Rinkside measured on an integrated GPU
  and a phone.
- **Phase 1: the picture.** Rinkside on the HDR chain, the light ring's shadows, the crowd from
  `crowd.js`, context release and hidden-tab pause.
- **Phase 2: bodies.** The hockey skeleton and the skinned skater, goalie and official, moved by the
  procedural motion through the new skeleton, with kit from the club seam.
- **Phase 3: clips.** Shots and passes first, then contact, saves, fights, celebrations and injuries.
- **Phase 4: the barn.** The venue record, `barn-mesh.js` and home dress.
- **Phase 5: the graphics package.** Bug, lower thirds, cards, panels, tracking, telestrated replays,
  and Saira Condensed shipped.
- **Phase 6: sound.** The new bank and its mix, and the '96 set as a setting.
- **Phase 7: violence.** The damage mask, pooling blood, the severed ends and the injury clips.
- **Phase 8: the chatter and the docs.** The barn pools rewritten and the two docs updated.

## Risks

- **The art and the animation are the work**, as they were for Deadball: a skeleton, the bodies,
  about 60 keyed clips and their contact moments.
- **Skating on a pose language built for baseball.** Deadball's rig plants feet; a skater's glide
  along his edges is new to it, and its tests have to allow for it.
- **Phones.** Seventeen skinned bodies, four shadow maps and a crowd have to be measured on an
  integrated GPU and a phone before the new view goes on by default.
- **Graphic close-ups.** Wounds on faces are seen in close-ups and portraits; the faces have to hold
  up there first.
- **Two soundsets** to keep working instead of one.
- **The barn's lore changes.** The booth and two docs say each club has its own barn; Phase 8 has to
  catch every place that does.

## Questions for you

1. **Centre ice:** the home club's crest, the CPhL mark (as now), or both?
2. **Visor or cage:** chosen per man from his name (recommended), all cages, or all visors?
3. **The organ and the PA:** in the new bank (recommended), or the crowd alone?
4. **The '96 set:** only a viewer setting, or also a scheduled retro night on air, when the whole
   broadcast goes back to it?
5. **The videoboard:** KSAB's picture on it (recommended, since the building's scoreboard is a
   television on channel 7), or the barn's own graphics?
6. **How graphic:** the list under *Violence* is the proposal. Is there anything on it to leave out,
   or anything missing?
7. **The theme:** the network's CPhL theme is FM, like today's rink. With the new bank, keep it as
   the open (recommended, since it's the network's), or score a version for the new sound?
