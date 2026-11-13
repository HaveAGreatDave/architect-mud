# The Subject Pool: the tests (source)

Repeating, optional job. Clones volunteer for random weighted tests for low pay. The player does not choose the test.
Death here costs nothing beyond what the player was carrying; normal respawn rules apply. Balance comes from low pay, random selection and the escalating cooldown.

## Fields

- **weight**: relative roll chance
- **unlock**: min prior visits before the test can roll (0 = always)
- **pay**: base credits; hazard bonus added per outcome
- **rounds**: timed text beats (~8–15s apart). `{name}` = clone name, `{id}` = clone ID
- **prompts**: optional verbs during rounds (`endure`, `scream`, `comply`); each shifts outcome odds
- **outcomes**: rolled after the last round; base %, modified by prompts
- **finding**: cryptic line appended to the player's subject file

## Intake

**Content warning** (shown until the player types `volunteer confirm` once):

> [18+] The Subject Pool contains graphic body horror, medical procedures, mutilation, and death. It is entirely optional and not required for progression. Type `volunteer confirm` to proceed, or take the elevator back up.

**Sign:** A laminated sign is zip-tied to the freight elevator gate: COMPENSATED WELLNESS STUDIES. NO EXPERIENCE NECESSARY. CONTINUITY OF SELF NOT GUARANTEED.

**Waiver:** The waiver is eleven pages. The type shrinks on each one. By page nine it is a grey smear that might be words. There is a line for your signature. It has already been signed.

**Sign-on stipend:** 5

**Holding room:** White tile, floor to ceiling, with a drain in the center that is slightly too large. A bench bolted to the wall. A speaker grille hums, then doesn't.

**Holding room ambient lines:**

- Somewhere above you, a door closes very gently.
- The drain gurgles once, as if clearing its throat.
- The speaker grille says your clone ID, then says it again, slower.
- You notice the tile grout has been replaced in one patch, recently.
- A tray slides out of the wall. It holds a paper cup of water. It slides back before you can take it.

**Called in:** The far wall unseals with a pneumatic sigh. "Subject {id}. Please proceed."

## Discharge

You are returned to the holding room. Your clothes are folded on the bench, warm, as though someone has been wearing them. A receipt prints from the wall slot.

- Cooldown (minutes, escalating per visit within 24h): 20, 35, 60, 120
- Streak bonus: +10% per consecutive visit, cap 50%

## Tests

### Thermal Tolerance Assessment

`thermal_tolerance` · weight 18 · unlock 0 · pay 30

**Rounds**

1. A steel chair with wrist cuffs that close before you finish sitting. The lights are amber.
2. A panel in the floor slides open. Heat rises through it like breath.
3. The heat climbs. Your skin tightens. The smell of your own hair arrives before the pain does.
4. A voice, pleasantly: "Please indicate your discomfort on a scale of one to ten."
5. The panel closes. Something in the ceiling sprays cold mist. It does not help as much as it should.

**Prompts**

- `endure`: survive +10, hazard +5
- `scream`: finding_chance +25

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 60% | Blistered forearms. Max HP -10% until healed. | `burns_minor` | 10 |
| 30% | Third-degree burns across your back. Max HP -25%; movement messages describe stiffness. | `burns_severe` | 25 |
| 10% | Your clone fails to complete the assessment. | `death` | 0 |

**Finding:** *Thermal threshold within expected range for lineage.*

### Limb Reattachment Viability Trial

`limb_reattachment` · weight 14 · unlock 0 · pay 45

**Rounds**

1. Bright surgical light. Your left arm is strapped to an extension of the table, separate from the rest of you.
2. You are not given anesthetic. You are given a rubber bit.
3. The saw is quiet. That is the thing you will remember: how quiet it is.
4. Your arm is carried out of your sightline. A different tray is wheeled in. The arm on it is not yours.
5. Sutures. A cold paste. A tingling that starts in your shoulder and travels somewhere that doesn't feel like you.

**Prompts**

