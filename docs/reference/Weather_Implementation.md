# Weather Implementation — author direction

Author-supplied design direction for the flight sim's weather system. Sits alongside
[Flight_Implementation](Flight_Implementation.md), [Rendering_Implementation](Rendering_Implementation.md),
and [Sound_Implementation](Sound_Implementation.md). This is the vision; see
[docs/systems-flight.md](../systems-flight.md) for what's actually built and the
"as-built" notes below each section.

The governing principle: **weather is a set of continuously-sampled atmospheric properties
at the aircraft's position**, and the flight model applies real aerodynamic forces from
them while the renderer draws the same data — so what the player sees always matches what
the aircraft physically experiences. Weather never "cheats" the physics; pilot skill models
the pilot's ability to *counteract* disturbances, not reduce them.

---

## Wind — the foundation of all weather effects

Wind is a moving mass of air, not a force by itself. The aircraft responds to the
difference between its velocity and the moving air around it.

**Flight model:** headwind/tailwind change ground speed; crosswinds cause drift during
takeoff and landing; gusts introduce sudden roll/yaw/pitch; strong winds increase taxi
workload; terrain and buildings create wind shadows and turbulence; ridge lift and rotor
effects near hills/cliffs. Sample wind continuously from the atmosphere — not occasional
random pushes.

**Visuals:** trees sway with strength; grass bends; dust blows across runways; smoke trails
lean; ocean waves align to wind; rain falls at an angle; clouds visibly move; windsocks
react smoothly, not snapping.

## Turbulence

Irregular airflow from terrain, weather systems, convection, or mechanical obstacles.
Disturb the *aircraft*, not the camera: random roll inputs, small pitch oscillations,
minor yaw, temporary lift changes, variable climb, more pilot correction. Severity scales
from light bumps to violent updrafts.

**Visuals:** cockpit vibration, loose objects shaking, wingtip flex, unstable-air cloud
movement, dust devils / blowing debris.

## Gusts

Temporary increases/decreases in wind speed (vs. steady wind). Brief but noticeable:
sudden lift changes, ballooning on landing, abrupt yaw on takeoff, momentary airspeed
fluctuations, higher workload in the flare. Ramp in and out — never instant.

**Visuals:** rapid vegetation movement, blowing debris, quick cloud deformation, sudden
water ripples.

## Rain

Primarily visibility and performance, not lift. Slightly reduced engine/prop efficiency,
reduced visibility, wet-runway braking penalties, longer takeoff/landing rolls,
hydroplaning risk at high speed.

**Visuals:** raindrops on the windshield, streaking that flattens with speed, wet
reflective runways, puddle ripples, wheel spray, darkened terrain.

## Snow

Runway conditions far more than aerodynamics: reduced braking, longer stopping, reduced
directional control, soft-snow rolling resistance, possible weight accumulation.

**Visuals:** snowfall, terrain accumulation, frosted aircraft, tire tracks, reduced
visibility.

## Fog

Almost purely visibility — no direct aerodynamic effect. Indirect: hard visual navigation,
delayed runway acquisition, greater instrument reliance.

**Visuals:** distance fading, moist atmosphere, halos around lights, reduced horizon.

## Clouds

More than scenery. Entering cloud: light turbulence, small temperature changes, reduced
visibility, moisture, occasional icing if cold enough.

**Visuals:** smooth transitions into cloud volume, reduced visibility, diffuse sunlight,
dynamic terrain shadows.

## Icing

One of the most significant hazards. Ice accumulates gradually with moisture + temperature:
increased weight, reduced lift, increased drag, higher stall speed, poorer climb, reduced
control effectiveness, prop imbalance, intake restriction.

**Visuals:** frost on wings, ice on the spinner, frosted windshield edges, opaque leading
edges.

## Temperature

Higher temps → reduced engine power, reduced prop thrust, lower air density, longer
takeoff, reduced climb. Cold improves performance but raises icing risk.

**Visuals:** heat shimmer, cold haze, winter frost.

## Pressure

Primarily density altitude. Low pressure → lower engine performance, reduced lift, longer
takeoff, lower climb. Communicated through performance, not graphics.

## Density Altitude

High temperature + humidity + altitude → thin air: longer takeoff, lower climb, reduced
prop efficiency, reduced engine power, lower control effectiveness. The aircraft should
"feel heavier." No direct visual.

## Wind Shear

Rapid wind-velocity change over short distance: sudden airspeed/lift changes, pitch
disturbances, sink-rate increases. Most noticeable on approach/departure. Usually invisible;
hint with blowing dust or rain patterns.

## Thermals

Columns of rising warm air: unexpected climbs, improved gliding, roll disturbances
entering/leaving, variable lift. Imply with circling birds, dust devils, haze shimmer.

## Microbursts

Localized intense downdrafts. Extremely dangerous: strong downdrafts, rapid airspeed
changes, sudden sink, severe turbulence. Rare but potentially flight-ending if mishandled.

---

## Overall philosophy — a dynamic atmosphere field

Rather than scripting individual weather events, build a field where every point has
continuously-changing properties: **wind vector, turbulence intensity, gust strength,
temperature, pressure, humidity, visibility, precipitation, cloud density, icing potential.**
The flight model samples these at the aircraft's position and applies the resulting
aerodynamic forces; the renderer uses the same data to drive clouds, vegetation,
precipitation, visibility, lighting, and surface conditions. One source of truth → what the
player sees always matches what the aircraft experiences.

## Pilot-skill compensation

Environmental effects never manipulate the aircraft directly or cheat the physics. Weather
always acts through the flight model; the pilot-skill system models the pilot's ability to
**recognize, anticipate, and correct** for the disturbances.

Higher skill →
recognition of changing attitude, faster reactions, more precise corrections, better
gust/turbulence anticipation, smoother inputs, better crosswind technique, improved energy
management, more accurate flare/touchdown.

**Practical:** crosswind drift corrected more effectively; turbulence produces less
deviation; gusts countered faster; fewer takeoff heading corrections; more stable landings
in adverse weather; easier strong-wind taxi; fewer pilot-induced oscillations; faster
unusual-attitude recovery.

**Important:** skill never reduces the *weather's* strength — a 30-kt crosswind is still
30 kt. Higher skill just applies more effective inputs. This preserves realism while
rewarding progression.

## AI / NPC pilots

The same system governs all pilots. Low-skill NPCs visibly struggle in turbulence/wind;
experienced ones stay smooth and controlled — consistent, believable behaviour across
player and AI aircraft.
