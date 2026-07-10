// District registry — the "sense of place" substrate.
//
// A district is the coarse land-use neighborhood a zone belongs to, DERIVED from
// the zone's id prefix (zone_<prefix>_<name>). Every existing zone is classified
// for free; a zone whose prefix misclassifies it can override via flags.district.
//
// This is the single server source of truth for the func→identity mapping. It
// used to live as MAP_FUNC_PREFIX/mapFunc in commands/movement.js. Consumers:
// scripts/landuse-zone-colors.js imports districtFor directly; the client
// FUNC_LEGEND (client/game/js/panels/minimap.js) is the one remaining separate-
// runtime mirror — keep its keys/colors in sync when editing here.
//
// Each district entry carries:
//   key       — the stable func category id (also the map/legend key)
//   name      — player-facing neighborhood name (header tag, boundary beat)
//   color     — CSS color, matches the client FUNC_LEGEND
//   blurb     — one-line neighborhood mood, shown on a player's first-ever entry
//   landmark  — zone id of the district's orienting skyline feature (or null)
//   skyline   — short phrase describing that landmark from afar (or null)
//   signature — sensory leitmotif pool (smell/sound/air), surfaced OUTDOORS only
//               by the district-ambience plugin. Empty = no sensory layer.

import { zoneDanger } from './danger.js';

// Zone id prefix → district key. Mirrors the client FUNC_LEGEND keys.
export const DISTRICT_PREFIX = {
  bay: 'water', dock: 'docks', nc: 'northcity', up: 'northcity', gov: 'government',
  civ: 'civic', city: 'civic', clone: 'civic', start: 'civic', threshold: 'civic', thresholdeast: 'civic',
  apt: 'residential', meridian: 'residential', embassy: 'residential', residential: 'residential',
  drum: 'commercial', velk: 'commercial', weapons: 'commercial', furniture: 'commercial',
  mq: 'nightlife',
  media: 'media', prod: 'media', studio: 'media', util: 'media', ext: 'media',
  coldwater: 'industrial', powerplantnew: 'industrial', warehouse: 'industrial',
  slag: 'slaglands',
  waste: 'wasteland', badland: 'wasteland', outskirts: 'wasteland', ruins: 'wasteland',
  ashway: 'ashway',
  deep: 'slum', slums: 'slum', tunnels: 'slum',
  red: 'redline', meat: 'redline',
};