- `comply`: reattach_own +15
- `endure`: hazard +5

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 45% | Your own arm, reattached. The scar is neat. Fine motor commands occasionally fail for a day. | `arm_numb` | 15 |
| 35% | Someone else's arm. It works. It has a tattoo you don't recognize: a clone ID one digit off from yours. | `foreign_arm` | 20 |
| 15% | No arm. A capped stump and a voucher for 'Limb Restoration Services, Level 2.' | `arm_missing` | 35 |
| 5% | Rejection response. Your clone does not stabilize. | `death` | 0 |

**Finding:** *Graft acceptance noted. Donor-recipient similarity: high.*

### Pharmacological Response Screening

`pharmacological` · weight 20 · unlock 0 · pay 25

**Rounds**

1. A small room with a recliner. An IV is already in your arm. You don't remember sitting down.
2. The fluid in the line is the color of weak tea. It feels cold going in, then very warm.
3. The walls breathe. Just slightly. You decide not to mention it.
4. A clipboard voice asks you to name the objects on a card. There is no card. You name them anyway.

**Prompts**

- `comply`: bonus_effect +20
- `scream`: hazard +10, bad_trip +15

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 40% | Mild sedation. Commands lag for 30 minutes. | `sedated` | 5 |
| 30% | Hallucinogenic residue. Room descriptions occasionally include things that are not there. | `hallucinating` | 10 |
| 20% | Unexpected clarity. +perception for one hour. | `lucid` | 5 |
| 8% | Seizure. You wake on the floor with a tongue that tastes of copper. Max HP -15%. | `seizure_after` | 30 |
| 2% | Respiratory arrest. The recliner tilts back, almost gently. | `death` | 0 |

**Finding:** *Compound 7-series metabolized. Subject retains self-report capacity.*

### Sensory Isolation Endurance

`sensory_deprivation` · weight 12 · unlock 0 · pay 35

**Rounds**

1. A tank of body-warm saline. A lid that seals with a sound like a held breath.
2. Darkness. Not the dark of a room. The dark of nothing having been invented yet.
3. You lose the edges of your body. Then you lose the idea that you had edges.
4. Someone speaks your name from very close by, inside the tank, with you.
5. The lid opens. The light is unbearable. An attendant asks how long you think you were inside. You are wrong.

**Prompts**

- `endure`: hazard +10, finding_chance +20

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 70% | Disorientation. Room descriptions are blank for 5 minutes; only exits shown. | `blank_rooms` | 10 |
| 25% | Dissociation. Your own name is displayed as your clone ID for an hour. | `depersonalized` | 15 |
| 5% | You do not surface. The attendant writes something and closes the lid again. | `death` | 0 |

**Finding:** *Subject reports presence during isolation. Consistent with prior instances.*

### Restraint and Observation

`restraint_observation` · weight 10 · unlock 0 · pay 80

**Rounds**

1. A chair in the center of a mirrored room. Restraints at wrist, ankle, chest, forehead.
2. Nothing happens.
3. Nothing continues to happen. You hear, faintly, someone on the other side of the mirror shifting their weight.
4. Nothing happens for a long time.
5. The restraints release. A voice says: "Thank you. That was very helpful."

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 100% | No injury. No explanation. The highest pay in the pool. | `none` | 40 |

**Finding:** *Observation complete. Subject did not look at the mirror. [annotated: 'again']*

### Nociceptive Mapping

`pain_mapping` · weight 12 · unlock 3 · pay 40

**Rounds**

1. You lie face-down on a table. A grid is drawn on your back in grease pencil.
2. Needles, one per square. Each one is a different kind of wrong: electric, burning, a deep ache like a bruised bone.
3. A voice reads out coordinates. You are expected to rate each one. You rate them. You lose count of how many.
4. Square F-7. You hear yourself make a sound you have never made.

**Prompts**

- `endure`: hazard +10
- `scream`: finding_chance +30

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 85% | Back covered in small punctures. Phantom pain messages fire at random for an hour. | `phantom_pain` | 15 |
| 15% | Nerve damage. One random stat -1 until treated at the infirmary. | `nerve_damage` | 30 |

