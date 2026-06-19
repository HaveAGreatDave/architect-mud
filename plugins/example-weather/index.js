/**
 * Example weather plugin.
 * Demonstrates: zone.describeAmbient, tick.minute, player.enterZone hooks.
 */

const WEATHER_STATES = ['clear', 'overcast', 'drizzle', 'heavy_rain', 'dust_storm', 'acid_fog'];
const WEATHER_WEIGHTS = [35, 25, 15, 10, 10, 5];

let currentWeather = 'clear';
let weatherDuration = 0;

function pickWeather() {
  const total = WEATHER_WEIGHTS.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < WEATHER_STATES.length; i++) {
    roll -= WEATHER_WEIGHTS[i];
    if (roll <= 0) return WEATHER_STATES[i];
  }
  return 'clear';
}

const WEATHER_DESCRIPTIONS = {
  clear: null, // no extra text
  overcast: 'The sky is the color of a bruise.',
  drizzle: 'A thin drizzle falls. It tastes like metal.',
  heavy_rain: 'Rain hammers down, making everything louder and harder to see.',
  dust_storm: 'A dust storm scours the air. Your eyes water. Your mouth fills with grit.',
  acid_fog: 'A pale yellow fog has settled in. Your skin tingles where it touches exposed skin.',
};

const WEATHER_EFFECTS = {
  acid_fog: { radiation: 1 },
  dust_storm: { sanity: -1 },
};

export const hooks = {
  'tick.minute': async () => {
    weatherDuration--;
    if (weatherDuration <= 0) {
      currentWeather = pickWeather();
      weatherDuration = Math.floor(Math.random() * 20) + 5; // 5–25 min
    }
  },

  'zone.describeAmbient': async (zone) => {
    // Only outdoor zones — skip tunnels etc
    if (zone.flags?.indoor) return undefined;
    return WEATHER_DESCRIPTIONS[currentWeather] || undefined;
  },

  'player.enterZone': async (player) => {
    const effect = WEATHER_EFFECTS[currentWeather];
    if (!effect) return undefined;
    return { effects: effect, message: `The ${currentWeather.replace('_',' ')} is affecting you.` };
  },
};