export const DISTRICTS = {
  northcity: {
    key: 'northcity', name: 'North City', color: '#d9a83a',
    blurb: 'Money lives up here, behind glass and clean air.',
    landmark: 'nc_spindle', skyline: 'the Spindle needles up into the haze',
    signature: [
      'The air up here is filtered clean — it barely smells of anything, and that itself is strange.',
      'Somewhere a fountain runs, the sound of water no one is allowed to drink.',
      'A climate curtain sighs across a doorway, breathing warm, scentless money.',
      'Glass towers throw the light back down at you, cold and even.',
    ],
  },
  government: {
    key: 'government', name: 'the Government District', color: '#b56fbf',
    blurb: 'Every wall here is listening, and most of them file a report.',
    landmark: 'gov_assembly', skyline: 'the floodlit dome of the Assembly',
    signature: [
      'The hum of climate control is a little too even, a little too watchful.',
      'A distant PA chimes a bulletin no one is close enough to hear.',
      'Polished stone underfoot carries every footstep further than it should.',
      'The air tastes of toner and old marble.',
    ],
  },
  civic: {
    key: 'civic', name: 'the Civic Center', color: '#4bb36a',
    blurb: 'The city keeps its paperwork and its promises here — neither in great repair.',
    landmark: 'civ_steps', skyline: 'the broad sweep of the Civic Steps',
    signature: [
      'A queue shuffles somewhere out of sight, patient the way only the desperate are.',
      'Wet concrete and cheap coffee — the smell of waiting your turn.',
      'A departure chime loops from a kiosk, endlessly polite.',
      'Pigeons argue over the steps in the flat civic light.',
    ],
  },
  residential: {
    key: 'residential', name: 'the Residential Blocks', color: '#c9a884',
    blurb: 'People sleep here, stacked and dreaming, one thin wall apart.',
    landmark: null, skyline: null,
    signature: [
      'A dozen televisions bleed through walls, none quite in sync.',
      'Cooking smells drift down a stairwell — onions, grease, something burning.',
      'Somewhere a baby cries, then stops, then thinks better of it.',
      'Laundry snaps on a line strung between two dead satellite dishes.',
    ],
  },
  commercial: {
    key: 'commercial', name: 'the Commercial Strip', color: '#e08a4a',
    blurb: 'Everything is for sale here, and most of it has been sold before.',
    landmark: 'drum_shop', skyline: "Second Skin's crooked sign leans over Bobbin Cut",
    signature: [
      'A shop-front jingle loops off its own echo, cheerful and unwell.',
      'The gutters smell of fry-oil and hot vinyl.',
      'A shutter rattles up, then halfway down again, undecided.',
      'Discount holograms stutter in the windows, half their pixels dead.',
    ],
  },
  nightlife: {
    key: 'nightlife', name: 'the Marquee', color: '#e85aa0',
    blurb: 'The party never ended here; it just stopped being fun.',
    landmark: 'mq_marquee', skyline: "the Marquee's dead neon flickers over the rooftops",
    signature: [
      'Bass thuds through a wall, felt in the teeth before the ears.',
      'Spilled liquor, cheap perfume, and cigarette smoke braid together in the damp air.',
      'A bouncer somewhere says "not tonight" in exactly that tone.',
      'Broken neon buzzes overhead, painting the puddles pink and sick-green.',
    ],
  },
  media: {
    key: 'media', name: 'the Media District', color: '#8e6fd0',
    blurb: 'The city films itself here and sells the footage back to you.',
    landmark: 'studio_1782953094650', skyline: 'the KSAB transmission mast blinks red on the skyline',
    signature: [
      'A jingle you half-remember leaks from a soundstage and burrows in.',
      'The ozone tang of hot studio lights hangs in the air.',
      'A director’s voice barks "again, from the top" through a cracked door.',
      'Cable runs snake underfoot, gaffer-taped and humming.',
    ],
  },
  docks: {
    key: 'docks', name: 'the Docks', color: '#1fb5aa',
    blurb: 'Cargo comes ashore here and asks no questions on the way in.',
    landmark: 'dock_wharf', skyline: 'the dock cranes stand black over the waterline',
    signature: [
      'Brine and diesel and rotting rope — the docks announce themselves through the nose.',
      'Gulls wheel and scream over something dead in the water.',
      'A hull groans against its moorings, timber and rust arguing.',
      'A foghorn calls once, low and lonely, and gets no answer.',
    ],
  },
  water: {
    key: 'water', name: 'Coldwater Bay', color: '#2f86cc',
    blurb: 'The bay is cold all the way down, and keeps what it takes.',
    landmark: 'bay_breakwater', skyline: "the breakwater's warning light sweeps the fog",
    signature: [
      'Cold comes off the water in a slow, patient wall.',
      'Waves slap at something unseen with a hollow, regular knock.',
      'The salt air is so raw it scours the back of your throat.',
      'A buoy bell tolls somewhere in the murk, unhurried.',
    ],
  },
  industrial: {
    key: 'industrial', name: 'the Industrial Flats', color: '#9a8a4f',
    blurb: 'The machines that keep the city alive live here, and they are tired.',
    landmark: 'coldwater_turbine_hall', skyline: 'the Coldwater cooling stacks trail steam northward',
    signature: [
      'A turbine’s drone sits under everything, a note the whole flat is tuned to.',
      'Hot oil, scorched coolant, and the flat metal taste of ozone.',
      'Steam vents somewhere with a long, exhausted hiss.',
      'The ground carries a faint, ceaseless machine tremor up through your boots.',
    ],
  },
  slaglands: {
    key: 'slaglands', name: 'the Slaglands', color: '#e5822a',
    blurb: 'They smelt the future here and dump what’s left of the past.',
    landmark: 'slag_flarestack', skyline: 'the Slagworks flarestack burns orange against the clouds',
    signature: [
      'Heat rolls off the slag heaps in shimmering, breathable waves.',
      'The air is metal and ash, gritty enough to chew.',
      'A flarestack roars far off, a dragon that never quite sleeps.',
      'Cinders drift down like a dirty, weightless snow.',
    ],
  },
  wasteland: {
    key: 'wasteland', name: 'the Wastes', color: '#7c6a4a',
    blurb: 'The city gave up out here, and the wind took the rest.',
    landmark: 'waste_gantry', skyline: 'a skeletal gantry leans on the horizon',
    signature: [
      'Wind hauls grit across open ground with nothing left to stop it.',
      'Dust, rust, and dry rot — the smell of a place that stopped.',
      'A loose sheet of tin bangs somewhere, over and over, keeping no time.',
      'The silence out here has a weight to it, and it leans on you.',
    ],
  },
  ashway: {
    key: 'ashway', name: 'the Ashway', color: '#8b9097',
    blurb: 'One long grey road hauls everything the city can’t look at out of sight.',
    landmark: 'ashway_road', skyline: "the Ashway's haul road cuts a grey scar toward the hills",
    signature: [
      'Ash coats everything in a fine grey felt that puffs up at a footstep.',
      'The air is dry and dead and tastes of burnt paper.',
      'A haul rig grinds past somewhere, gears and dust and diesel.',
      'Grey light, grey ground, grey sky — the colour got hauled off with everything else.',
    ],
  },
  slum: {
    key: 'slum', name: 'the Sprawl', color: '#cf6a2e',
    blurb: 'The city’s underside, folded in on itself and still breathing.',
    landmark: 'slums', skyline: "the Sprawl's tangled aerials bristle overhead",
    signature: [
      'Close air, warm and thick, breathed too many times already.',
      'Frying oil, wet cardboard, and the sweet-sour reek of the gutter.',
      'A hundred bartered voices braid into one low, ceaseless murmur.',
      'Something drips steadily out of the dark overhead, and you decide not to wonder what.',
    ],
  },
  redline: {
    key: 'redline', name: 'the Redline', color: '#c0392b',
    blurb: 'Whatever gets butchered in this city, gets butchered here.',
    landmark: 'red_dreadfurnace', skyline: 'the Dread Furnace glows red beyond the fence',
    signature: [
      'The smell hits first — blood and offal and hot iron, and it does not let go.',
      'Something screams behind a fence, and then, worse, stops.',
      'Flies drone in a fat, contented cloud you can hear before you see.',
      'The ground is dark and tacky underfoot, and you try not to look down.',
    ],
  },
  hazard: {
    key: 'hazard', name: 'a Hazard Zone', color: '#e05555',
    blurb: 'Nothing good stays alive out here for long. Neither will you.',
    landmark: null, skyline: null,
    signature: [
      'The air itself feels wrong — a chemical sharpness that scrapes the lungs.',
      'A geiger tick you can’t actually hear seems to crawl up your spine anyway.',
      'Everything here is dead, and it died fast.',
      'A hot, oily wind carries a taste you’ll spend the day trying to spit out.',
    ],
  },
};

// The district a zone belongs to. Precedence: an explicit flags.district override,
// then the id-prefix table, then a lethal-zone fallback to 'hazard', then the
// non-grey urban default. Always returns a DISTRICTS entry (never null).
export function districtFor(zone) {
  if (!zone) return DISTRICTS.residential;
  const override = zone.flags?.district;
  if (override && DISTRICTS[override]) return DISTRICTS[override];
  const p = (zone.id || '').match(/^zone_([a-z0-9]+)/)?.[1] || '';
  const key = DISTRICT_PREFIX[p] || (zoneDanger(zone) === 'lethal' ? 'hazard' : 'residential');
  return DISTRICTS[key];
}
