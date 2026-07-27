// Plain-language wind strength, roughly Beaufort. Mirrors the game client's forecast panel.
function windLabel(kph) {
  if (kph == null) return '';
  if (kph < 6)  return 'Calm';
  if (kph < 20) return 'Breezy';
  if (kph < 39) return 'Windy';
  if (kph < 62) return 'Strong';
  return 'Gale';
}

// Game-speed control is gated behind a deliberate unlock (below) so the world
// clock can't be re-rated by a stray click. Re-locks on every panel render.
let _gameSpeedUnlocked = false;

function renderTimeWeatherPanel(data) {
  _gameSpeedUnlocked = false;
  const panel = document.getElementById('list-panel');
  const env = data?.env || {};
  const forecast = data?.forecast || [];

  const timeStr = env.time || '00:00';
  const WEATHER_TYPES = ['clear','cloudy','overcast','rain','sleet','thunderstorm','storm','snow','blizzard','fog','haze','ash'];
  const WEATHER_PRECIP_CHANCE = { rain:0.70, thunderstorm:0.70, storm:0.70, sleet:0.70, snow:0.70, blizzard:0.70, overcast:0.25, cloudy:0.10, clear:0.03, fog:0.03, haze:0.03, ash:0.03 };
  const climateProfiles = data?.climateProfiles || [];
  const activeId = env.activeClimateProfileId || '';
  window._twClimateProfiles = climateProfiles;

  const lightningKills = Array.isArray(env.lightningKills) ? env.lightningKills : [];
  const lightningBox = lightningKills.length
    ? lightningKills.slice().reverse().map(k => `<div style="padding:4px 0;border-bottom:1px solid var(--border)">⚡ <span style="color:var(--text-bright)">${k.handle}</span> <span style="color:var(--text-dim)">— ${k.date} ${k.time}</span></div>`).join('')
    : `<div style="color:var(--text-dim)">No one has been struck by lightning so far!</div>`;

  const SEVERE_THRESHOLD = 0.45;
  const forecastGrid = forecast.slice(0,7).map((f,i) => {
    const severe = (f.severity ?? 0) >= SEVERE_THRESHOLD;
    // Mirrors the player-facing forecast panel: a scheduled hero event (acid
    // rain, ion storm) is red and named, an ordinary severe day stays amber.
    // Derived from the date, so scheduling a severe day here can't fake one.
    const hero = f.heroEvent ? { icon: f.heroEventIcon || '⚠', label: f.heroEventLabel || String(f.heroEvent).replace(/_/g,' ') } : null;
    const edge = hero ? 'var(--red)' : severe ? 'var(--yellow)' : 'var(--border)';
    return `
    <div title="${(f.weatherType||'?')}${f.tempC!=null?' · '+f.tempC+'°C':''}${f.windKph!=null?' · '+f.windKph+' km/h '+windLabel(f.windKph):''}${f.humidityPct!=null?' · '+f.humidityPct+'% humidity':''}${severe?' · ⚠ severe (severity '+f.severity.toFixed(2)+')':''}${hero?' · ⚠⚠ HERO EVENT: '+hero.label:''}" style="background:var(--bg3);border:1px solid ${edge};border-radius:4px;padding:8px 4px;text-align:center;position:relative">
      ${hero?`<div style="position:absolute;top:4px;right:6px;font-size:11px;color:var(--red)" title="Hero event: ${hero.label}">⚠⚠</div>`
        :severe?`<div style="position:absolute;top:4px;right:6px;font-size:11px" title="Severe conditions">⚠</div>`:''}
      <div style="font-size:9px;font-weight:600;color:var(--text-dim);letter-spacing:.5px">${i===0?'TODAY':'DAY '+(i+1)}</div>
      <div style="font-size:22px;line-height:1.2;margin:2px 0">${hero?hero.icon:(f.icon||'?')}</div>
      <div style="font-size:10px;color:${hero?'var(--red)':'var(--text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${hero?hero.label:(f.weatherType||'?')}</div>
      ${f.tempC!=null?`<div style="font-size:12px;color:var(--text-bright);font-weight:600;margin-top:2px">${f.tempC}°</div>`:''}
      <div style="font-size:9px;color:var(--text-dim);margin-top:2px;white-space:nowrap">${f.windKph!=null?'💨'+f.windKph:''}${f.windKph!=null&&f.humidityPct!=null?' · ':''}${f.humidityPct!=null?'💧'+f.humidityPct+'%':''}</div>
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div style="padding:24px;max-width:700px;display:flex;flex-direction:column;gap:24px">

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:16px">Current State</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;font-size:13px">
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">TIME</div><div id="tw-live-clock" style="color:var(--text-bright);font-size:18px;font-weight:700">${timeStr}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">DATE</div><div style="color:var(--text)">${env.date||'—'}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">SEASON</div><div style="color:var(--text)">${env.season||'—'}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">WEATHER</div><div style="color:var(--text)">${env.currentWeatherIcon||''} ${env.currentWeatherType||'—'}</div>${env.currentWeatherType!==env.weatherType?`<div style="color:var(--text-dim);font-size:10px;margin-top:2px">forecast: ${env.weatherType}</div>`:''}</div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">TEMPERATURE</div><div style="color:var(--text)">${env.tempC!=null?env.tempC+'°C':'—'}${env.feelsLikeC!=null&&Math.round(env.feelsLikeC)!==Math.round(env.tempC)?`<span style="color:var(--text-dim);font-size:11px"> · feels ${Math.round(env.feelsLikeC)}°C</span>`:''}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">WIND</div><div style="color:var(--text)">${env.windKph!=null?'💨 '+env.windKph+' km/h · '+windLabel(env.windKph):'—'}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">HUMIDITY</div><div style="color:var(--text)">${env.humidityPct!=null?'💧 '+env.humidityPct+'%':'—'}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">INTENSITY</div><div style="color:var(--text)">${env.currentIntensity||'—'}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">STATUS</div><div style="color:${env.frozen?'var(--red)':'var(--accent2)'}">${env.frozen?'⏸ Frozen':'▶ Running'}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">SPEED</div><div style="color:var(--text)">${(env.timeScale||1)}× <span style="color:var(--text-dim);font-size:11px">· 24h day = ${(24/(env.timeScale||1)).toFixed(1)}h real</span></div></div>
        </div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;flex-wrap:wrap">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Game Speed</div>
          <span id="tw-scale-lockbadge" style="font-size:11px;color:var(--red)">🔒 Locked</span>
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:16px">Game minutes per real minute. Higher = shorter real day. Scales the whole world — day/night, calendar, weather, NPC schedules, survival, jail, drugs, and rent (billed on the game calendar). Applies live with no clock jump.</div>

        <div id="tw-scale-locked" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <button class="action-btn danger" onclick="devUnlockGameSpeed()">🔓 Unlock Speed Control</button>
          <span style="font-size:11px;color:var(--text-dim)">Changing the time scale re-rates the entire world clock. Unlock to proceed.</span>
        </div>

        <div id="tw-scale-controls" style="display:none;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <label style="font-size:12px;color:var(--text-dim)">Multiplier (×)<br>
            <input id="tw-scale" type="number" min="0.1" max="60" step="0.5" value="${env.timeScale||1}" style="margin-top:4px;width:90px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
          </label>
          <button class="action-btn" onclick="devApplyGameSpeed()">Apply</button>
          <span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-left:4px">Presets:</span>
          <button class="action-btn" onclick="devApplyGameSpeed(1)" title="24h day = 24h real">1×</button>
          <button class="action-btn" onclick="devApplyGameSpeed(2)" title="24h day = 12h real">2×</button>
          <button class="action-btn" onclick="devApplyGameSpeed(3)" title="24h day = 8h real">3×</button>
          <button class="action-btn" onclick="devApplyGameSpeed(6)" title="24h day = 4h real">6×</button>
        </div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Weather Map <span style="font-weight:400;text-transform:none;color:var(--text-dim)">— live</span></div>
          <select id="tw-wm-region" onchange="setWeatherRegion(this.value)" style="background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:11px"></select>
          <div id="tw-wm-toggles" style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="action-btn" onclick="setWeatherOverlay('temp')">🌡 Temp</button>
            <button class="action-btn" onclick="setWeatherOverlay('cloud')">☁ Cloud</button>
            <button class="action-btn" onclick="setWeatherOverlay('precip')">🌧 Precip</button>
            <button class="action-btn" onclick="setWeatherOverlay('humid')">💧 Humidity</button>
            <button class="action-btn" onclick="setWeatherOverlay('wind')">💨 Wind</button>
          </div>
        </div>
        <div id="tw-wm-climate" style="font-size:11px;color:var(--text-dim);margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"></div>
        <div id="tw-weathermap" style="overflow:auto;max-width:100%"><div style="color:var(--text-dim);font-size:12px">Loading weather map…</div></div>
        <div id="tw-wm-legend" style="font-size:10px;color:var(--text-dim);margin-top:8px"></div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:16px">Lightning Deaths</div>
        <div style="font-size:12px;max-height:180px;overflow-y:auto">${lightningBox}</div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:16px">Set Time</div>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <label style="font-size:12px;color:var(--text-dim)">Date<br>
            <input id="tw-date" type="date" value="${env.date||''}" style="margin-top:4px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
          </label>
          <label style="font-size:12px;color:var(--text-dim)">Time<br>
            <input id="tw-time" type="time" value="${timeStr}" style="margin-top:4px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
          </label>
          <button class="action-btn" onclick="devApplyTime()">Apply & Sync</button>
          <button class="action-btn" onclick="devSyncToMyClockNow()" title="Set server time to match this browser's current clock">⟳ Sync to My Clock</button>
          <button class="action-btn${env.frozen?' danger':''}" onclick="devToggleFreeze()" style="margin-left:4px">
            ${env.frozen?'▶ Unfreeze':'⏸ Freeze Time'}
          </button>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
          <span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Force Tick:</span>
          <button class="action-btn" onclick="devForceTick('force5')" title="Run 5-minute power tick">5 min</button>
          <button class="action-btn" onclick="devForceTick('force30')" title="Run 30-minute time/weather tick">30 min</button>
          <button class="action-btn" onclick="devForceTick('force24')" title="Run 24-hour daily tick">24 hr</button>
        </div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Override Weather</div>
          ${env.weatherOverrideActive
            ? `<div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:11px;color:${luminanceTextColor(getComputedStyle(document.documentElement).getPropertyValue('--yellow').trim().replace('#',''))};background:var(--yellow);border:1px solid var(--yellow);border-radius:3px;padding:3px 8px">⚠ Override Active: ${env.currentWeatherType || env.weatherType}, ${env.tempC != null ? env.tempC + '°C' : '—'}</span>
                <button class="action-btn danger" onclick="devClearWeatherOverride()">Disable Override</button>
              </div>`
            : `<span style="font-size:11px;color:var(--text-dim)">Following forecast</span>`}
        </div>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <label style="font-size:12px;color:var(--text-dim)">Type<br>
            <select id="tw-weather" onchange="document.getElementById('tw-precip').value=Math.round((WEATHER_PRECIP_CHANCE[this.value]??0.05)*100)" style="margin-top:4px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
              ${WEATHER_TYPES.map(w=>`<option value="${w}"${(env.currentWeatherType||env.weatherType)===w?' selected':''}>${w}</option>`).join('')}
            </select>
          </label>
          <label style="font-size:12px;color:var(--text-dim)">Temperature (°C)<br>
            <input id="tw-temp" type="number" value="${env.tempC??20}" style="margin-top:4px;width:80px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
          </label>
          <label style="font-size:12px;color:var(--text-dim)">Precip Chance (%)<br>
            <input id="tw-precip" type="number" min="0" max="100" value="${Math.round((forecast[0]?.precipChance ?? WEATHER_PRECIP_CHANCE[forecast[0]?.weatherType] ?? 0.05)*100)}" style="margin-top:4px;width:80px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
          </label>
          <button class="action-btn" onclick="devApplyWeather()">Apply</button>
          <button class="action-btn danger" onclick="devMaxStorm()" title="Force thunderstorm at maximum precipitation rate (precipRate=1.0)">⛈ Max Storm</button>
          <button class="action-btn" onclick="devResetBuildingTemps()" title="Set all interior/apartment zones to 20°C">Reset Building Temps to 20°C</button>
        </div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:8px">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Hero Weather Event</div>
          ${env.heroEventActive?.type
            ? `<div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:11px;color:var(--red);border:1px solid var(--red);border-radius:3px;padding:3px 8px">⚠⚠ Running: ${String(env.heroEventActive.type).replace(/_/g," ")} — ${env.heroEventActive.phase}</span>
              </div>`
            : `<span style="font-size:11px;color:var(--text-dim)">None running</span>`}
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;line-height:1.5">
          Named events ride <em>on top</em> of the forecast with an approach → peak → passing lifecycle,
          forcing a severity preset instead of deriving one. One at a time. Firing one announces it to
          every player outdoors, so this is a live-world action, not a preview.
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="action-btn danger" onclick="devTriggerHeroEvent('acid_rain')" title="Caustic downpour — gear-gated lethal, overrides precip to acid">☣ Acid Rain</button>
          <button class="action-btn danger" onclick="devTriggerHeroEvent('ion_storm')" title="Ion storm — severity 0.9, the sky screams white">⚡ Ion Storm</button>
        </div>
      </div>

      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">7-Day Forecast</div>
          <button class="action-btn" onclick="devRecalculateForecast()" title="Regenerate unlocked forecast days using the active climate profile">↻ Recalculate Forecast</button>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">${forecastGrid||'<div style="color:var(--text-dim);font-size:12px">No forecast data.</div>'}</div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px">Schedule Future Weather</div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:16px">Edit an upcoming forecast day directly so it arrives severe when it rolls around — unlike Override Weather above, this doesn't touch today or the live field.</div>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <label style="font-size:12px;color:var(--text-dim)">Day<br>
            <select id="tw-sched-day" style="margin-top:4px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
              ${forecast.slice(1,7).map((f,i)=>`<option value="${f.forecastDay}">Day ${i+2} (${f.date||''})</option>`).join('')}
            </select>
          </label>
          <label style="font-size:12px;color:var(--text-dim)">Type<br>
            <select id="tw-sched-weather" style="margin-top:4px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
              ${WEATHER_TYPES.map(w=>`<option value="${w}">${w}</option>`).join('')}
            </select>
          </label>
          <label style="font-size:12px;color:var(--text-dim)">Temperature (°C)<br>
            <input id="tw-sched-temp" type="number" placeholder="—" style="margin-top:4px;width:80px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
          </label>
          <label style="font-size:12px;color:var(--text-dim)">Wind (km/h)<br>
            <input id="tw-sched-wind" type="number" min="0" placeholder="—" style="margin-top:4px;width:80px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
          </label>
          <button class="action-btn" onclick="devScheduleForecastDay()">Schedule</button>
        </div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Climate Profile</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select id="tw-climate-select" onchange="devLoadClimatePreset(this.value)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
              <option value="">— New / Custom —</option>
              <optgroup label="City Presets">
                <option value="__reykjavik">🧊 Reykjavik</option>
                <option value="__miami">🌴 Miami</option>
                <option value="__london">🌦 London</option>
                <option value="__phoenix">🏜 Phoenix</option>
                <option value="__novosibirsk">🥶 Novosibirsk</option>
                <option value="__coldwater">🌫 Coldwater Basin</option>
              </optgroup>
              ${climateProfiles.length ? `<optgroup label="Saved Profiles">${climateProfiles.map(p=>`<option value="${p.id}"${p.id===activeId?' selected':''}>${p.id===activeId?'★ ':''}${p.name}</option>`).join('')}</optgroup>` : ''}
            </select>
            <input id="tw-climate-name" type="text" placeholder="Profile name" value="${climateProfiles.find(p=>p.id===activeId)?.name||''}" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px;width:140px">
            <button class="action-btn" onclick="devSaveClimateProfile()">Save</button>
            <button class="action-btn success" onclick="devSetActiveClimate()" title="Use this profile for weather generation">Set Active</button>
            <button class="action-btn danger" onclick="devDeleteClimateProfile()" title="Delete this saved profile">Delete</button>
          </div>
        </div>

        ${activeId ? `<div style="font-size:11px;color:var(--accent2);margin-bottom:12px">Active profile: <strong>${climateProfiles.find(p=>p.id===activeId)?.name||activeId}</strong></div>` : '<div style="font-size:11px;color:var(--text-dim);margin-bottom:12px">No active profile — using seasonal defaults.</div>'}

        <div style="margin-bottom:14px">
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px">Monthly Avg Temperature (°C)</div>
          <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:4px">
            ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m,i)=>`
              <div style="text-align:center">
                <div style="font-size:10px;color:var(--text-dim);margin-bottom:3px">${m}</div>
                <input id="tw-t-${i}" type="number" value="${(climateProfiles.find(p=>p.id===activeId)?.monthly_temp_c||[])[i]??''}" placeholder="—" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 2px;border-radius:2px;text-align:center">
              </div>`).join('')}
          </div>
        </div>

        <div style="margin-bottom:14px">
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px">Monthly Precipitation Chance (%)</div>
          <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:4px">
            ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m,i)=>`
              <div style="text-align:center">
                <div style="font-size:10px;color:var(--text-dim);margin-bottom:3px">${m}</div>
                <input id="tw-p-${i}" type="number" min="0" max="100" value="${Math.round(((climateProfiles.find(p=>p.id===activeId)?.monthly_precip_chance||[])[i]??'')*100)||''}" placeholder="—" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 2px;border-radius:2px;text-align:center">
              </div>`).join('')}
          </div>
        </div>

        <div style="margin-bottom:14px">
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px">Monthly Avg Wind (km/h)</div>
          <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:4px">
            ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m,i)=>`
              <div style="text-align:center">
                <div style="font-size:10px;color:var(--text-dim);margin-bottom:3px">${m}</div>
                <input id="tw-w-${i}" type="number" min="0" value="${(climateProfiles.find(p=>p.id===activeId)?.monthly_wind_kph||[])[i]??''}" placeholder="—" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 2px;border-radius:2px;text-align:center">
              </div>`).join('')}
          </div>
        </div>

        <div>
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px">Monthly Avg Humidity (%)</div>
          <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:4px">
            ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m,i)=>`
              <div style="text-align:center">
                <div style="font-size:10px;color:var(--text-dim);margin-bottom:3px">${m}</div>
                <input id="tw-h-${i}" type="number" min="0" max="100" value="${(climateProfiles.find(p=>p.id===activeId)?.monthly_humidity||[])[i]??''}" placeholder="—" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 2px;border-radius:2px;text-align:center">
              </div>`).join('')}
          </div>
        </div>
      </div>

    </div>`;

  startPanelClock();
  startWeatherMapPolling();
}

// ---------------------------------------------------------------------------
// Weather Map — live SVG overlay of the moving per-zone weather field.
// Reads GET /environment/weathermap (outdoor zones + system vectors), draws a
// tile per zone coloured by the active overlay, plus system circles + wind
// arrows. Polls every ~12s so fronts visibly drift across the map.
// ---------------------------------------------------------------------------

const WM_LEGEND = {
  temp:   'Tile colour = temperature (blue cold → red hot). Dashed circles are weather systems.',
  cloud:  'Tile shading = cloud cover. Denser = more overcast.',
  precip: 'Tile colour = precipitation intensity (blue rain / white snow), only while actively precipitating.',
  humid:  'Tile colour = relative humidity (faint = dry → deep teal = saturated). Tiles under cloud/rain read damper.',
  wind:   "Arrows show each system's heading and speed; dashed circle = system radius.",
};

function wmTempColor(t) {
  const c = Math.max(-20, Math.min(40, t ?? 0));
  const hue = 240 - ((c + 20) / 60) * 240; // -20°C → 240 (blue), 40°C → 0 (red)
  return `hsl(${hue.toFixed(0)},65%,45%)`;
}

// Relative humidity → teal ramp. 15% (arid) faint, 100% (saturated) deep teal.
function wmHumidColor(h) {
  const a = Math.max(0, Math.min(1, ((h ?? 0) - 15) / 85));
  return `rgba(64,168,176,${(0.12 + a * 0.72).toFixed(2)})`;
}

function buildWeatherMapSVG(data, overlay) {
  const zones = data.zones || [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const z of zones) {
    minX = Math.min(minX, z.grid_x); maxX = Math.max(maxX, z.grid_x);
    minY = Math.min(minY, z.grid_y); maxY = Math.max(maxY, z.grid_y);
  }
  if (data.bounds) {
    minX = Math.min(minX, data.bounds.minX); maxX = Math.max(maxX, data.bounds.maxX);
    minY = Math.min(minY, data.bounds.minY); maxY = Math.max(maxY, data.bounds.maxY);
  }
  const cell = 40, pad = 8;
  const cols = maxX - minX + 1, rows = maxY - minY + 1;
  const W = cols * cell + pad * 2, H = rows * cell + pad * 2;
  const px = gx => pad + (gx - minX) * cell;
  const py = gy => pad + (gy - minY) * cell;

  let tiles = '';
  for (const z of zones) {
    const x = px(z.grid_x), y = py(z.grid_y);
    const cloud = z.cloudCover || 0, precip = z.precipRate || 0;
    let fill = 'var(--bg3)', label = '';
    if (overlay === 'temp')        { fill = wmTempColor(z.tempC); label = `${z.tempC}°`; }
    else if (overlay === 'cloud')  { fill = `rgba(200,206,220,${cloud.toFixed(2)})`; }
    else if (overlay === 'precip') { fill = z.precipType === 'snow' ? `rgba(235,240,255,${precip.toFixed(2)})` : `rgba(70,120,240,${precip.toFixed(2)})`; }
    else if (overlay === 'humid')  { fill = wmHumidColor(z.humidityPct); if (z.humidityPct != null) label = `${z.humidityPct}%`; }
    else if (overlay === 'wind')   { fill = `rgba(200,206,220,${(cloud * 0.6).toFixed(2)})`; }
    const tip = `${z.name} (${z.grid_x},${z.grid_y}) — ${z.tempC}°C, humidity ${z.humidityPct ?? '?'}%, cloud ${(cloud * 100) | 0}%, precip ${(precip * 100) | 0}%`;
    tiles += `<rect x="${x + 1}" y="${y + 1}" width="${cell - 2}" height="${cell - 2}" rx="3" fill="${fill}" stroke="var(--border)" stroke-width="1"><title>${tip}</title></rect>`;
    if (label) tiles += `<text x="${x + cell / 2}" y="${y + cell / 2 + 3}" text-anchor="middle" font-size="10" fill="#fff" style="pointer-events:none">${label}</text>`;
  }

  let sys = '';
  const arrowScale = cell * 6;
  for (const s of (data.systems || [])) {
    const scx = pad + (s.x - minX) * cell + cell / 2;
    const scy = pad + (s.y - minY) * cell + cell / 2;
    const r = Math.max(6, s.radius * cell);
    const col = s.type === 'storm' ? 'var(--yellow)' : s.type === 'precip' ? '#5a8cf0' : '#c8ccd8';
    sys += `<circle cx="${scx.toFixed(1)}" cy="${scy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${col}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.8"/>`;
    if (overlay === 'wind' || s.type === 'storm') {
      const ex = scx + s.vx * arrowScale, ey = scy + s.vy * arrowScale;
      sys += `<line x1="${scx.toFixed(1)}" y1="${scy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${col}" stroke-width="2" marker-end="url(#tw-arrow)"/>`;
    }
    if (s.type === 'storm') sys += `<text x="${scx.toFixed(1)}" y="${(scy - r - 3).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--yellow)">⚡</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto;font-family:var(--font)">
    <defs><marker id="tw-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#c8ccd8"/></marker></defs>
    ${tiles}${sys}
  </svg>`;
}

// region_id → display name, lazily fetched from /maps/regions (same source the Maps
// panel uses). Falls back to the raw id label if the fetch hasn't landed yet.
let _twRegionNames = null;
async function _twLoadRegionNames() {
  if (_twRegionNames) return;
  const d = await API('/maps/regions').catch(() => null);
  _twRegionNames = new Map((d?.regions || []).map(r => [r.id, r.name]));
  const host = document.getElementById('tw-weathermap');
  if (host && window._twWeatherMapData) paintWeatherMap();   // relabel options once names arrive
}

// Rebuild the region dropdown from the region_ids actually present in the current
// weather-map data, so empty regions never clutter the list. There is no "all" view —
// the map always shows exactly one region, defaulting to the Coldwater Basin.
const TW_DEFAULT_REGION = 'region_coldwater';
function _twPaintRegionOptions(zones) {
  const sel = document.getElementById('tw-wm-region');
  if (!sel) return;
  const ids = [...new Set(zones.map(z => z.region_id).filter(Boolean))].sort();
  // Resolve the active region: keep the current pick if it's still present, else the
  // Coldwater Basin default, else the first available region.
  let cur = window._twRegion;
  if (!cur || !ids.includes(cur)) cur = ids.includes(TW_DEFAULT_REGION) ? TW_DEFAULT_REGION : (ids[0] || '');
  window._twRegion = cur;
  const label = id => (_twRegionNames?.get(id)) || id;
  sel.innerHTML = ids.map(id => `<option value="${id}"${id === cur ? ' selected' : ''}>${label(id)}</option>`).join('');
  sel.value = cur;
}

function setWeatherRegion(id) {
  window._twRegion = id || '';
  paintWeatherMap();
}

// Compact per-region climate-lean editor. Prefills from the field's *effective*
// bias (data.regionBias — the applied numbers, incl. any hardcoded default), and
// writes an override to regions.climate_bias, which rebuilds the field live.
function _twPaintClimateEditor() {
  const host = document.getElementById('tw-wm-climate');
  if (!host) return;
  const region = window._twRegion || '';
  if (!region) { host.innerHTML = ''; host.dataset.region = ''; return; }
  // Don't clobber the inputs while the dev is typing (the 12s poll re-paints).
  const active = document.activeElement;
  if (host.dataset.region === region && active && (active.id === 'tw-cl-temp' || active.id === 'tw-cl-dry')) return;
  host.dataset.region = region;
  const name = (_twRegionNames?.get(region)) || region;
  const cur = (window._twWeatherMapData?.regionBias || []).find(b => b.id === region) || {};
  const temp = cur.temp != null ? cur.temp : '';
  const dry = cur.dryness != null ? cur.dryness : '';
  host.innerHTML =
    `<span>Climate lean — <strong style="color:var(--text)">${name}</strong>:</span>` +
    `<label>Temp <input id="tw-cl-temp" type="number" step="1" value="${temp}" placeholder="0" style="width:52px;background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:2px 4px"> °C</label>` +
    `<label>Dryness <input id="tw-cl-dry" type="number" step="0.05" min="0" max="1" value="${dry}" placeholder="normal" style="width:64px;background:var(--bg3);color:var(--text);border:1px solid var(--border);border-radius:3px;padding:2px 4px"></label>` +
    `<button class="action-btn" onclick="saveRegionClimate()" style="font-size:11px;padding:2px 8px">Save</button>` +
    `<span style="color:var(--text-dim)">(blank = baseline; dryness 0–1, lower = drier)</span>`;
}

async function saveRegionClimate() {
  const region = window._twRegion || '';
  if (!region) return;
  const tv = document.getElementById('tw-cl-temp')?.value ?? '';
  const dv = document.getElementById('tw-cl-dry')?.value ?? '';
  const body = { region_id: region, temp: tv === '' ? 0 : Number(tv), dryness: dv === '' ? null : Number(dv) };
  const r = await API('/environment/climate/region-bias', 'POST', body);
  if (r && r.ok) {
    const d = await API('/environment/weathermap');   // pull the now-applied field
    if (d && !d.error) { window._twWeatherMapData = d; paintWeatherMap(); }
    if (typeof toast === 'function') toast(`Climate lean saved for ${(_twRegionNames?.get(region)) || region}`);
  } else if (typeof toast === 'function') toast((r && r.error) || 'Save failed', true);
}

function paintWeatherMap() {
  const host = document.getElementById('tw-weathermap');
  if (!host) return;
  const data = window._twWeatherMapData;
  if (!data || !data.zones?.length) {
    host.innerHTML = '<div style="color:var(--text-dim);font-size:12px">No outdoor zones placed on the map.</div>';
    return;
  }
  if (!_twRegionNames) _twLoadRegionNames();
  _twPaintRegionOptions(data.zones);
  _twPaintClimateEditor();
  const overlay = window._twOverlay || 'temp';
  const region = window._twRegion || '';
  // Scoping to a region drops data.bounds so buildWeatherMapSVG auto-fits to just the
  // region's tiles (otherwise the whole-world snapshot bounds re-expand the extent).
  const scoped = region
    ? { ...data, zones: data.zones.filter(z => z.region_id === region), bounds: null }
    : data;
  if (!scoped.zones.length) {
    host.innerHTML = '<div style="color:var(--text-dim);font-size:12px">No sampled zones in this region.</div>';
  } else {
    host.innerHTML = buildWeatherMapSVG(scoped, overlay);
  }
  const legend = document.getElementById('tw-wm-legend');
  if (legend) legend.textContent = WM_LEGEND[overlay] || '';
}

function setWeatherOverlay(mode) {
  window._twOverlay = mode;
  const wrap = document.getElementById('tw-wm-toggles');
  if (wrap) for (const b of wrap.children) {
    const on = (b.getAttribute('onclick') || '').includes(`'${mode}'`);
    b.style.borderColor = on ? 'var(--accent2)' : '';
    b.style.color = on ? 'var(--accent2)' : '';
  }
  paintWeatherMap();
}

function startWeatherMapPolling() {
  if (window._twWeatherMapInterval) { clearInterval(window._twWeatherMapInterval); window._twWeatherMapInterval = null; }
  if (!window._twOverlay) window._twOverlay = 'temp';
  const tick = async () => {
    const host = document.getElementById('tw-weathermap');
    if (!host) { clearInterval(window._twWeatherMapInterval); window._twWeatherMapInterval = null; return; }
    const d = await API('/environment/weathermap');
    if (d && !d.error) { window._twWeatherMapData = d; paintWeatherMap(); }
  };
  tick();
  window._twWeatherMapInterval = setInterval(tick, 12_000);
  setWeatherOverlay(window._twOverlay);
}

async function devApplyTime() {
  const dateVal = document.getElementById('tw-date').value;
  const timeVal = document.getElementById('tw-time').value;
  const [h,m] = (timeVal||'00:00').split(':').map(Number);
  const minutes = h*60 + m;
  const r = await API('/environment/time/set','POST',{date:dateVal||undefined,minutes});
  if (r.error) { toast(r.error,true); return; }
  toast('Time updated and synced to all clients');
  loadPanel('timeweather');
}

async function devToggleFreeze() {
  const env = (await API('/environment/state')) || {};
  const r = await API('/environment/time/freeze','POST',{frozen:!env.frozen});
  if (r.error) { toast(r.error,true); return; }
  toast(r.frozen ? 'Time frozen' : 'Time resumed');
  loadPanel('timeweather');
}

async function devUnlockGameSpeed() {
  const ok = await dpConfirm(
    'Changing the game speed re-rates the entire world clock: day/night, calendar, weather, NPC schedules, and every in-world timer (survival, jail, drugs, grudges, rent) will run faster or slower from this point on. In-flight timers set before the change keep their original length. Proceed to unlock the control?',
    { title: '⚠ Unlock Game Speed', okLabel: 'Unlock', danger: true }
  );
  if (!ok) return;
  _gameSpeedUnlocked = true;
  document.getElementById('tw-scale-locked').style.display = 'none';
  document.getElementById('tw-scale-controls').style.display = 'flex';
  const badge = document.getElementById('tw-scale-lockbadge');
  if (badge) { badge.textContent = '🔓 Unlocked'; badge.style.color = 'var(--accent2)'; }
}

async function devApplyGameSpeed(preset) {
  if (!_gameSpeedUnlocked) { toast('Unlock the speed control first', true); return; }
  const scale = (preset != null) ? preset : Number(document.getElementById('tw-scale')?.value);
  if (!Number.isFinite(scale) || scale <= 0) { toast('Enter a positive multiplier', true); return; }
  const r = await API('/environment/time/scale','POST',{scale});
  if (r.error) { toast(r.error,true); return; }
  toast(`Game speed set to ${scale}× — a 24h day now takes ${(24/scale).toFixed(1)}h real`);
  loadPanel('timeweather');
}

function startPanelClock() {
  if (_panelClockTimeout)  { clearTimeout(_panelClockTimeout);   _panelClockTimeout  = null; }
  if (_panelClockInterval) { clearInterval(_panelClockInterval); _panelClockInterval = null; }
  const tick = async () => {
    const el = document.getElementById('tw-live-clock');
    if (!el) {
      clearInterval(_panelClockInterval); _panelClockInterval = null;
      return;
    }
    const s = await API('/environment/state');
    if (s?.time) el.textContent = s.time;
  };
  const secsRemaining = 60 - new Date().getSeconds();
  _panelClockTimeout = setTimeout(() => {
    _panelClockTimeout = null;
    tick();
    _panelClockInterval = setInterval(tick, 60_000);
  }, secsRemaining * 1000);
}

async function devSyncToMyClockNow() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const date = now.toISOString().slice(0, 10);
  const r = await API('/environment/time/set', 'POST', { date, minutes });
  if (r.error) { toast(r.error, true); return; }
  toast('Server time synced to your clock');
  loadPanel('timeweather');
  startPanelClock();
}

async function devForceTick(which) {
  const r = await API(`/environment/tick/${which}`, 'POST', {});
  if (r.error) { toast(r.error, true); return; }
  toast(`${which.replace('force','').toUpperCase()} tick fired`);
  loadPanel('timeweather');
}

const CLIMATE_PRESETS = {
  __reykjavik:   { name: 'Reykjavik',   monthly_temp_c: [-1,0,1,4,8,11,12,11,8,5,2,0],          monthly_precip_chance: [0.65,0.60,0.60,0.55,0.55,0.55,0.60,0.60,0.65,0.65,0.65,0.65], monthly_wind_kph: [30,29,28,25,22,20,19,20,24,28,31,31], monthly_humidity: [78,78,76,74,74,76,80,82,80,80,79,78] },
  __miami:       { name: 'Miami',       monthly_temp_c: [20,21,23,25,28,30,31,31,30,27,24,21],   monthly_precip_chance: [0.30,0.30,0.35,0.40,0.50,0.70,0.75,0.75,0.65,0.45,0.35,0.30], monthly_wind_kph: [17,18,19,20,18,16,15,15,16,18,18,17], monthly_humidity: [72,70,70,68,72,78,78,80,82,80,76,73] },
  __london:      { name: 'London',      monthly_temp_c: [5,5,8,11,14,18,20,20,16,12,8,5],        monthly_precip_chance: [0.50,0.45,0.45,0.45,0.45,0.50,0.50,0.50,0.50,0.55,0.55,0.50], monthly_wind_kph: [24,23,22,19,17,16,16,16,17,20,22,24], monthly_humidity: [86,82,78,72,72,70,70,72,78,82,85,87] },
  __phoenix:     { name: 'Phoenix',     monthly_temp_c: [12,14,18,23,29,34,37,36,32,26,18,12],   monthly_precip_chance: [0.15,0.15,0.15,0.10,0.10,0.10,0.40,0.40,0.30,0.15,0.10,0.15], monthly_wind_kph: [12,13,15,17,17,15,14,13,13,12,11,11], monthly_humidity: [35,30,28,22,18,15,30,35,32,30,32,36] },
  __novosibirsk: { name: 'Novosibirsk', monthly_temp_c: [-16,-14,-6,4,13,19,22,19,12,3,-8,-14],  monthly_precip_chance: [0.35,0.30,0.30,0.35,0.40,0.45,0.50,0.45,0.40,0.40,0.40,0.40], monthly_wind_kph: [16,16,18,20,18,16,15,14,17,19,18,16], monthly_humidity: [80,78,75,65,58,62,70,72,74,76,82,82] },
  __coldwater:   { name: 'Coldwater Basin', monthly_temp_c: [-3,-2,1,5,10,14,16,15,11,6,1,-2],  monthly_precip_chance: [0.55,0.52,0.50,0.48,0.45,0.45,0.48,0.50,0.55,0.60,0.60,0.58], monthly_wind_kph: [10,10,11,12,12,11,10,10,11,12,11,10], monthly_humidity: [88,87,85,82,80,82,85,87,90,90,89,88] },
};

function devLoadClimatePreset(val) {
  if (!val) { return; }
  // City preset
  if (val.startsWith('__')) {
    const p = CLIMATE_PRESETS[val];
    if (!p) return;
    document.getElementById('tw-climate-name').value = p.name;
    p.monthly_temp_c.forEach((v, i) => { const el = document.getElementById(`tw-t-${i}`); if (el) el.value = v; });
    p.monthly_precip_chance.forEach((v, i) => { const el = document.getElementById(`tw-p-${i}`); if (el) el.value = Math.round(v * 100); });
    (p.monthly_wind_kph || []).forEach((v, i) => { const el = document.getElementById(`tw-w-${i}`); if (el) el.value = v; });
    (p.monthly_humidity || []).forEach((v, i) => { const el = document.getElementById(`tw-h-${i}`); if (el) el.value = v; });
    return;
  }
  // Saved profile — find it in current panel data
  const profiles = (window._twClimateProfiles || []);
  const p = profiles.find(x => x.id === val);
  if (!p) return;
  document.getElementById('tw-climate-name').value = p.name;
  p.monthly_temp_c.forEach((v, i) => { const el = document.getElementById(`tw-t-${i}`); if (el) el.value = v; });
  p.monthly_precip_chance.forEach((v, i) => { const el = document.getElementById(`tw-p-${i}`); if (el) el.value = Math.round(v * 100); });
  (p.monthly_wind_kph || []).forEach((v, i) => { const el = document.getElementById(`tw-w-${i}`); if (el) el.value = v; });
  (p.monthly_humidity || []).forEach((v, i) => { const el = document.getElementById(`tw-h-${i}`); if (el) el.value = v; });
}

function devReadClimateInputs() {
  const monthly_temp_c = Array.from({length:12}, (_,i) => Number(document.getElementById(`tw-t-${i}`)?.value ?? 0));
  const monthly_precip_chance = Array.from({length:12}, (_,i) => Math.min(1, Math.max(0, Number(document.getElementById(`tw-p-${i}`)?.value ?? 40) / 100)));
  const monthly_wind_kph = Array.from({length:12}, (_,i) => Math.max(0, Number(document.getElementById(`tw-w-${i}`)?.value ?? 0)));
  const monthly_humidity = Array.from({length:12}, (_,i) => Math.min(100, Math.max(0, Number(document.getElementById(`tw-h-${i}`)?.value ?? 0))));
  const name = document.getElementById('tw-climate-name')?.value?.trim();
  return { name, monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity };
}

async function devSaveClimateProfile() {
  const sel = document.getElementById('tw-climate-select');
  const existingId = sel?.value && !sel.value.startsWith('__') ? sel.value : undefined;
  const { name, monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity } = devReadClimateInputs();
  if (!name) { toast('Enter a profile name', true); return; }
  const r = await API('/environment/climate/profiles', 'POST', { id: existingId, name, monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity });
  if (r.error) { toast(r.error, true); return; }
  toast(`Climate profile "${name}" saved`);
  loadPanel('timeweather');
}

async function devSetActiveClimate() {
  const sel = document.getElementById('tw-climate-select');
  const id = sel?.value && !sel.value.startsWith('__') ? sel.value : null;
  if (!id) {
    // Save first if custom, then set active
    const { name, monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity } = devReadClimateInputs();
    if (!name) { toast('Save the profile first, then set it active', true); return; }
    const saved = await API('/environment/climate/profiles', 'POST', { name, monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity });
    if (saved.error) { toast(saved.error, true); return; }
    const r = await API('/environment/climate/active', 'POST', { id: saved.id });
    if (r.error) { toast(r.error, true); return; }
    toast(`"${name}" saved and set as active profile`);
  } else {
    const r = await API('/environment/climate/active', 'POST', { id });
    if (r.error) { toast(r.error, true); return; }
    toast('Active climate profile updated');
  }
  loadPanel('timeweather');
}

async function devRecalculateForecast() {
  const { monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity } = devReadClimateInputs();
  const r = await API('/environment/climate/recalculate', 'POST', { monthly_temp_c, monthly_precip_chance, monthly_wind_kph, monthly_humidity });
  if (r.error) { toast(r.error, true); return; }
  toast('Forecast recalculated');
  loadPanel('timeweather');
}

async function devClearWeatherOverride() {
  const r = await API('/environment/weather/override', 'DELETE');
  if (r.error) { toast(r.error, true); return; }
  toast('Weather override cleared — following forecast');
  loadPanel('timeweather');
}

async function devApplyWeather() {
  let weatherType = document.getElementById('tw-weather').value;
  const tempC = Number(document.getElementById('tw-temp').value);
  const precipChance = Math.min(1, Math.max(0, Number(document.getElementById('tw-precip').value) / 100));
  if (precipChance >= 0.70) {
    weatherType = tempC <= 1 ? 'snow' : 'rain';
    document.getElementById('tw-weather').value = weatherType;
  }
  const r = await API('/environment/weather/override','POST',{weatherType,tempC,precipChance});
  if (r.error) { toast(r.error,true); return; }
  toast('Weather updated');
  loadPanel('timeweather');
}

async function devScheduleForecastDay() {
  const forecastDay = Number(document.getElementById('tw-sched-day').value);
  const weatherType = document.getElementById('tw-sched-weather').value;
  const tempVal = document.getElementById('tw-sched-temp').value;
  const windVal = document.getElementById('tw-sched-wind').value;
  const body = { forecastDay, weatherType };
  if (tempVal !== '') body.tempC = Number(tempVal);
  if (windVal !== '') body.windKph = Number(windVal);
  const r = await API('/environment/weather/schedule', 'POST', body);
  if (r.error) { toast(r.error, true); return; }
  toast(`Day ${forecastDay + 1} scheduled: ${weatherType}`);
  loadPanel('timeweather');
}

async function devResetBuildingTemps() {
  const r = await API('/environment/weather/reset-building-temps', 'POST');
  if (r.error) { toast(r.error, true); return; }
  toast(`Reset ${r.reset} indoor zone(s) to 20°C`);
}

async function devMaxStorm() {
  const r = await API('/environment/weather/maxstorm', 'POST', {});
  if (r.error) { toast(r.error, true); return; }
  toast('⛈ Max storm forced — thunderstorm at precipRate 1.0');
  loadPanel('timeweather');
}

// Fire a named hero weather event (acid rain / ion storm). The route and the
// engine path have existed since step 7 — the panel simply never had a control
// for them, so the only ways to start one were the action registry or blowing up
// a city plant. Confirmed before firing because this is not a preview: it
// announces itself to every player outdoors and runs a full
// approach → peak → passing lifecycle.
async function devTriggerHeroEvent(type) {
  const label = type === 'acid_rain' ? 'ACID RAIN' : 'ION STORM';
  if (!confirm(`Fire ${label} on the live world?\n\nIt announces to every player outdoors and runs its full lifecycle. One hero event at a time.`)) return;
  const r = await API('/environment/weather/event', 'POST', { type });
  if (r?.error || r?.ok === false) { toast(r?.error || `Could not start ${label}`, true); return; }
  toast(`⚠⚠ ${r?.label || label} incoming`);
  loadPanel('timeweather');
}

async function devDeleteClimateProfile() {
  const sel = document.getElementById('tw-climate-select');
  const id = sel?.value;
  if (!id || id.startsWith('__')) { toast('Select a saved profile to delete', true); return; }
  const name = window._twClimateProfiles?.find(p => p.id === id)?.name || id;
  if (!(await dpConfirm(`Delete climate profile "${name}"?`, { danger: true }))) return;
  const r = await API(`/environment/climate/profiles/${encodeURIComponent(id)}`, 'DELETE');
  if (r.error) { toast(r.error, true); return; }
  toast(`Profile "${name}" deleted`);
  loadPanel('timeweather');
}