**Finding:** *Map updated. F-7 response divergent from lineage baseline. Flag for review.*

### Termination Baseline

`termination_baseline` · weight 3 · unlock 5 · pay 120

**Rounds**

1. A clean room with a single bed and fresh sheets. Soft music. A glass of something sweet on the nightstand.
2. The attendant is kind.
3. "This one is simple," they say. "We just need a reference point."
4. The glass is empty. You don't remember drinking it. The music is very far away now.

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 100% | Your clone is terminated. Payment is deposited to your next instance. | `death` | 0 |

**Finding:** *Baseline recorded. Subject {id} is now the reference for this lineage.*

### Continuity Verification

`continuity_check` · weight 1 · unlock 12 · pay 60

**Rounds**

1. A small office. Across the desk sits a clone wearing your face. It has the same scars. It is wearing your clothes.
2. "Please ask each other three questions," the speaker says, "that only you would know."
3. It answers every one of yours. It asks you something about a memory you don't have. It seems disappointed.
4. An attendant leads one of you out. You are not certain, afterward, which one.

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 100% | Discharged without injury. For the next day, a random NPC will greet you as if you had just left. | `doubled` | 20 |

**Finding:** *Continuity verified. Retained instance selected by coin toss.*

### Cryogenic Recovery Interval

`cryo_recovery` · weight 12 · unlock 0 · pay 35

**Rounds**

1. A narrow steel cabinet, like a locker stood on end. Frost already feathers the inside of the door.
2. The door shuts. The cold arrives all at once, a hand closing around every inch of you.
3. Your fingers stop answering. Then your feet. Your thoughts slow until each one takes a full breath to finish.
4. Warm air. Someone is rubbing your hands roughly with a towel and counting under their breath.

**Prompts**

- `endure`: hazard +10, survive -5

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 55% | Frostnip. Typing commands occasionally drops a letter for 20 minutes. | `frostnip` | 10 |
| 35% | Frostbite. Two fingers blackened; carry capacity -1 until healed. | `frostbite` | 25 |
| 10% | Your heart forgets how to restart. | `death` | 0 |

**Finding:** *Rewarming interval acceptable. Lineage tolerates suspension poorly. Noted.*

### Ocular Reflex Battery

`ocular_reflex` · weight 14 · unlock 0 · pay 30

**Rounds**

1. Your head is clamped. Small speculum wires hold your eyelids open. Your eyes begin to burn within seconds.
2. Lights flash in patterns too fast to follow. Then a single point of white so bright it has a sound.
3. Something drips onto your left eye. It feels like sand made of glass.
4. The clamps release. The room swims, smeared and haloed.

**Prompts**

- `comply`: hazard -5, blind -10
- `scream`: blind +10

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 60% | Blurred vision. Room descriptions are truncated to their first sentence for 30 minutes. | `blurred` | 10 |
| 30% | Temporary blindness. You can't `look`; you navigate by exits and sound for 15 minutes. | `blind` | 20 |
| 10% | Permanent damage to one eye. A milky film. Perception -1 until regenerative care. | `eye_damaged` | 35 |

**Finding:** *Pupillary response normal. Subject flinched at stimulus 14. Prior instances did not.*

### Auditory Saturation

`auditory_saturation` · weight 12 · unlock 0 · pay 25

**Rounds**

1. Heavy headphones are fitted over your ears and locked with a small brass padlock.
2. A tone. Pleasant. Then louder. Then a second tone underneath it, slightly off, grinding against the first.
3. Under the noise, faintly, a voice reading a list of clone IDs. Yours is on it. It has been crossed out and rewritten.
4. Silence, so sudden that it rings. Something warm trickles from your ear.

**Prompts**

- `endure`: hazard +5, finding_chance +25

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 65% | Tinnitus. `say` from other players is garbled one word in five for 30 minutes. | `tinnitus` | 10 |
| 30% | Ruptured eardrum. You can't hear `say` at all for 15 minutes; only emotes. | `deafened` | 20 |
| 5% | Something in your inner ear gives way. You fall, and keep falling, and the floor never comes. | `death` | 0 |

