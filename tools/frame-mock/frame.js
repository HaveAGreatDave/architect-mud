// Frame mockup, phase 0. Renders the captured payloads in payloads.js as the
// Frame layout. Nothing here talks to a server: a button shows the verb it would
// send, and only the steps that were actually captured can be played.
(() => {
  const DATA = window.FRAME_PAYLOADS;
  const $ = (id) => document.getElementById(id);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── seeded randomness, so a place or a face draws the same every time ────────
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    let a = hash(seed);
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  // ── the room model ───────────────────────────────────────────────────────────
  // A prototype of the phase 1 parser: describeZone's markup, read by class, the
  // way server/engine/room-brief.js already reads it.
  function parseRoom(html) {
    const root = document.createElement('div');
    root.innerHTML = html;
    const q = (s) => root.querySelector(s);
    const qa = (s) => [...root.querySelectorAll(s)];
    const dirOf = (el) => {
      const p = el.previousElementSibling;
      return p && p.classList.contains('dir-tag') ? p.textContent.replace(/[[\]]/g, '').toLowerCase() : null;
    };
    const verbOf = (el) => {
      const a = el.dataset.action;
      if (a === 'cmd') return el.dataset.cmd;
      if (a === 'go') return el.dataset.target;
      return `${a} ${el.dataset.target}`;
    };
    const district = q('.zone-district');
    const light = q('.light-level');
    return {
      name: q('.zone-name')?.textContent.trim() || '',
      danger: (q('.zone-danger')?.className.match(/zone-danger-(\w+)/) || [])[1] || null,
      district: district ? { name: district.textContent.replace(/·/g, '').trim(), color: district.style.color || null } : null,
      light: light ? { text: light.textContent.trim(), level: (light.className.match(/light-(?!level)(\w+)/) || [])[1] || null } : null,
      people: qa('.npc-link').map((el) => ({ name: el.dataset.target, verb: verbOf(el) })),
      hostiles: qa('.enemy-link').map((el) => {
        const m = (el.nextSibling?.textContent || '').match(/\((\d+)\/(\d+)HP\)/);
        return { name: el.dataset.target, id: el.dataset.instanceId, hp: m ? +m[1] : null, hpMax: m ? +m[2] : null, verb: verbOf(el) };
      }),
      things: qa('.furniture-link:not(.furniture-woven)').map((el) => {
        const first = verbOf(el);
        const more = (el.dataset.actions || '').split(/\s+/).filter((a) => a && a !== el.dataset.cmd).map((a) => `${a} ${el.dataset.target}`);
        return { name: el.textContent.trim(), kind: el.dataset.ftype || null, verbs: [first, ...more.filter((v) => v !== first)] };
      }),
      exits: [
        ...qa('.exits-row .exit-link, .rooms-row .room-nav-link').map((el) => ({ dir: dirOf(el), dest: el.dataset.dest, locked: null, verb: verbOf(el) })),
        ...qa('.exits-row .door-link').map((el) => ({ dir: dirOf(el), dest: 'Door', locked: el.dataset.lock || null, verb: dirOf(el) })),
      ],
      places: qa('.building-link').map((el) => ({ dir: dirOf(el), name: el.dataset.dest, locked: el.dataset.lock || null, verb: verbOf(el) })),
      prose: q('.room-desc')?.innerHTML || '',
      notes: qa('.room-furniture, .signal-row, .ambient-row').map((el) => el.innerHTML),
    };
  }

  // ── placeholder scene art (phase 3 swaps in a GLASS still or hand art) ───────
  function sceneKind(zone) {
    if (zone.terrain === 'sewer') return 'sewer';
    if (zone.map_id !== 'map_world') return 'interior';
    return 'street';
  }

  function streetArt(seed) {
    const r = rng(seed);
    const W = 1200;
    let far = '', mid = '', win = '', puddles = '', posts = '';
    for (let x = -20; x < W; x += 30 + r() * 50) {
      const h = 60 + r() * 100;
      far += `<rect x="${x.toFixed(0)}" y="${(205 - h).toFixed(0)}" width="${(34 + r() * 40).toFixed(0)}" height="${h.toFixed(0)}"/>`;
    }
    for (let x = -30; x < W; x += 60 + r() * 70) {
      const w = 50 + r() * 70, h = 40 + r() * 90, y = 210 - h;
      mid += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}"/>`;
      for (let wy = y + 8; wy < 200; wy += 12) for (let wx = x + 6; wx < x + w - 8; wx += 11) {
        if (r() < 0.16) win += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="5" height="6" opacity="${(0.4 + r() * 0.5).toFixed(2)}"/>`;
      }
    }
    for (let i = 0; i < 7; i++) {
      const t = r(), y = 220 + t * 70, spread = 60 + t * 260;
      puddles += `<ellipse cx="${(600 + (r() - 0.5) * 2 * spread).toFixed(0)}" cy="${y.toFixed(0)}" rx="${(14 + t * 60).toFixed(0)}" ry="${(2 + t * 7).toFixed(1)}"/>`;
    }
    for (const x of [250, 420, 780, 950]) {
      const near = Math.abs(600 - x) > 250;
      posts += `<line x1="${x}" y1="${near ? 290 : 232}" x2="${x}" y2="${near ? 120 : 165}" stroke-width="${near ? 5 : 3}"/>`;
    }
    return `<svg viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#171a2e"/><stop offset=".55" stop-color="#3a2b3a"/><stop offset="1" stop-color="#b0683a"/></linearGradient>
        <linearGradient id="road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2824"/><stop offset="1" stop-color="#3b3730"/></linearGradient>
        <filter id="blur"><feGaussianBlur stdDeviation="18"/></filter>
      </defs>
      <rect width="1200" height="300" fill="url(#sky)"/>
      <circle cx="840" cy="250" r="170" fill="#f0a050" opacity=".28" filter="url(#blur)"/>
      <g fill="#262538" opacity=".9">${far}</g>
      <g fill="#121319">${mid}</g>
      <g fill="#f2c56a">${win}</g>
      <g fill="#d8d2c8" opacity=".14" filter="url(#blur)"><circle cx="1010" cy="120" r="50"/><circle cx="1060" cy="80" r="60"/><circle cx="1100" cy="40" r="70"/></g>
      <rect y="205" width="1200" height="95" fill="#191816"/>
      <polygon points="0,300 1200,300 730,205 470,205" fill="url(#road)"/>
      <g fill="#8a6a72" opacity=".35">${puddles}</g>
      <g stroke="#0c0c0f">${posts}</g>
    </svg>`;
  }

  function barArt(seed) {
    const r = rng(seed);
    const colours = ['#3d6b4a', '#8a5a2a', '#c9a24a', '#6a2a2a', '#2a4a6a', '#d9d4c0', '#5a3a6a'];
    let bottles = '';
    for (const shelf of [78, 128, 178]) {
      for (let x = 130; x < 1070; x += 14 + r() * 16) {
        if (r() < 0.12) continue;
        const w = 9 + r() * 9, h = 22 + r() * 22;
        bottles += `<rect x="${x.toFixed(0)}" y="${(shelf - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="2" fill="${pick(r, colours)}" opacity=".85"/>`;
        bottles += `<rect x="${(x + w * 0.4).toFixed(0)}" y="${(shelf - h - 7).toFixed(0)}" width="${(w * 0.25).toFixed(1)}" height="8" fill="#1a120c"/>`;
      }
    }
    let lamps = '';
    for (const x of [300, 600, 900]) {
      lamps += `<line x1="${x}" y1="0" x2="${x}" y2="44" stroke="#0e0906" stroke-width="2"/>
        <circle cx="${x}" cy="70" r="90" fill="#ffcf7a" opacity=".22" filter="url(#glow)"/>
        <path d="M${x - 22} 58 L${x + 22} 58 L${x + 10} 42 L${x - 10} 42 Z" fill="#2a1a10"/>
        <ellipse cx="${x}" cy="59" rx="18" ry="3" fill="#ffe2a0"/>`;
    }
    return `<svg viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e1c12"/><stop offset="1" stop-color="#160e09"/></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="24"/></filter>
      </defs>
      <rect width="1200" height="300" fill="url(#wall)"/>
      <rect x="110" y="20" width="980" height="170" fill="#3a2a22" opacity=".35"/>
      ${bottles}
      <g fill="#5a3a22">${[78, 128, 178].map((y) => `<rect x="110" y="${y}" width="980" height="6"/>`).join('')}</g>
      ${lamps}
      <rect x="0" y="214" width="1200" height="86" fill="#24160d"/>
      <rect x="0" y="206" width="1200" height="10" fill="#6a4428"/>
      <rect x="0" y="206" width="1200" height="2" fill="#a07048" opacity=".7"/>
      <g fill="#14100c"><rect x="820" y="160" width="90" height="46" rx="4"/><rect x="842" y="140" width="46" height="20"/></g>
    </svg>`;
  }

  function sewerArt(seed, hostiles) {
    let arches = '';
    for (let i = 6; i >= 0; i--) {
      const s = 0.22 + i * 0.14, w = 1150 * s, h = 330 * s, cx = 600, yb = 205 + 95 * s, yt = yb - h;
      const x0 = cx - w / 2, x1 = cx + w / 2;
      const shade = Math.round(14 + i * 6);
      arches += `<path d="M${x0} ${yb} L${x0} ${yt + h * 0.45} A${w / 2} ${h * 0.55} 0 0 1 ${x1} ${yt + h * 0.45} L${x1} ${yb} Z" fill="rgb(${shade - 6},${shade + 4},${shade})" stroke="#2c3c34" stroke-width="${(3 + s * 10).toFixed(1)}"/>`;
    }
    let walkers = '';
    hostiles.slice(0, 2).forEach((_, i) => {
      const x = 520 + i * 150, base = 250 - i * 14, k = 1 - i * 0.18;
      walkers += `<g stroke="#050807" stroke-width="${(3 * k).toFixed(1)}" fill="#050807" stroke-linecap="round">
        <line x1="${x - 18 * k}" y1="${base}" x2="${x - 4 * k}" y2="${base - 90 * k}"/><line x1="${x + 18 * k}" y1="${base}" x2="${x + 4 * k}" y2="${base - 90 * k}"/>
        <ellipse cx="${x}" cy="${base - 100 * k}" rx="${13 * k}" ry="${17 * k}"/>
        <line x1="${x - 6 * k}" y1="${base - 108 * k}" x2="${x - 30 * k}" y2="${base - 60 * k}"/><line x1="${x + 6 * k}" y1="${base - 108 * k}" x2="${x + 32 * k}" y2="${base - 64 * k}"/>
        <circle cx="${x + 5 * k}" cy="${base - 122 * k}" r="${7 * k}"/>
        <circle cx="${x + 8 * k}" cy="${base - 123 * k}" r="${1.4 * k}" fill="#d8e070" stroke="none"/></g>`;
    });
    return `<svg viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="water" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#2f5a3a"/><stop offset="1" stop-color="#0e1a14"/></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="20"/></filter>
      </defs>
      <rect width="1200" height="300" fill="#070b0a"/>
      ${arches}
      <circle cx="600" cy="200" r="60" fill="#8ad0a0" opacity=".18" filter="url(#glow)"/>
      <polygon points="380,300 820,300 618,205 582,205" fill="url(#water)"/>
      <g stroke="#7ab88a" stroke-width="1.5" opacity=".25"><line x1="560" y1="262" x2="640" y2="262"/><line x1="585" y1="236" x2="615" y2="236"/><line x1="520" y1="285" x2="600" y2="285"/></g>
      ${walkers}
    </svg>`;
  }

  // ── placeholder portraits (phase 4 makes these from clothing and description) ─
  function portrait(seed, { sex = null, mutant = false } = {}) {
    const r = rng(seed);
    if (mutant) {
      return `<svg viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="mbg${hash(seed)}" cx=".5" cy=".4"><stop offset="0" stop-color="#3a4a2a"/><stop offset="1" stop-color="#0a0f08"/></radialGradient></defs>
        <rect x="-200" y="-200" width="520" height="520" fill="url(#mbg${hash(seed)})"/>
        <path d="M22 120 Q30 92 50 86 L70 86 Q92 90 100 120 Z" fill="#4a5a3a"/>
        <path d="M54 88 L50 60 L70 60 L66 88 Z" fill="#6a7a52"/>
        <ellipse cx="62" cy="40" rx="16" ry="27" fill="#8a9a6a" transform="rotate(12 62 40)"/>
        <circle cx="58" cy="38" r="2.6" fill="#e8f080"/><circle cx="70" cy="40" r="2" fill="#e8f080"/>
        <path d="M56 54 Q63 58 70 54" stroke="#2a3a1a" stroke-width="2" fill="none"/>
      </svg>`;
    }
    const skin = pick(r, ['#f1c9a5', '#d9a47c', '#b57a52', '#8a5536', '#5e3a24']);
    const hair = pick(r, ['#1c1612', '#3a2a1e', '#6a4a2a', '#a8a29a', '#c9b48a', '#7a2a1a']);
    const coat = pick(r, ['#3a4a5a', '#4a3a2a', '#2a3a2a', '#5a2a2a', '#3a3a44', '#6a5a3a']);
    const coat2 = pick(r, ['#2a3440', '#3a2a1e', '#1e2a1e', '#40201e', '#2a2a32', '#4a4028']);
    const hue = Math.floor(r() * 360);
    const style = sex === 'female' ? pick(r, ['long', 'long', 'short', 'cap']) : pick(r, ['short', 'short', 'bald', 'cap']);
    const hairPath = {
      short: `<path d="M40 50 Q40 24 60 24 Q80 24 80 50 Q76 34 60 34 Q44 34 40 50 Z" fill="${hair}"/>`,
      long: `<path d="M38 82 Q34 50 40 36 Q48 22 60 22 Q74 22 80 36 Q86 50 82 82 L76 82 Q78 52 74 40 Q66 32 60 32 Q50 32 46 40 Q42 52 44 82 Z" fill="${hair}"/>`,
      bald: '',
      cap: `<path d="M38 44 Q40 22 60 22 Q80 22 82 44 Z" fill="${coat2}"/><rect x="36" y="41" width="48" height="5" rx="2" fill="${coat2}"/>`,
    }[style];
    const id = 'pbg' + hash(seed);
    return `<svg viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="${id}" cx=".5" cy=".35"><stop offset="0" stop-color="hsl(${hue} 22% 30%)"/><stop offset="1" stop-color="hsl(${hue} 25% 9%)"/></radialGradient></defs>
      <rect x="-200" y="-200" width="520" height="520" fill="url(#${id})"/>
      <path d="M8 120 Q12 90 40 83 L80 83 Q108 90 112 120 Z" fill="${coat}"/>
      <path d="M40 83 L60 106 L80 83 L72 82 L60 96 L48 82 Z" fill="${coat2}"/>
      <rect x="52" y="64" width="16" height="22" fill="${skin}" opacity=".85"/>
      <ellipse cx="60" cy="52" rx="19" ry="23" fill="${skin}"/>
      ${hairPath}
      <ellipse cx="53" cy="53" rx="2.2" ry="1.5" fill="#1a1410"/><ellipse cx="67" cy="53" rx="2.2" ry="1.5" fill="#1a1410"/>
      <path d="M49 47 L57 46 M63 46 L71 47" stroke="${hair}" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M55 65 Q60 67 65 65" stroke="#5a3022" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    </svg>`;
  }

  // ── state ────────────────────────────────────────────────────────────────────
  let scene = null;          // key into DATA.scenes
  let S = null;              // the scene's capture
  let room = null;           // parsed room model
  let vitals = null;         // the player's numbers, updated by captured hits
  let round = 0;             // fight: how many captured exchanges have played
  let lastHit = null;        // fight: body part last struck on the target
  let target = null;         // fight: { name, hp, hpMax }
  let typing = null;
  let speechFrame = null;    // the dialogue frame the speaker card is showing

  // ── small pieces ─────────────────────────────────────────────────────────────
  let toastTimer = null;
  function send(verb, note = 'would send') {
    const t = $('toast');
    t.innerHTML = `&rarr; ${esc(verb)}<em>${esc(note)}</em>`;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
  }

  function addEntry(cls, html) {
    const el = document.createElement('div');
    el.className = 'entry ' + cls;
    el.innerHTML = html;
    $('log').appendChild(el);
    $('log').scrollTop = $('log').scrollHeight;
    return el;
  }

  function npcFor(name) { return S.npcs.find((n) => n.name === name) || null; }
  function firstSentence(s, max = 70) {
    const one = String(s || '').split(/(?<=\.)\s/)[0];
    return one.length > max ? one.slice(0, max - 1) + '…' : one;
  }
  const actBtn = (label, verb, cls = '') => `<button class="act ${cls}" data-verb="${esc(verb)}">${esc(label)}</button>`;

  // ── the dock ─────────────────────────────────────────────────────────────────
  function renderVitals() {
    const v = vitals;
    const rows = [
      ['Health', v.hp, v.hp_max, 'var(--bad)'],
      ['Stamina', v.stamina, v.stamina_max, '#e0b64a'],
      ['Sanity', v.sanity, v.sanity_max, '#9a7ad8'],
      ['Food', v.hunger, 100, 'var(--good)'],
      ['Water', v.thirst, 100, 'var(--cool)'],
      ['Rads', v.radiation, 100, '#b8d84a'],
    ];
    $('vitals').innerHTML = rows.map(([label, n, max, c]) =>
      `<div class="vital"><span>${label}<b>${n}</b></span><div class="bar"><i style="width:${Math.max(0, Math.min(100, (n / max) * 100))}%;background:${c}"></i></div></div>`).join('');
  }

  const HOTBAR = [
    ['⚔', 'Attack', 'attack'], ['↩', 'Flee', 'flee'], ['◎', 'Look', 'look'],
    ['▤', 'Bag', 'inventory'], ['▣', 'Tablet', 'tablet'], ['⌖', 'Map', 'map'],
  ];
  function renderHotbar() {
    $('hotbar').innerHTML = HOTBAR.map(([ico, lbl, verb], i) =>
      `<button class="slot" data-verb="${verb}" title="${verb}"><kbd>${i + 1}</kbd><span class="ico">${ico}</span><span class="lbl">${lbl}</span></button>`).join('')
      + `<button class="slot" data-verb="score" title="score"><span class="ico">₵</span><span class="lbl">${vitals.credits}</span></button>`;
  }

  // ── the scene strip ──────────────────────────────────────────────────────────
  function renderScene() {
    const kind = sceneKind(S.zone);
    $('scene-art').innerHTML = kind === 'sewer' ? sewerArt(S.zone.id, room.hostiles)
      : kind === 'interior' ? barArt(S.zone.id) : streetArt(S.zone.id);
    const d = $('scene-district');
    d.textContent = room.district?.name || '';
    d.style.color = room.district?.color || 'var(--ink-2)';
    $('scene-name').textContent = room.name;
    $('scene-meta').innerHTML = (room.danger ? `<span class="badge ${esc(room.danger)}">${esc(room.danger)}</span>` : '')
      + (room.light ? `<span>${esc(room.light.text)}</span>` : '');
  }

  // ── the focus column ─────────────────────────────────────────────────────────
  function compass() {
    const dirs = new Map();
    for (const e of room.exits) if (e.dir) dirs.set(e.dir, e);
    for (const p of room.places) if (p.dir && !dirs.has(p.dir)) dirs.set(p.dir, { ...p, dest: p.name });
    const cell = (dir, label) => {
      const e = dirs.get(dir);
      return `<button ${e ? `data-verb="${esc(dir)}" title="${esc(e.dest || '')}${e.locked ? ' (locked)' : ''}"` : 'disabled'}>${label}</button>`;
    };
    const list = [...dirs.entries()].map(([dir, e]) =>
      `<div><b>${dir[0].toUpperCase()}</b> ${esc(e.dest || e.name)}${e.locked ? ' <span style="color:var(--warn)">locked</span>' : ''}</div>`).join('');
    return `<div class="exits-wrap"><div class="compass">
      ${cell('northwest', 'NW')}${cell('north', 'N')}${cell('northeast', 'NE')}
      ${cell('west', 'W')}<div class="hub">you</div>${cell('east', 'E')}
      ${cell('southwest', 'SW')}${cell('south', 'S')}${cell('southeast', 'SE')}
    </div><div class="exit-list">${list}</div></div>`;
  }

  function roomCard() {
    const groups = [];
    if (room.hostiles.length) {
      groups.push(`<div class="group"><h2>Hostiles</h2><div class="chips">${room.hostiles.map((h) => `
        <div class="chip hostile"><div class="avatar">${portrait(h.id, { mutant: true })}</div>
          <div class="who"><div class="name">${esc(h.name)}</div>
            <div class="hp"><i style="width:${h.hpMax ? (h.hp / h.hpMax) * 100 : 100}%"></i></div></div>
          <div class="acts">${actBtn('Attack', h.verb, 'danger')}</div></div>`).join('')}</div></div>`);
    }
    if (room.people.length) {
      groups.push(`<div class="group"><h2>People</h2><div class="chips">${room.people.map((p) => {
        const n = npcFor(p.name);
        return `<div class="chip"><div class="avatar">${portrait(n?.id || p.name, { sex: n?.sex })}</div>
          <div class="who"><div class="name">${esc(p.name)}</div><div class="sub">${esc(firstSentence(n?.description))}</div></div>
          <div class="acts">${actBtn('Talk', p.verb, 'primary')}${actBtn('Look', 'examine ' + p.name)}</div></div>`;
      }).join('')}</div></div>`);
    }
    if (room.things.length) {
      groups.push(`<div class="group"><h2>Things</h2><div class="chips">${room.things.map((t) => `
        <div class="chip"><div class="who"><div class="name">${esc(t.name)}</div><div class="sub">${esc(t.kind || '')}</div></div>
          <div class="acts">${t.verbs.slice(0, 3).map((v) => actBtn(v.split(' ')[0], v)).join('')}</div></div>`).join('')}</div></div>`);
    }
    if (room.places.length) {
      groups.push(`<div class="group"><h2>Places</h2><div class="chips">${room.places.map((p) => `
        <div class="chip place"><div class="who"><div class="name" data-lock="${p.locked ? 'locked' : ''}">${esc(p.name)}</div><div class="sub">to the ${esc(p.dir)}</div></div>
          <div class="acts">${actBtn('Go', p.verb)}${p.locked ? actBtn('Knock', 'knock ' + p.dir) : ''}</div></div>`).join('')}</div></div>`);
    }
    groups.push(`<div class="group"><h2>Ways out</h2>${compass()}</div>`);
    $('focus').innerHTML = groups.join('');
  }

  function speakerCard(frame, typed = true) {
    const n = npcFor(frame.npcName);
    const shopIdx = frame.options.findIndex((o) => o._kind === 'shop');
    $('focus').innerHTML = `<div class="speaker">
      <div class="portrait">${portrait(n?.id || frame.npcId, { sex: n?.sex })}<div class="tag">${esc(frame.npcName)}</div></div>
      <div class="speech" id="speech"></div>
      <div class="choices">${frame.options.map((o, i) =>
        `<button class="choice ${i === shopIdx ? 'shop' : ''}" data-opt="${i}"><kbd>${i + 1}</kbd><span>${esc(o.label)}</span></button>`).join('')}</div>
      <button class="leave" data-leave="1">Walk away</button>
    </div>`;
    speechFrame = frame;
    const speech = $('speech');
    const reveal = () => document.querySelectorAll('.choice').forEach((b, i) => setTimeout(() => b.classList.add('on'), reduced ? 0 : i * 70));
    clearInterval(typing);
    if (!typed || reduced) { speech.innerHTML = frame.text; reveal(); return; }
    // Typed, not pasted, as dialogue.js does: 90 characters a second, capped so a
    // long speech speeds up rather than holding the player.
    const tmp = document.createElement('div');
    tmp.innerHTML = frame.text;
    const plain = tmp.textContent;
    const step = Math.max(1, Math.ceil(plain.length / (1.4 * 60)));
    let i = 0;
    typing = setInterval(() => {
      i += step;
      speech.textContent = plain.slice(0, i);
      if (i >= plain.length) { clearInterval(typing); speech.innerHTML = frame.text; reveal(); }
    }, 1000 / 60);
  }

  const PART_CLASS = { head: 'head', torso: 'torso', chest: 'torso', 'left arm': 'left-arm', 'right arm': 'right-arm', 'left leg': 'left-leg', 'right leg': 'right-leg' };
  function targetCard() {
    const others = room.hostiles.slice(1);
    const pct = target.hpMax ? (target.hp / target.hpMax) * 100 : 100;
    const hit = (cls) => (PART_CLASS[lastHit] === cls ? 'hit' : '');
    const left = DATA.scenes.fight.steps.filter((s) => s.cmd.startsWith('attack')).length - round;
    $('focus').innerHTML = `
      <div class="group"><h2>Fighting</h2>
        <div class="target-row">
          <div class="portrait">${portrait(target.id, { mutant: true })}</div>
          <div style="flex:1;min-width:0">
            <div class="target-name">${esc(target.name)}</div>
            <div class="hp" style="height:8px"><i style="width:${pct}%"></i></div>
            <div class="target-hp">${target.hp}/${target.hpMax}${lastHit ? ` &middot; last hit: ${esc(lastHit)}` : ''}</div>
          </div>
        </div>
      </div>
      <div class="body-map" aria-hidden="true">
        <i class="head ${hit('head')}"></i><i class="right-arm ${hit('right-arm')}"></i><i class="torso ${hit('torso')}"></i><i class="left-arm ${hit('left-arm')}"></i>
        <div class="legs"><i class="${hit('right-leg')}"></i><i class="${hit('left-leg')}"></i></div>
      </div>
      <div class="target-acts">
        <button class="act danger" data-attack="1" ${left > 0 ? '' : 'disabled'}>${left > 0 ? 'Attack' : 'No more captured rounds'}</button>
        ${actBtn('Aim', 'aim head')}${actBtn('Flee', 'flee')}
      </div>
      ${others.length ? `<div class="group"><h2>Also here</h2><div class="chips">${others.map((h) => `
        <div class="chip hostile"><div class="avatar">${portrait(h.id, { mutant: true })}</div>
          <div class="who"><div class="name">${esc(h.name)}</div><div class="hp"><i style="width:100%"></i></div></div>
          <div class="acts">${actBtn('Switch', h.verb)}</div></div>`).join('')}</div></div>` : ''}
      <div class="group"><h2>Ways out</h2>${compass()}</div>`;
  }

  // ── the log ──────────────────────────────────────────────────────────────────
  function narrate(look) {
    const el = addEntry('narr', room.prose || '<span class="text-dim">(no description)</span>');
    const btn = document.createElement('button');
    btn.className = 'raw-toggle';
    btn.textContent = 'show as the classic client prints it';
    btn.onclick = () => {
      const open = el.querySelector('.raw');
      if (open) { open.remove(); btn.textContent = 'show as the classic client prints it'; return; }
      const raw = document.createElement('div');
      raw.className = 'raw';
      raw.innerHTML = look.message;
      el.appendChild(raw);
      btn.textContent = 'hide';
    };
    el.appendChild(document.createElement('br'));
    el.appendChild(btn);
    for (const n of room.notes) addEntry('note', n);
  }

  function sayEntry(frame) {
    const n = npcFor(frame.npcName);
    addEntry('say', `<div class="avatar">${portrait(n?.id || frame.npcId, { sex: n?.sex })}</div>
      <div><div class="who">${esc(frame.npcName)}</div><div class="line">${frame.text}</div></div>`);
  }

  // ── scenes ───────────────────────────────────────────────────────────────────
  function load(key) {
    scene = key;
    S = DATA.scenes[key];
    const look = S.steps[0].result;
    room = parseRoom(look.message);
    vitals = { ...DATA.player };
    round = 0;
    lastHit = null;
    clearInterval(typing);
    $('log').innerHTML = '';
    document.querySelectorAll('#scene-tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scene === key)));
    renderScene();
    renderVitals();
    renderHotbar();
    narrate(look);
    if (key === 'bar') {
      const hello = S.steps.find((s) => s.result?.type === 'dialogue')?.result;
      addEntry('typed', esc(S.steps[1].cmd));
      sayEntry(hello);
      speakerCard(hello);
    } else if (key === 'fight') {
      const h = room.hostiles[0];
      target = { id: h.id, name: h.name, hp: h.hp, hpMax: h.hpMax };
      targetCard();
    } else {
      roomCard();
    }
    $('model').textContent = JSON.stringify(room, null, 2);
    if (location.hash !== '#' + key) history.replaceState(null, '', '#' + key);
  }

  function choose(i) {
    const frame = speechFrame;
    const opt = frame?.options[i];
    if (!opt) return;
    send(`reply ${i + 1}`, 'the typed form of this click');
    // Only the paths actually captured can be played.
    const captured = S.steps.map((s) => s.result).filter((r) => r?.type === 'dialogue');
    const next = opt.next === '' ? 'end' : opt.next === '__shop__' ? 'shop' : captured.find((r) => r.node === opt.next);
    addEntry('you', esc(opt.label));
    if (next === 'end') { roomCard(); return; }
    if (next === 'shop' || !next) {
      addEntry('note', `(not captured in phase 0: ${esc(opt.next === '__shop__' ? 'the shop panel' : 'node ' + opt.next)})`);
      return;
    }
    sayEntry(next);
    speakerCard(next);
  }

  function attackRound() {
    const steps = S.steps;
    const strikes = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.cmd.startsWith('attack'));
    const strike = strikes[round];
    if (!strike) return;
    round++;
    send(strike.s.cmd);
    addEntry('typed', esc(strike.s.cmd));
    const out = strike.s.result;
    addEntry('hit out', out.message);
    const tmp = document.createElement('div');
    tmp.innerHTML = out.message;
    const part = tmp.querySelector('.hit-part')?.textContent;
    const hp = tmp.querySelector('.hp-count')?.textContent.match(/(\d+)\/(\d+)/);
    lastHit = part || null;
    if (hp) target.hp = +hp[1];
    const reply = steps[strike.i + 1];
    if (reply?.cmd === '<enemy>' && reply.result?.message) {
      setTimeout(() => {
        addEntry('hit in', reply.result.message);
        const t2 = document.createElement('div');
        t2.innerHTML = reply.result.message;
        const mine = t2.querySelector('.hp-count')?.textContent.match(/(\d+)\/(\d+)/);
        if (mine) { vitals.hp = +mine[1]; renderVitals(); }
      }, reduced ? 0 : 650);
    }
    targetCard();
  }

  // ── wiring ───────────────────────────────────────────────────────────────────
  const LABELS = { street: 'Street', bar: 'Bar', fight: 'Fight' };
  $('scene-tabs').innerHTML = Object.keys(DATA.scenes).map((k) =>
    `<button data-scene="${k}" aria-pressed="false">${LABELS[k] || k} &middot; ${esc(DATA.scenes[k].zone.name)}</button>`).join('');
  $('scene-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-scene]'); if (b) load(b.dataset.scene); });

  $('frame').addEventListener('click', (e) => {
    const opt = e.target.closest('[data-opt]');
    if (opt) return choose(+opt.dataset.opt);
    if (e.target.closest('[data-leave]')) { clearInterval(typing); send('endtalk'); return roomCard(); }
    if (e.target.closest('[data-attack]')) return attackRound();
    const v = e.target.closest('[data-verb]');
    if (!v) return;
    const verb = v.dataset.verb;
    if (scene !== 'fight' && /^talk /.test(verb) && scene === 'bar') {
      const hello = S.steps.find((s) => s.result?.type === 'dialogue')?.result;
      send(verb);
      sayEntry(hello);
      return speakerCard(hello);
    }
    if (scene === 'fight' && verb === 'attack') return attackRound();
    send(verb);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input')) return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1) return;
    if (document.querySelector('.choice.on')) return choose(n - 1);
    const slot = document.querySelectorAll('.slot')[n - 1];
    if (slot) slot.click();
  });

  $('cmd-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('cmd-input').value.trim();
    if (!v) return;
    addEntry('typed', esc(v));
    send(v);
    $('cmd-input').value = '';
  });

  $('opt-phone').addEventListener('change', (e) => $('frame-wrap').classList.toggle('phone', e.target.checked));
  $('opt-model').addEventListener('change', (e) => { $('model').hidden = !e.target.checked; });

  load(DATA.scenes[location.hash.slice(1)] ? location.hash.slice(1) : 'street');
})();
