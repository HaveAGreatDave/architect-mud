function renderTimeWeatherPanel(data) {
  const panel = document.getElementById('list-panel');
  const env = data?.env || {};
  const forecast = data?.forecast || [];

  const timeStr = env.time || '00:00';
  const WEATHER_TYPES = ['clear','cloudy','overcast','rain','sleet','thunderstorm','storm','snow','blizzard','fog','haze','ash'];
  const WEATHER_PRECIP_CHANCE = { rain:0.70, thunderstorm:0.70, storm:0.70, sleet:0.70, snow:0.70, blizzard:0.70, overcast:0.25, cloudy:0.10, clear:0.03, fog:0.03, haze:0.03, ash:0.03 };
  const climateProfiles = data?.climateProfiles || [];
  const activeId = env.activeClimateProfileId || '';
  window._twClimateProfiles = climateProfiles;

  const forecastGrid = forecast.slice(0,7).map((f,i) => `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:12px;text-align:center;min-width:80px">
      <div style="font-size:10px;color:var(--text-dim);margin-bottom:4px">${i===0?'Today':'Day '+(i+1)}</div>
      <div style="font-size:24px;margin-bottom:4px">${f.icon||'?'}</div>
      <div style="font-size:11px;color:var(--text)">${f.weatherType||'?'}</div>
      ${f.tempC!=null?`<div style="font-size:10px;color:var(--text-dim);margin-top:2px">${f.tempC}°C</div>`:''}
    </div>`).join('');

  panel.innerHTML = `
    <div style="padding:24px;max-width:700px;display:flex;flex-direction:column;gap:24px">

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:16px">Current State</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;font-size:13px">
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">TIME</div><div id="tw-live-clock" style="color:var(--text-bright);font-size:18px;font-weight:700">${timeStr}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">DATE</div><div style="color:var(--text)">${env.date||'—'}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">SEASON</div><div style="color:var(--text)">${env.season||'—'}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">WEATHER</div><div style="color:var(--text)">${env.currentWeatherIcon||''} ${env.currentWeatherType||'—'}</div>${env.currentWeatherType!==env.weatherType?`<div style="color:var(--text-dim);font-size:10px;margin-top:2px">forecast: ${env.weatherType}</div>`:''}</div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">TEMPERATURE</div><div style="color:var(--text)">${env.tempC!=null?env.tempC+'°C':'—'}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">INTENSITY</div><div style="color:var(--text)">${env.currentIntensity||'—'}</div></div>
          <div><div style="color:var(--text-dim);font-size:10px;margin-bottom:2px">STATUS</div><div style="color:${env.frozen?'var(--red)':'var(--accent2)'}">${env.frozen?'⏸ Frozen':'▶ Running'}</div></div>
        </div>
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

      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">7-Day Forecast</div>
          <button class="action-btn" onclick="devRecalculateForecast()" title="Regenerate unlocked forecast days using the active climate profile">↻ Recalculate Forecast</button>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">${forecastGrid||'<div style="color:var(--text-dim);font-size:12px">No forecast data.</div>'}</div>
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

        <div>
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px">Monthly Precipitation Chance (%)</div>
          <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:4px">
            ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m,i)=>`
              <div style="text-align:center">
                <div style="font-size:10px;color:var(--text-dim);margin-bottom:3px">${m}</div>
                <input id="tw-p-${i}" type="number" min="0" max="100" value="${Math.round(((climateProfiles.find(p=>p.id===activeId)?.monthly_precip_chance||[])[i]??'')*100)||''}" placeholder="—" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 2px;border-radius:2px;text-align:center">
              </div>`).join('')}
          </div>
        </div>
      </div>

    </div>`;

  startPanelClock();
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
  __reykjavik:   { name: 'Reykjavik',   monthly_temp_c: [-1,0,1,4,8,11,12,11,8,5,2,0],          monthly_precip_chance: [0.65,0.60,0.60,0.55,0.55,0.55,0.60,0.60,0.65,0.65,0.65,0.65] },
  __miami:       { name: 'Miami',       monthly_temp_c: [20,21,23,25,28,30,31,31,30,27,24,21],   monthly_precip_chance: [0.30,0.30,0.35,0.40,0.50,0.70,0.75,0.75,0.65,0.45,0.35,0.30] },
  __london:      { name: 'London',      monthly_temp_c: [5,5,8,11,14,18,20,20,16,12,8,5],        monthly_precip_chance: [0.50,0.45,0.45,0.45,0.45,0.50,0.50,0.50,0.50,0.55,0.55,0.50] },
  __phoenix:     { name: 'Phoenix',     monthly_temp_c: [12,14,18,23,29,34,37,36,32,26,18,12],   monthly_precip_chance: [0.15,0.15,0.15,0.10,0.10,0.10,0.40,0.40,0.30,0.15,0.10,0.15] },
  __novosibirsk: { name: 'Novosibirsk', monthly_temp_c: [-16,-14,-6,4,13,19,22,19,12,3,-8,-14],  monthly_precip_chance: [0.35,0.30,0.30,0.35,0.40,0.45,0.50,0.45,0.40,0.40,0.40,0.40] },
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
    return;
  }
  // Saved profile — find it in current panel data
  const profiles = (window._twClimateProfiles || []);
  const p = profiles.find(x => x.id === val);
  if (!p) return;
  document.getElementById('tw-climate-name').value = p.name;
  p.monthly_temp_c.forEach((v, i) => { const el = document.getElementById(`tw-t-${i}`); if (el) el.value = v; });
  p.monthly_precip_chance.forEach((v, i) => { const el = document.getElementById(`tw-p-${i}`); if (el) el.value = Math.round(v * 100); });
}