**Finding:** *Subject identified own designation in noise floor. Recommend continued exposure.*

### Caloric Deprivation Baseline

`hunger_baseline` · weight 8 · unlock 0 · pay 40

**Rounds**

1. A small room with a cot. On the table: a plate of food under a glass cloche, locked.
2. Hours pass. Or the lights dim as if hours pass. The food does not change. It does not cool.
3. You become aware that the food is a perfect replica, made of wax.
4. A tray slides through the wall: grey paste, one spoonful. A card reads: CONGRATULATIONS.

**Prompts**

- `endure`: hazard +10

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 80% | Weakened. Stamina regenerates at half rate for an hour. | `starved` | 15 |
| 20% | You cracked a tooth biting the wax. Speech emotes slur for 20 minutes. | `cracked_tooth` | 10 |

**Finding:** *Subject attempted to consume control object. Expected.*

### Barometric Decompression Trial

`decompression` · weight 9 · unlock 1 · pay 50

**Rounds**

1. A round chamber with a porthole and a door like a bank vault. It seals with a series of heavy clunks.
2. Your ears pop. Then pop again. Then they stop popping and start hurting.
3. The air thins. Each breath brings in less. Your gums tingle. A fine mist of blood beads from your nose.
4. A hiss, like a sigh of relief that isn't yours. Pressure floods back. Your joints scream as it does.

**Prompts**

- `endure`: hazard +10, survive -5
- `comply`: survive +5

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 55% | The bends. Joint pain; movement costs double stamina for 30 minutes. | `bends` | 20 |
| 35% | Burst capillaries. Your eyes are red-veined; NPCs comment on it. | `bloodshot` | 10 |
| 10% | Something bursts that should not. | `death` | 0 |

**Finding:** *Lineage pressure tolerance within insurable range.*

### Suture Tolerance Exercise

`suture_endurance` · weight 10 · unlock 1 · pay 35

**Rounds**

1. A trainee in a stained apron approaches with a curved needle and a nervous smile.
2. "I'm just practicing," they say, and make an incision along your forearm.
3. They sew it closed. Badly. They unpick it. They try again. And again.
4. A supervisor's voice through the intercom: "Better. Do the other arm."

**Prompts**

- `endure`: hazard +10
- `comply`: trainee_improves +15

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 70% | Two ugly scars. A trainee's initials are visible in the stitch pattern. | `botched_sutures` | 10 |
| 25% | Infection. HP drains slowly until treated. | `infected` | 20 |
| 5% | The trainee panics and nicks something important. Nobody comes for a while. | `death` | 0 |

**Finding:** *Trainee certified. Subject suitable for continued instructional use.*

### Aversive Conditioning

`fear_conditioning` · weight 11 · unlock 2 · pay 30

**Rounds**

1. A screen shows a simple image: a yellow circle. A chime plays. Nothing happens.
2. Yellow circle. Chime. A shock through the floor plate into your bare feet.
3. Yellow circle. Chime. Shock. Yellow circle. Chime. You flinch before the shock comes.
4. Yellow circle. Chime. No shock this time. You scream anyway.

**Prompts**

- `endure`: hazard +5
- `scream`: finding_chance +20

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 85% | Conditioned. For one day, any yellow object in a room description gets a flinch message. | `yellow_fear` | 15 |
| 15% | Shock burns on your soles. Movement messages describe limping. | `burnt_feet` | 20 |

**Finding:** *Acquisition rapid. Note: lights in corridor C-2 are amber. Consider.*

### Episodic Recall Sampling

`memory_extraction` · weight 9 · unlock 3 · pay 45

**Rounds**

1. A crown of electrodes. Cold gel at your temples. A technician asks you to think of your earliest memory.
2. You think of it. It thins. The colors drain from it like rinsed dye.
3. "Again," they say. "A different one." You think of another. It goes too.
4. "That's enough," they say, and you can't remember what you were thinking about.

**Prompts**

- `comply`: memory_loss +10, pay +10
- `endure`: memory_loss -10

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 60% | Patchy recall. Your last 3 visited rooms are removed from your map/history. | `memory_patch` | 15 |
| 30% | A stranger's memory has been left behind. A one-off lore message describes a room you have never visited. | `foreign_memory` | 20 |
| 10% | Your recall command shows only your clone ID for an hour. | `amnesiac` | 30 |

**Finding:** *Sample archived. Earliest memory consistent with lineage template.*

### Structural Load Testing

`crush_load` · weight 8 · unlock 2 · pay 55

**Rounds**

1. You lie on a steel slab. Above you, a press plate hangs on hydraulic arms. Weights are stacked on it in plain view.
2. The plate lowers onto your chest. Contact is almost gentle.
3. A weight is added. Another. Breathing becomes a decision you have to make on purpose.
4. Something in your ribs makes a sound like a green branch.

**Prompts**

- `endure`: hazard +15, survive -10
- `scream`: survive +5

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 50% | Bruised ribs. Max stamina -20% until healed. | `bruised_ribs` | 20 |
| 35% | Two cracked ribs. Combat actions cost double. | `cracked_ribs` | 35 |
| 15% | The plate keeps lowering after you stop being able to scream. | `death` | 0 |

**Finding:** *Load bearing as specified. Subject's last word recorded and filed separately.*

### Environmental Toxin Challenge

`toxin_challenge` · weight 10 · unlock 2 · pay 40

**Rounds**

1. A glass booth. A small vent near the floor. A sign: PLEASE BREATHE NORMALLY.
2. A faint sweet smell, like almonds or cut grass or both.
3. Your throat tightens. Your lips go numb. Your hands are the wrong color.
4. The vent reverses. Fresh air. A mask is lowered from the ceiling.

**Prompts**

- `endure`: hazard +10
- `comply`: survive +5

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 60% | Chemical cough. Every few commands you're interrupted by coughing. | `coughing` | 15 |
| 30% | Lung damage. Running/fleeing fails 25% of the time until treated. | `lung_damage` | 25 |
| 10% | Your lips go blue and stay that way. | `death` | 0 |

**Finding:** *Exposure threshold refined. Mask deployment latency adequate.*

### Symbiont Hosting Study

`parasite_host` · weight 6 · unlock 4 · pay 70

**Rounds**

1. A petri dish, held up to the light so you can see. Something pale in it, the size of a grain of rice, turning slowly.
2. They place it on the inside of your elbow. It finds the vein on its own.
3. You feel it travel. Up the arm, across the shoulder. It settles somewhere near your spine, warm as a coin held in a fist.
4. "You won't notice it," they say. You will.

**Prompts**

- `scream`: finding_chance +20

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 70% | Hosting. For 24h, rare random messages: an itch moving under skin; a thought that isn't yours. Pays a small daily 'host stipend.' | `hosting` | 20 |
| 25% | Rejection. Fever and vomiting for an hour; it leaves the way it came. | `rejected_symbiont` | 25 |
| 5% | It finds your brainstem. | `death` | 0 |

**Finding:** *Symbiont accepted. Behavioral drift to be monitored. Do not inform subject of drift.*

### Neuromuscular Stimulation Protocol

`electrostim` · weight 13 · unlock 0 · pay 30

**Rounds**

1. Adhesive pads on your arms, legs, jaw. Wires run to a cabinet covered in dials.
2. Your arm lifts on its own. Then your leg. You watch your body wave at the observation window.
3. The dial turns. Every muscle clenches at once. Your jaw locks so hard you hear a tooth.
4. Release. Your limbs twitch in time with something only they can hear.

**Prompts**

- `endure`: hazard +5
- `comply`: puppet_effect +15

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 55% | Twitching. 10% chance any command is replaced by an involuntary emote for 30 minutes. | `twitching` | 10 |
| 35% | Torn muscle. Strength -1 until healed. | `torn_muscle` | 20 |
| 10% | Your heart takes the current personally. | `death` | 0 |