function devReadClimateInputs() {
  const monthly_temp_c = Array.from({length:12}, (_,i) => Number(document.getElementById(`tw-t-${i}`)?.value ?? 0));
  const monthly_precip_chance = Array.from({length:12}, (_,i) => Math.min(1, Math.max(0, Number(document.getElementById(`tw-p-${i}`)?.value ?? 40) / 100)));
  const name = document.getElementById('tw-climate-name')?.value?.trim();
  return { name, monthly_temp_c, monthly_precip_chance };
}

async function devSaveClimateProfile() {
  const sel = document.getElementById('tw-climate-select');
  const existingId = sel?.value && !sel.value.startsWith('__') ? sel.value : undefined;
  const { name, monthly_temp_c, monthly_precip_chance } = devReadClimateInputs();
  if (!name) { toast('Enter a profile name', true); return; }
  const r = await API('/environment/climate/profiles', 'POST', { id: existingId, name, monthly_temp_c, monthly_precip_chance });
  if (r.error) { toast(r.error, true); return; }
  toast(`Climate profile "${name}" saved`);
  loadPanel('timeweather');
}

async function devSetActiveClimate() {
  const sel = document.getElementById('tw-climate-select');
  const id = sel?.value && !sel.value.startsWith('__') ? sel.value : null;
  if (!id) {
    // Save first if custom, then set active
    const { name, monthly_temp_c, monthly_precip_chance } = devReadClimateInputs();
    if (!name) { toast('Save the profile first, then set it active', true); return; }
    const saved = await API('/environment/climate/profiles', 'POST', { name, monthly_temp_c, monthly_precip_chance });
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
  const { monthly_temp_c, monthly_precip_chance } = devReadClimateInputs();
  const r = await API('/environment/climate/recalculate', 'POST', { monthly_temp_c, monthly_precip_chance });
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

async function devDeleteClimateProfile() {
  const sel = document.getElementById('tw-climate-select');
  const id = sel?.value;
  if (!id || id.startsWith('__')) { toast('Select a saved profile to delete', true); return; }
  const name = window._twClimateProfiles?.find(p => p.id === id)?.name || id;
  if (!confirm(`Delete climate profile "${name}"?`)) return;
  const r = await API(`/environment/climate/profiles/${encodeURIComponent(id)}`, 'DELETE');
  if (r.error) { toast(r.error, true); return; }
  toast(`Profile "${name}" deleted`);
  loadPanel('timeweather');
}