**Finding:** *Motor override achieved at 40%. Subject waved without instruction. Consider why.*

### Wakefulness Continuity Study

`sleep_denial` · weight 9 · unlock 1 · pay 45

**Rounds**

1. A bright room. A metronome. Every time your eyes close, a buzzer sounds and the floor jolts.
2. Time comes apart. You count the metronome. You lose the count. You start again.
3. There is a person in the corner who was not there before. They are also counting.
4. The lights go out. You sleep standing up. You dream of the metronome.

**Prompts**

- `endure`: hazard +10, hallucination +15

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 60% | Exhaustion. Every 5th command fails with 'you stare blankly' for an hour. | `exhausted` | 15 |
| 35% | Microsleeps. Rooms occasionally display the wrong description, then correct themselves. | `microsleep` | 20 |
| 5% | Your heart doesn't stay awake with you. | `death` | 0 |

**Finding:** *Corner figure reported by subject. Corner is not visible to cameras.*

### Instruction Compliance Assessment

`compliance_trial` · weight 8 · unlock 3 · pay 50

**Rounds**

1. A table. On it: a scalpel, a towel, and a printed card that says PLEASE REMOVE THE TIP OF YOUR SMALLEST FINGER.
2. The speaker is patient. "There is no penalty for declining. There is no reward for complying."
3. The card has been replaced. Now it says THANK YOU, though you did nothing.

**Prompts**

- `comply`: outcome → complied
- `endure`: outcome → refused

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 50% (complied) | Missing fingertip. Permanent cosmetic note in your description. Pay x2 for no stated reason. | `fingertip` | 30 |
| 50% (refused) | No injury. Pay docked by half. A note is added to your file in red ink. | `none` | -25 |

**Finding:** *Compliance index updated. Lineage average: 71%.*

### Accelerated Tissue Regrowth

`rapid_regrowth` · weight 7 · unlock 4 · pay 60

**Rounds**

1. A wound is made on your thigh, clean and deep. Then a syringe of something luminous is emptied into it.
2. The wound itches. Then it crawls. You can see the edges knitting, beading, reaching for each other.
3. It does not stop when it closes. A small bump rises. The bump has a fingernail.
4. A technician removes the bump with a pair of shears and drops it in a jar, which they label carefully.

**Prompts**

- `endure`: hazard +10
- `scream`: finding_chance +20

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 60% | Healed, mostly. Regenerate HP 2x faster for an hour. A small scar shaped like a closed eye. | `fast_heal` | 15 |
| 30% | Overgrowth. A lump under your skin; NPCs who examine you remark on it. | `overgrowth` | 25 |
| 10% | The growth does not stop, and the jar is not big enough. | `death` | 0 |

**Finding:** *Regrowth exceeds template. Excised tissue retained. Do not discard.*

### Mammalian Dive Reflex Study

`drowning_reflex` · weight 9 · unlock 2 · pay 45

**Rounds**

1. A tank of cold water. A harness that lowers you face-first. A clock on the wall with no numbers.
2. Under. Your body tells you, very clearly, that this is how it ends.
3. Up. One breath. Under again before the breath is finished.
4. Up. They hold you there a long time, letting you cough. Someone says 'good' quietly, to themselves.

**Prompts**

- `endure`: hazard +15, survive -5
- `scream`: survive -10

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 60% | Water in the lungs. Wet cough and chills for 30 minutes. | `waterlogged` | 15 |
| 30% | Panic imprint. Rooms with water in the description trigger a fear message for a day. | `water_fear` | 15 |
| 10% | Under. And you stay under. | `death` | 0 |

**Finding:** *Reflex onset delayed relative to prior instances. Lineage adapting?*

### Control Group Participation

`placebo` · weight 8 · unlock 0 · pay 20

**Rounds**

1. A friendly technician hands you a small white pill. "This is the control," they say. "It's sugar."
2. You wait. You feel fine. You are watched closely by three people with clipboards.
3. One of them begins to cry, quietly, and is escorted out.

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 90% | Nothing happens. Your file now says 'control.' The word has been underlined twice. | `none` | 5 |
| 10% | It was not sugar. Random status effect from the pharmacological table. | `random_pharm` | 20 |

**Finding:** *Control status confirmed. Subject asked no questions.*

### Predator Proximity Response

`animal_proximity` · weight 7 · unlock 3 · pay 50

**Rounds**

1. A long, dim room. At the far end, behind a curtain, something breathing. Large.
2. The curtain lifts a few inches. You see feet. Too many toes. Wet.
3. A chain rattles as it pays out. The breathing gets closer.
4. The chain goes taut a meter from your face. Something sniffs you thoroughly, and decides.

**Prompts**

- `endure`: survive +10, hazard +10
- `scream`: attack +20

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 55% | Unharmed, but marked with its scent. Animal NPCs in the facility avoid you for a day. | `scented` | 20 |
| 35% | Bitten. Deep lacerations; bleeding effect until bandaged. | `bitten` | 30 |
| 10% | The chain was longer than they said. | `death` | 0 |

**Finding:** *Specimen expressed preference. Specimen expressed preference for this lineage before.*

### Actuarial Value Assessment

`insurance_assessment` · weight 4 · unlock 6 · pay 25

**Rounds**

1. An ordinary office. Carpet. A potted plant. A smiling claims adjuster with a calculator.
2. They ask about your hobbies, your pain tolerance, how many times you have died, whether you minded.
3. They type for a long time. They turn the screen toward you. It shows a number, then a smaller number.
4. "You've been very good value," they say, and shake your hand. Their palm is cold.

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 70% | No injury. A letter arrives later confirming your coverage is unchanged. | `none` | 0 |
| 30% | Your policy has been 'reclassified.' Future Subject Pool pay +10%. Future death chance +2%. | `reclassified` | 0 |

**Finding:** *Lineage valuation updated. Projected remaining instances: [REDACTED].*

### Self-Recognition Protocol

`mirror_self` · weight 5 · unlock 5 · pay 40

**Rounds**

1. A mirror. A mark of red paint is dabbed on your forehead while you watch.
2. In the mirror, your reflection has no mark.
3. Your reflection raises a hand to its clean forehead, slowly, before you do.
4. The lights go out. When they come back the mirror is a window. The room beyond it is empty and dusty.

**Prompts**

- `endure`: finding_chance +30

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 85% | No physical injury. For an hour, `look self` describes someone slightly different. | `misreflect` | 25 |
| 15% | You scratched at your forehead until it bled. Scar added to your description. | `forehead_scar` | 30 |

**Finding:** *Subject passed mirror test. Reflection did not. Escalate.*

### Allocation Lottery

`lottery` · weight 4 · unlock 2 · pay 15

**Rounds**

1. A room with nine subjects including you, all in paper gowns. A bowl of folded slips on a table.
2. Each subject draws a slip. Each slip is blank. One subject's slip is not blank. You don't see what it says.
3. That subject is led away. The rest of you are thanked and dismissed.

| Chance | Result | Effect | Hazard |
|---|---|---|---|
| 89% | You go home with 15 credits and a blank slip. You keep the slip. You don't know why. | `blank_slip_item` | 0 |
| 11% | Your slip is not blank. It says your clone ID. You are led away. | `death` | 0 |

**Finding:** *Selection complete. Unselected subjects showed relief. Noted for weighting.*

## Recurring NPC: Pell

Appears in the holding room from visit 2 onward.

A clone in a paper gown sits on the far end of the bench, unmarked, unhurried. They look at you with the warm recognition of an old friend.

**Lines:**

- "Back again? Me too. I'm always back."
- "Don't drink anything they hand you on a Tuesday."
- "I did the mirror room yesterday. Or tomorrow. They run together."
- "You were taller last time. That's not a criticism."
- "I've never been hurt here. Not once."
