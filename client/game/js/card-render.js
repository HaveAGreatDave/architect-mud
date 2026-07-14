// card-render.js — procedural trading-card portrait renderer for Architect.
//
// Draws a player/NPC's equipped loadout as per-piece VECTOR ART on a body
// silhouette. Deterministic: given the same {body, items, seed} it renders the
// same picture on any client, so a minted card is stored as that small spec —
// never an image blob.
//
// NOT wired into the client yet. Public API (window.CardRender):
//   loadMasks(sources?)            -> Promise, builds the alpha masks (once)
//   classify(item)                 -> { archetype, z, palette }  (slot+name heuristics)
//   deriveCard(items)              -> { tier, tierName, power, color }
//   renderPortrait(canvas, spec)   -> draws the figure; spec = {body,items,seed}
//   ARCHETYPES                     -> { name: drawerFn }  (for a catalogue view)
//   ANCHORS, MASKS                 -> body geometry / asset config
//
// Bodies: 'male'  = /assets/paperdoll-mask.png  (242x540, shape in alpha)
//         'female'= /assets/femsil.png           (500x708, shape in alpha)
// Both are Vitruvian (arms spread). Drawers read the per-body ANCHORS table and
// size everything off anchor-derived metrics, so one drawer fits both figures.

(function (global) {
  'use strict';

  // ---- asset config -------------------------------------------------------
  const MASKS = {
    male:   { src: '/assets/paperdoll-mask.png', mode: 'alpha', W: 242, H: 540 },
    female: { src: '/assets/femsil.png',         mode: 'alpha', W: 500, H: 708 },
  };

  // ---- per-body anchor tables (in each mask's own pixel space) -------------
  // Decoded from the mask outlines. Drawers use these + derived metrics.
  const ANCHORS = {
    male: {
      head: { cx: 115, cy: 44, r: 26 }, neck: { cx: 115, cy: 88 },
      shL: { cx: 55, cy: 110 }, shR: { cx: 175, cy: 110 },
      chest: { cx: 115, cy: 150 }, waist: { cx: 115, cy: 240 },
      handL: { cx: 16, cy: 290 }, handR: { cx: 214, cy: 290 },
      hip: { cx: 115, cy: 300 },
      legL: { cx: 100, top: 320, bot: 470 }, legR: { cx: 132, top: 320, bot: 470 },
      footL: { cx: 95, cy: 512 }, footR: { cx: 150, cy: 512 },
      weaponHand: { cx: 214, cy: 290 }, torsoTop: 120, torsoBot: 250,
    },
    female: {
      head: { cx: 250, cy: 72, r: 40 }, neck: { cx: 250, cy: 120 },
      shL: { cx: 180, cy: 132 }, shR: { cx: 312, cy: 132 },
      chest: { cx: 247, cy: 182 }, waist: { cx: 244, cy: 262 },
      handL: { cx: 100, cy: 360 }, handR: { cx: 390, cy: 360 },
      hip: { cx: 244, cy: 398 },
      legL: { cx: 222, top: 410, bot: 640 }, legR: { cx: 266, top: 410, bot: 640 },
      footL: { cx: 205, cy: 668 }, footR: { cx: 278, cy: 668 },
      weaponHand: { cx: 390, cy: 360 }, torsoTop: 135, torsoBot: 345,
    },
  };

  // derived metrics, computed once per body
  function metrics(A) {
    const shoulderSpan = A.shR.cx - A.shL.cx;
    const headR = A.head.r;
    return {
      shoulderSpan, headR,
      unit: headR / 26,                       // scale line-weights & small detail
      hipW: (A.footR.cx - A.footL.cx) * 1.15,
      torsoH: A.torsoBot - A.torsoTop,
      legLen: A.legL.bot - A.legL.top,
    };
  }

  // ---- tier / palette derivation -----------------------------------------
  const TIERS = [
    { name: 'common',    edge: '#8a95a0', glow: 'rgba(138,149,160,.5)' },
    { name: 'uncommon',  edge: '#74c98a', glow: 'rgba(116,201,138,.55)' },
    { name: 'rare',      edge: '#57c6ff', glow: 'rgba(87,198,255,.6)' },
    { name: 'epic',      edge: '#b98cff', glow: 'rgba(185,140,255,.6)' },
    { name: 'legendary', edge: '#e8c25a', glow: 'rgba(232,194,90,.65)' },
  ];
  function tierIndex(value, armor) {
    let t = 0;
    const v = value || 0;
    if (v >= 40) t = 1;
    if (v >= 110) t = 2;
    if (v >= 300) t = 3;
    if (v >= 700) t = 4;
    if (armor >= 3 && t < 2) t = 2;           // solid armor is at least rare
    if (armor >= 5) t = Math.max(t, 3);
    return t;
  }
  function hashHue(s) {
    let h = 0; s = s || '';
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  // material palette for one item
  function paletteFor(item, archetype) {
    const armor = (item.tags && item.tags.armor) || 0;
    const ti = tierIndex(item.value, armor);
    const tier = TIERS[ti];
    const metal = /helm|helmet|vest|plate|carrier|gaunt|gun|pistol|blade|knife|shiv|blunt|bat|wrench|lance|hammer|iron|baton|taser|mask|respirat/i;
    const isMetal = metal.test((item.name || '') + ' ' + archetype);
    let base, hi;
    if (isMetal) { base = '#2b3238'; hi = '#59646c'; }
    else {
      const hue = hashHue(item.id || item.name);
      base = `hsl(${hue} 16% 20%)`; hi = `hsl(${hue} 20% 40%)`;
    }
    return { base, hi, edge: tier.edge, glow: tier.glow, accent: tier.edge, tier: ti, tierName: tier.name };
  }

  // ---- slot + name -> archetype classifier -------------------------------
  // Base draw-order per slot; layer nudges within it.
  const SLOT_Z = { legs: 10, feet: 12, torso: 20, hands: 24, accessory: 26, head: 30, weapon_hand: 40 };
  function pick(name, rules, dflt) {
    for (const [re, arch] of rules) if (re.test(name)) return arch;
    return dflt;
  }
  const HEAD_RULES = [[/helmet|helm/i,'helmetDome'],[/hood/i,'hood'],[/hat|bucket/i,'brimHat'],[/cap|beanie|watch/i,'cap'],[/hair|veil|iris|interface|optic/i,'hair']];
  const TORSO_RULES = [[/kevlar|vest|plate|carrier|riot|scrap vest/i,'plateCarrier'],[/coat|jacket|shellcoat|hoodie/i,'jacket'],[/jumpsuit/i,'jumpsuit'],[/thermex|underlayer|undershirt|compression|nano-weave|seamless|ribbed/i,'undershirt'],[/bra|bralette|harness|halter|crop|pasties|binder|blouse|wrap|fishnet|tassel/i,'minimalTop']];
  const LEG_RULES = [[/shorts/i,'shorts'],[/boxer|brief|panties|thong|jock|underpant|lucky|micro|bra\b/i,'briefs']];
  const FEET_RULES = [[/boot/i,'boot'],[/sneaker|shoes|canvas/i,'sneaker'],[/sandal|slipper/i,'sandal']];
  const HAND_RULES = [[/ring/i,'rings'],[/gaunt|insulated/i,'gauntlet']];
  const WEAPON_RULES = [[/shotgun|smg|rifle|lazer|laser|breacher|rattlecan|biglazer/i,'longGun'],[/pistol|holdout|scrap-iron/i,'pistol'],[/knife|shiv|blade|machete/i,'blade'],[/taser|stylus/i,'baton'],[/bat|wrench|sledge|tire|lance|pipe|hammer|iron/i,'blunt']];
  const ACC_RULES = [[/respirat|mask/i,'faceMask'],[/chain|collar|scarf|necklace|gorget/i,'neck'],[/pack|tote|harness|bag/i,'pack'],[/watch|wristband|bracelet|band|counter/i,'wrist']];

  function classify(item) {
    const slot = (item.tags && item.tags.slot) || item.slot || '';
    const name = (item.name || '') + ' ' + (item.id || '');
    let archetype;
    switch (slot) {
      case 'head': archetype = pick(name, HEAD_RULES, 'cap'); break;
      case 'torso': archetype = pick(name, TORSO_RULES, 'tee'); break;
      case 'legs': archetype = pick(name, LEG_RULES, 'trouser'); break;
      case 'feet': archetype = pick(name, FEET_RULES, 'sneaker'); break;
      case 'hands': archetype = pick(name, HAND_RULES, 'glove'); break;
      case 'weapon_hand': archetype = pick(name, WEAPON_RULES, 'blunt'); break;
      case 'accessory': archetype = pick(name, ACC_RULES, 'wrist'); break;
      default: return null;
    }
    const layer = ({ under: -2, armor: 2 })[(item.tags && item.tags.layer)] || 0;
    return { archetype, z: (SLOT_Z[slot] || 0) + layer, palette: paletteFor(item, archetype) };
  }

  // ---- small drawing helpers ---------------------------------------------
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function grad(c, x0, y0, x1, y1, a, b) { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
  function edge(c, P, u) { c.strokeStyle = P.edge; c.lineWidth = 1.4 * u; c.stroke(); }

  // =========================================================================
  //  ARCHETYPE DRAWERS   drawer(c, A, M, P, v)
  //  c: ctx (mask space)  A: anchors  M: metrics  P: palette  v: item
  //  Hero pieces (weapons, coats, helmets, boots, masks) carry extra detail.
  // =========================================================================
  const ARCHETYPES = {};

  // -- HEAD -----------------------------------------------------------------
  ARCHETYPES.helmetDome = function (c, A, M, P) {                    // hero
    const h = A.head, u = M.unit, R = h.r;
    c.save();
    c.fillStyle = grad(c, h.cx - R, h.cy - R, h.cx + R, h.cy + R, P.hi, P.base);
    c.beginPath();
    c.moveTo(h.cx - R * 1.02, h.cy + R * 0.32);
    c.bezierCurveTo(h.cx - R * 1.06, h.cy - R * 1.5, h.cx + R * 1.06, h.cy - R * 1.5, h.cx + R * 1.02, h.cy + R * 0.32);
    c.lineTo(h.cx + R * 0.98, h.cy + R * 0.55); c.lineTo(h.cx + R * 0.7, h.cy + R * 0.78);
    c.lineTo(h.cx - R * 0.7, h.cy + R * 0.78); c.lineTo(h.cx - R * 0.98, h.cy + R * 0.55);
    c.closePath(); c.fill(); edge(c, P, u);
    // brim shadow
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 2 * u;
    c.beginPath(); c.moveTo(h.cx - R * 0.8, h.cy + R * 0.5); c.lineTo(h.cx + R * 0.8, h.cy + R * 0.5); c.stroke();
    // NVG mount
    c.fillStyle = '#11201f'; rr(c, h.cx - R * 0.28, h.cy + R * 0.18, R * 0.56, R * 0.4, 2 * u); c.fill(); edge(c, P, u);
    // rivets
    c.fillStyle = P.edge; [-0.75, 0.75].forEach(s => { c.beginPath(); c.arc(h.cx + s * R, h.cy - R * 0.1, 1.6 * u, 0, 7); c.fill(); });
    c.restore();
  };
  ARCHETYPES.cap = function (c, A, M, P) {
    const h = A.head, u = M.unit, R = h.r;
    c.save();
    c.fillStyle = grad(c, h.cx, h.cy - R, h.cx, h.cy, P.hi, P.base);
    c.beginPath(); c.arc(h.cx, h.cy - R * 0.12, R * 0.98, Math.PI, 0); c.lineTo(h.cx + R, h.cy - R * 0.05);
    c.lineTo(h.cx - R, h.cy - R * 0.05); c.closePath(); c.fill(); edge(c, P, u);
    // peak
    c.fillStyle = P.base; c.beginPath();
    c.moveTo(h.cx - R * 0.2, h.cy - R * 0.05); c.lineTo(h.cx - R * 1.5, h.cy + R * 0.08);
    c.lineTo(h.cx - R * 1.5, h.cy + R * 0.28); c.lineTo(h.cx - R * 0.2, h.cy + R * 0.12); c.closePath(); c.fill();
    c.restore();
  };
  ARCHETYPES.brimHat = function (c, A, M, P) {
    const h = A.head, u = M.unit, R = h.r;
    c.save();
    c.fillStyle = P.base;
    c.beginPath(); c.ellipse(h.cx, h.cy + R * 0.35, R * 1.6, R * 0.4, 0, 0, 7); c.fill(); edge(c, P, u); // brim
    c.fillStyle = grad(c, h.cx, h.cy - R, h.cx, h.cy, P.hi, P.base);
    rr(c, h.cx - R * 0.85, h.cy - R * 1.1, R * 1.7, R * 1.4, R * 0.4); c.fill(); edge(c, P, u);           // crown
    c.restore();
  };
  ARCHETYPES.hood = function (c, A, M, P) {                          // hero
    const h = A.head, u = M.unit, R = h.r;
    c.save();
    c.fillStyle = grad(c, h.cx, h.cy - R, h.cx, h.cy + R * 2, P.hi, P.base);
    c.beginPath();
    c.moveTo(h.cx - R * 1.35, h.cy + R * 1.6);
    c.bezierCurveTo(h.cx - R * 1.5, h.cy - R * 1.5, h.cx + R * 1.5, h.cy - R * 1.5, h.cx + R * 1.35, h.cy + R * 1.6);
    c.bezierCurveTo(h.cx + R * 0.9, h.cy + R * 0.7, h.cx - R * 0.9, h.cy + R * 0.7, h.cx - R * 1.35, h.cy + R * 1.6);
    c.closePath(); c.fill(); edge(c, P, u);
    // inner opening shadow
    c.fillStyle = 'rgba(0,0,0,.55)';
    c.beginPath(); c.ellipse(h.cx, h.cy + R * 0.15, R * 0.8, R * 1.0, 0, 0, 7); c.fill();
    c.restore();
  };
  ARCHETYPES.hair = function (c, A, M, P) {
    const h = A.head, u = M.unit, R = h.r;
    c.save();
    c.fillStyle = grad(c, h.cx, h.cy - R, h.cx, h.cy + R * 2.2, P.hi, P.base);
    c.beginPath();
    c.moveTo(h.cx - R * 1.05, h.cy + R * 1.8);
    c.bezierCurveTo(h.cx - R * 1.3, h.cy - R * 1.2, h.cx + R * 1.3, h.cy - R * 1.2, h.cx + R * 1.05, h.cy + R * 1.8);
    c.lineTo(h.cx + R * 0.7, h.cy + R * 1.7);
    c.bezierCurveTo(h.cx + R * 0.9, h.cy, h.cx - R * 0.9, h.cy, h.cx - R * 0.7, h.cy + R * 1.7);
    c.closePath(); c.fill();
    // strand highlights
    c.strokeStyle = P.edge; c.globalAlpha = 0.5; c.lineWidth = 1 * u;
    for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(h.cx + i * R * 0.6, h.cy - R * 0.6); c.lineTo(h.cx + i * R * 0.8, h.cy + R * 1.4); c.stroke(); }
    c.restore();
  };

  // -- TORSO ----------------------------------------------------------------
  function torsoBox(A) {                       // shared body box for garments
    const halfTop = (A.shR.cx - A.shL.cx) * 0.5;
    return { cx: A.chest.cx, top: A.torsoTop, bot: A.torsoBot, wTop: halfTop * 1.05, wBot: halfTop * 0.8 };
  }
  function fillTorso(c, A, inset) {
    const b = torsoBox(A); const it = inset || 0;
    c.beginPath();
    c.moveTo(b.cx - b.wTop + it, b.top + it); c.lineTo(b.cx + b.wTop - it, b.top + it);
    c.lineTo(b.cx + b.wBot - it, b.bot - it); c.lineTo(b.cx - b.wBot + it, b.bot - it);
    c.closePath();
  }
  ARCHETYPES.tee = function (c, A, M, P) {
    c.save();
    c.fillStyle = grad(c, 0, A.torsoTop, 0, A.torsoBot, P.hi, P.base); fillTorso(c, A); c.fill();
    // short sleeves
    const u = M.unit;
    c.fillStyle = P.base;
    [[A.shL, -1], [A.shR, 1]].forEach(([s, d]) => { c.beginPath(); c.moveTo(s.cx, s.cy); c.lineTo(s.cx + d * 14 * u, s.cy + 4 * u); c.lineTo(s.cx + d * 10 * u, s.cy + 26 * u); c.lineTo(s.cx, s.cy + 22 * u); c.closePath(); c.fill(); });
    c.strokeStyle = P.edge; c.globalAlpha = .5; c.lineWidth = 1 * u; fillTorso(c, A, 2 * u); c.stroke();
    c.restore();
  };
  ARCHETYPES.undershirt = function (c, A, M, P) {
    c.save(); c.globalAlpha = .92;
    c.fillStyle = grad(c, 0, A.torsoTop, 0, A.torsoBot, P.hi, P.base); fillTorso(c, A, M.unit * 3); c.fill();
    c.restore();
  };
  ARCHETYPES.minimalTop = function (c, A, M, P) {
    const u = M.unit, b = torsoBox(A);
    c.save();
    c.fillStyle = grad(c, 0, b.top, 0, b.top + 40 * u, P.hi, P.base);
    rr(c, b.cx - b.wTop * 0.9, b.top + 6 * u, b.wTop * 1.8, 34 * u, 8 * u); c.fill(); edge(c, P, u);
    // straps
    c.strokeStyle = P.base; c.lineWidth = 4 * u;
    c.beginPath(); c.moveTo(b.cx - b.wTop * 0.5, b.top + 6 * u); c.lineTo(A.shL.cx + 8 * u, A.shL.cy); c.stroke();
    c.beginPath(); c.moveTo(b.cx + b.wTop * 0.5, b.top + 6 * u); c.lineTo(A.shR.cx - 8 * u, A.shR.cy); c.stroke();
    c.restore();
  };
  ARCHETYPES.jacket = function (c, A, M, P) {                        // hero
    const u = M.unit, b = torsoBox(A);
    c.save();
    // body, slightly longer than the shirt box
    const bot = b.bot + M.torsoH * 0.18;
    c.fillStyle = grad(c, 0, b.top, 0, bot, P.hi, P.base);
    c.beginPath();
    c.moveTo(b.cx - b.wTop * 1.08, b.top); c.lineTo(b.cx + b.wTop * 1.08, b.top);
    c.lineTo(b.cx + b.wBot * 1.1, bot); c.lineTo(b.cx - b.wBot * 1.1, bot); c.closePath(); c.fill();
    // full sleeves down the upper arms
    c.fillStyle = P.base;
    [[A.shL, A.handL, -1], [A.shR, A.handR, 1]].forEach(([s, hnd, d]) => {
      c.beginPath(); c.moveTo(s.cx, s.cy); c.lineTo(s.cx + d * 16 * u, s.cy);
      c.lineTo((s.cx + hnd.cx) / 2 + d * 10 * u, (s.cy + hnd.cy) / 2); c.lineTo((s.cx + hnd.cx) / 2 - d * 2 * u, (s.cy + hnd.cy) / 2); c.closePath(); c.fill();
    });
    // open front + collar + zip
    c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 2 * u; c.beginPath(); c.moveTo(b.cx, b.top + 6 * u); c.lineTo(b.cx, bot - 4 * u); c.stroke();
    c.fillStyle = P.hi; c.beginPath();
    c.moveTo(b.cx, b.top + 4 * u); c.lineTo(b.cx - 16 * u, b.top - 2 * u); c.lineTo(b.cx - 10 * u, b.top + 20 * u); c.closePath();
    c.moveTo(b.cx, b.top + 4 * u); c.lineTo(b.cx + 16 * u, b.top - 2 * u); c.lineTo(b.cx + 10 * u, b.top + 20 * u); c.closePath(); c.fill();
    c.strokeStyle = P.edge; c.globalAlpha = .7; c.lineWidth = 1.4 * u; c.beginPath(); c.moveTo(b.cx, b.top); c.lineTo(b.cx, bot); c.stroke();
    c.restore();
  };
  ARCHETYPES.plateCarrier = function (c, A, M, P) {                 // hero
    const u = M.unit, b = torsoBox(A);
    c.save();
    // shoulder straps
    c.fillStyle = P.base;
    rr(c, b.cx - b.wTop * 0.6, b.top - 10 * u, 12 * u, 24 * u, 3 * u); c.fill();
    rr(c, b.cx + b.wTop * 0.6 - 12 * u, b.top - 10 * u, 12 * u, 24 * u, 3 * u); c.fill();
    // carrier body
    c.fillStyle = grad(c, 0, b.top, 0, b.bot, P.hi, P.base);
    rr(c, b.cx - b.wTop * 0.92, b.top + 4 * u, b.wTop * 1.84, (b.bot - b.top) - 4 * u, 9 * u); c.fill(); edge(c, P, u);
    // central seam
    c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 2 * u; c.beginPath(); c.moveTo(b.cx, b.top + 10 * u); c.lineTo(b.cx, b.bot - 8 * u); c.stroke();
    // trauma plates
    c.fillStyle = 'rgba(255,255,255,.06)'; c.strokeStyle = P.edge; c.globalAlpha = 1; c.lineWidth = 1 * u;
    const pw = b.wTop * 1.3, pcx = b.cx - pw / 2;
    rr(c, pcx, b.top + 14 * u, pw, (b.bot - b.top) * 0.36, 4 * u); c.fill(); c.stroke();
    rr(c, pcx, b.top + 14 * u + (b.bot - b.top) * 0.42, pw, (b.bot - b.top) * 0.4, 4 * u); c.fill(); c.stroke();
    // MOLLE dots
    c.fillStyle = 'rgba(0,0,0,.4)';
    for (let yy = b.top + 24 * u; yy < b.bot - 14 * u; yy += 13 * u) for (let xx = b.cx - pw * 0.4; xx < b.cx + pw * 0.4; xx += 11 * u) { c.beginPath(); c.arc(xx, yy, 1 * u, 0, 7); c.fill(); }
    c.restore();
  };
  ARCHETYPES.jumpsuit = function (c, A, M, P) {
    c.save();
    ARCHETYPES.tee(c, A, M, P);
    ARCHETYPES.trouser(c, A, M, P);
    // seam + collar to read as one-piece
    const u = M.unit, b = torsoBox(A);
    c.strokeStyle = P.edge; c.globalAlpha = .5; c.lineWidth = 1.4 * u;
    c.beginPath(); c.moveTo(b.cx, b.top); c.lineTo(b.cx, A.hip.cy); c.stroke();
    c.restore();
  };

  // -- LEGS -----------------------------------------------------------------
  function legPath(c, A, leg, wTop, wBot, top, bot) {
    c.beginPath();
    c.moveTo(leg.cx - wTop, top); c.lineTo(leg.cx + wTop, top);
    c.lineTo(leg.cx + wBot, bot); c.lineTo(leg.cx - wBot, bot); c.closePath();
  }
  ARCHETYPES.trouser = function (c, A, M, P) {
    const u = M.unit, wl = M.hipW * 0.18;
    c.save();
    c.fillStyle = grad(c, 0, A.hip.cy, 0, A.legL.bot, P.hi, P.base);
    // hips
    rr(c, A.hip.cx - M.hipW * 0.32, A.hip.cy - 8 * u, M.hipW * 0.64, 22 * u, 5 * u); c.fill();
    [A.legL, A.legR].forEach(leg => { legPath(c, A, leg, wl, wl * 0.8, leg.top, leg.bot); c.fill(); });
    c.strokeStyle = P.edge; c.globalAlpha = .4; c.lineWidth = 1 * u;
    [A.legL, A.legR].forEach(leg => { legPath(c, A, leg, wl, wl * 0.8, leg.top, leg.bot); c.stroke(); });
    c.restore();
  };
  ARCHETYPES.shorts = function (c, A, M, P) {
    const u = M.unit, wl = M.hipW * 0.19, mid = A.legL.top + (A.legL.bot - A.legL.top) * 0.42;
    c.save();
    c.fillStyle = grad(c, 0, A.hip.cy, 0, mid, P.hi, P.base);
    rr(c, A.hip.cx - M.hipW * 0.32, A.hip.cy - 8 * u, M.hipW * 0.64, 22 * u, 5 * u); c.fill();
    [A.legL, A.legR].forEach(leg => { legPath(c, A, leg, wl, wl, leg.top, mid); c.fill(); });
    c.restore();
  };
  ARCHETYPES.briefs = function (c, A, M, P) {
    const u = M.unit;
    c.save();
    c.fillStyle = grad(c, 0, A.hip.cy - 10 * u, 0, A.hip.cy + 26 * u, P.hi, P.base);
    c.beginPath();
    c.moveTo(A.hip.cx - M.hipW * 0.34, A.hip.cy - 10 * u); c.lineTo(A.hip.cx + M.hipW * 0.34, A.hip.cy - 10 * u);
    c.lineTo(A.hip.cx + M.hipW * 0.22, A.hip.cy + 30 * u); c.lineTo(A.hip.cx, A.hip.cy + 14 * u);
    c.lineTo(A.hip.cx - M.hipW * 0.22, A.hip.cy + 30 * u); c.closePath(); c.fill(); edge(c, P, u);
    c.restore();
  };

  // -- FEET -----------------------------------------------------------------
  ARCHETYPES.boot = function (c, A, M, P) {                          // hero
    const u = M.unit;
    c.save();
    [A.footL, A.footR].forEach(f => {
      const w = M.hipW * 0.16, ankTop = f.cy - 42 * u;
      c.fillStyle = grad(c, f.cx, ankTop, f.cx, f.cy, P.hi, P.base);
      c.beginPath();
      c.moveTo(f.cx - w, ankTop); c.lineTo(f.cx + w, ankTop); c.lineTo(f.cx + w * 1.1, f.cy - 6 * u);
      c.lineTo(f.cx + w * 2.0, f.cy - 6 * u); c.lineTo(f.cx + w * 2.0, f.cy); c.lineTo(f.cx - w * 1.1, f.cy);
      c.closePath(); c.fill(); edge(c, P, u);
      // steel toe
      c.fillStyle = grad(c, f.cx, f.cy - 8 * u, f.cx + w * 2, f.cy, '#9aa2ab', '#4b535a');
      c.beginPath(); c.moveTo(f.cx + w * 0.6, f.cy - 6 * u); c.lineTo(f.cx + w * 2.0, f.cy - 6 * u); c.lineTo(f.cx + w * 2.0, f.cy - 1 * u); c.lineTo(f.cx + w * 0.6, f.cy - 1 * u); c.closePath(); c.fill();
      // laces
      c.strokeStyle = 'rgba(200,230,230,.5)'; c.lineWidth = 1 * u;
      for (let yy = ankTop + 6 * u; yy < f.cy - 12 * u; yy += 7 * u) { c.beginPath(); c.moveTo(f.cx - w * 0.6, yy); c.lineTo(f.cx + w * 0.6, yy + 3 * u); c.moveTo(f.cx + w * 0.6, yy); c.lineTo(f.cx - w * 0.6, yy + 3 * u); c.stroke(); }
    });
    c.restore();
  };
  ARCHETYPES.sneaker = function (c, A, M, P) {
    const u = M.unit;
    c.save();
    [A.footL, A.footR].forEach(f => {
      const w = M.hipW * 0.15;
      c.fillStyle = grad(c, f.cx, f.cy - 20 * u, f.cx, f.cy, P.hi, P.base);
      c.beginPath();
      c.moveTo(f.cx - w, f.cy - 18 * u); c.lineTo(f.cx + w * 0.6, f.cy - 18 * u);
      c.quadraticCurveTo(f.cx + w * 2.1, f.cy - 12 * u, f.cx + w * 2.1, f.cy - 2 * u);
      c.lineTo(f.cx - w, f.cy - 2 * u); c.closePath(); c.fill(); edge(c, P, u);
      // sole
      c.fillStyle = '#e9edf0'; rr(c, f.cx - w, f.cy - 3 * u, w * 3.1, 4 * u, 2 * u); c.fill();
    });
    c.restore();
  };
  ARCHETYPES.sandal = function (c, A, M, P) {
    const u = M.unit;
    c.save();
    [A.footL, A.footR].forEach(f => {
      const w = M.hipW * 0.15;
      c.fillStyle = P.base; rr(c, f.cx - w, f.cy - 4 * u, w * 2.6, 4 * u, 2 * u); c.fill();
      c.strokeStyle = P.hi; c.lineWidth = 2.5 * u; c.beginPath(); c.moveTo(f.cx - w * 0.4, f.cy - 4 * u); c.lineTo(f.cx + w, f.cy - 16 * u); c.stroke();
    });
    c.restore();
  };

  // -- HANDS ----------------------------------------------------------------
  ARCHETYPES.glove = function (c, A, M, P) {
    const u = M.unit;
    c.save(); c.fillStyle = grad(c, 0, A.handL.cy - 12 * u, 0, A.handL.cy + 16 * u, P.hi, P.base);
    [A.handL, A.handR].forEach(h => { rr(c, h.cx - 8 * u, h.cy - 12 * u, 16 * u, 26 * u, 6 * u); c.fill(); });
    c.restore();
  };
  ARCHETYPES.gauntlet = function (c, A, M, P) {                      // hero
    const u = M.unit;
    c.save(); c.fillStyle = grad(c, 0, A.handL.cy - 20 * u, 0, A.handL.cy + 16 * u, P.hi, P.base);
    [A.handL, A.handR].forEach(h => {
      rr(c, h.cx - 10 * u, h.cy - 22 * u, 20 * u, 40 * u, 6 * u); c.fill(); edge(c, P, u);
      c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1 * u;
      for (let yy = h.cy - 14 * u; yy < h.cy + 12 * u; yy += 6 * u) { c.beginPath(); c.moveTo(h.cx - 9 * u, yy); c.lineTo(h.cx + 9 * u, yy); c.stroke(); }
    });
    c.restore();
  };
  ARCHETYPES.rings = function (c, A, M, P) {
    const u = M.unit; c.save(); c.strokeStyle = P.tier >= 3 ? '#e8c25a' : P.hi; c.lineWidth = 2 * u;
    [A.handL, A.handR].forEach(h => { for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(h.cx + i * 4 * u, h.cy + 6 * u, 2.4 * u, 0, 7); c.stroke(); } });
    c.restore();
  };

  // -- WEAPON  (pose-aware: 'spread' = held across body from weapon hand) ----
  function weaponFrame(c, A, M) {
    const h = A.weaponHand;
    c.translate(h.cx - M.unit * 4, h.cy - M.unit * 52);
    c.rotate(-0.72);
    return M.unit;
  }
  ARCHETYPES.longGun = function (c, A, M, P) {                       // hero
    c.save(); const u = weaponFrame(c, A, M);
    // barrel
    c.fillStyle = grad(c, -90 * u, 0, 40 * u, 0, '#2a3136', '#12171a'); rr(c, -96 * u, -6 * u, 120 * u, 9 * u, 3 * u); c.fill();
    c.fillStyle = 'rgba(224,120,60,.45)'; rr(c, -96 * u, -6 * u, 26 * u, 9 * u, 3 * u); c.fill();               // heat scar
    c.fillStyle = 'rgba(255,170,90,.85)'; c.beginPath(); c.arc(-96 * u, -1.5 * u, 3 * u, 0, 7); c.fill();       // muzzle
    // pump
    c.fillStyle = '#3a4248'; rr(c, -58 * u, 4 * u, 34 * u, 9 * u, 3 * u); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1 * u; for (let i = -54; i < -26; i += 5) { c.beginPath(); c.moveTo(i * u, 5 * u); c.lineTo(i * u, 12 * u); c.stroke(); }
    // receiver
    c.fillStyle = grad(c, 20 * u, -8 * u, 20 * u, 12 * u, '#39424a', '#191d21'); rr(c, 18 * u, -8 * u, 34 * u, 20 * u, 3 * u); c.fill(); edge(c, P, u);
    c.fillStyle = '#0a0d0f'; rr(c, 26 * u, -4 * u, 16 * u, 7 * u, 2 * u); c.fill();                             // ejection port
    // grip + stock
    c.fillStyle = '#20262b';
    c.beginPath(); c.moveTo(50 * u, 6 * u); c.lineTo(60 * u, 30 * u); c.lineTo(70 * u, 30 * u); c.lineTo(58 * u, 4 * u); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(50 * u, -4 * u); c.lineTo(96 * u, -10 * u); c.lineTo(100 * u, 2 * u); c.lineTo(52 * u, 8 * u); c.closePath(); c.fill();
    c.restore();
  };
  ARCHETYPES.pistol = function (c, A, M, P) {                        // hero
    c.save(); const u = weaponFrame(c, A, M); c.translate(30 * u, 30 * u); c.rotate(0.2);
    c.fillStyle = grad(c, -30 * u, -6 * u, 30 * u, 8 * u, '#39424a', '#181c20');
    rr(c, -34 * u, -7 * u, 60 * u, 12 * u, 2 * u); c.fill(); edge(c, P, u);                                     // slide
    c.fillStyle = '#0a0d0f'; c.beginPath(); c.arc(-34 * u, -1 * u, 2.4 * u, 0, 7); c.fill();                    // muzzle
    c.fillStyle = '#20262b'; c.beginPath(); c.moveTo(14 * u, 5 * u); c.lineTo(24 * u, 30 * u); c.lineTo(34 * u, 30 * u); c.lineTo(24 * u, 5 * u); c.closePath(); c.fill(); // grip
    c.restore();
  };
  ARCHETYPES.blade = function (c, A, M, P) {                         // hero
    c.save(); const u = weaponFrame(c, A, M); c.translate(40 * u, 20 * u); c.rotate(-0.15);
    // blade
    c.fillStyle = grad(c, -60 * u, 0, 10 * u, 0, '#c8d2d8', '#6b757c');
    c.beginPath(); c.moveTo(-70 * u, -3 * u); c.lineTo(6 * u, -4 * u); c.lineTo(6 * u, 4 * u); c.lineTo(-66 * u, 4 * u); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 1 * u; c.beginPath(); c.moveTo(-66 * u, -1 * u); c.lineTo(4 * u, -1 * u); c.stroke(); // edge glint
    // guard + grip
    c.fillStyle = P.tier >= 2 ? P.edge : '#2a2f33'; rr(c, 6 * u, -7 * u, 4 * u, 14 * u, 1 * u); c.fill();
    c.fillStyle = '#20262b'; rr(c, 10 * u, -3 * u, 22 * u, 6 * u, 2 * u); c.fill();
    c.restore();
  };
  ARCHETYPES.blunt = function (c, A, M, P) {                         // hero
    c.save(); const u = weaponFrame(c, A, M);
    // haft
    c.fillStyle = grad(c, -80 * u, 0, 20 * u, 0, '#5a5048', '#2c261f'); rr(c, -84 * u, -3 * u, 110 * u, 6 * u, 2 * u); c.fill();
    // head (hammer/wrench-ish block near the top)
    c.fillStyle = grad(c, -90 * u, -12 * u, -70 * u, 12 * u, '#59646c', '#2b3238');
    rr(c, -96 * u, -12 * u, 26 * u, 24 * u, 3 * u); c.fill(); edge(c, P, u);
    c.restore();
  };
  ARCHETYPES.baton = function (c, A, M, P) {
    c.save(); const u = weaponFrame(c, A, M); c.translate(20 * u, 20 * u);
    c.fillStyle = grad(c, -30 * u, 0, 20 * u, 0, '#39424a', '#181c20'); rr(c, -34 * u, -3 * u, 60 * u, 6 * u, 3 * u); c.fill();
    c.fillStyle = 'rgba(120,220,255,.9)'; c.beginPath(); c.arc(-34 * u, 0, 3 * u, 0, 7); c.fill();               // charged tip
    c.restore();
  };

  // -- ACCESSORY ------------------------------------------------------------
  ARCHETYPES.neck = function (c, A, M, P) {
    const u = M.unit, n = A.neck, gold = /chain|gold/i.test(P._name || '');
    c.save(); c.fillStyle = gold ? '#d8b24a' : P.hi;
    for (let t = 0; t <= 1; t += 1 / 9) { const x = n.cx - 18 * u + t * 36 * u, y = n.cy + 2 * u + Math.sin(t * Math.PI) * 16 * u; c.beginPath(); c.arc(x, y, 2.2 * u, 0, 7); c.fill(); }
    c.restore();
  };
  ARCHETYPES.wrist = function (c, A, M, P) {
    const u = M.unit; c.save(); c.fillStyle = P.tier >= 2 ? P.edge : P.hi;
    [A.handL, A.handR].forEach(h => { rr(c, h.cx - 8 * u, h.cy - 16 * u, 16 * u, 6 * u, 2 * u); c.fill(); });
    c.restore();
  };
  ARCHETYPES.pack = function (c, A, M, P) {
    const u = M.unit; c.save(); c.fillStyle = grad(c, 0, A.waist.cy, 0, A.waist.cy + 20 * u, P.hi, P.base);
    rr(c, A.waist.cx - 26 * u, A.waist.cy + 4 * u, 52 * u, 16 * u, 4 * u); c.fill(); edge(c, P, u);
    c.strokeStyle = P.base; c.lineWidth = 4 * u; c.beginPath(); c.moveTo(A.waist.cx - 26 * u, A.waist.cy + 8 * u); c.lineTo(A.waist.cx + 26 * u, A.waist.cy + 8 * u); c.stroke();
    c.restore();
  };
  ARCHETYPES.faceMask = function (c, A, M, P) {                      // hero
    const h = A.head, u = M.unit, R = h.r;
    c.save();
    c.fillStyle = grad(c, h.cx, h.cy, h.cx, h.cy + R, P.hi, P.base);
    c.beginPath(); c.moveTo(h.cx - R * 0.7, h.cy + R * 0.1); c.quadraticCurveTo(h.cx, h.cy + R * 1.0, h.cx + R * 0.7, h.cy + R * 0.1);
    c.lineTo(h.cx + R * 0.6, h.cy + R * 0.55); c.quadraticCurveTo(h.cx, h.cy + R * 0.95, h.cx - R * 0.6, h.cy + R * 0.55); c.closePath(); c.fill(); edge(c, P, u);
    // filter canister
    c.fillStyle = P.base; c.beginPath(); c.arc(h.cx, h.cy + R * 0.55, R * 0.26, 0, 7); c.fill(); edge(c, P, u);
    c.restore();
  };
  ARCHETYPES.tattoo = function (c, A, M, P) { /* skin-level; no overlay */ };

  // =========================================================================
  //  MASK LOADING  (build a white-on-transparent alpha mask canvas per body)
  // =========================================================================
  const _maskCache = {};
  function buildMask(img, cfg) {
    const cv = document.createElement('canvas'); cv.width = cfg.W; cv.height = cfg.H;
    const c = cv.getContext('2d'); c.drawImage(img, 0, 0, cfg.W, cfg.H);
    const d = c.getImageData(0, 0, cfg.W, cfg.H), px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = cfg.mode === 'luma' ? 255 - (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) : px[i + 3];
      px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = a;
    }
    c.putImageData(d, 0, 0); return cv;
  }
  function loadMasks(sources) {
    const cfg = Object.assign({}, MASKS, sources || {});
    const one = (body) => new Promise((res, rej) => {
      if (_maskCache[body]) return res(_maskCache[body]);
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { _maskCache[body] = buildMask(img, cfg[body]); res(_maskCache[body]); };
      img.onerror = rej; img.src = cfg[body].src;
    });
    return Promise.all([one('male'), one('female')]).then(() => _maskCache);
  }

  // =========================================================================
  //  PORTRAIT RENDER
  // =========================================================================
  function renderPortrait(canvas, spec) {
    const body = spec.body === 'female' ? 'female' : 'male';
    const cfg = MASKS[body], A = ANCHORS[body], M = metrics(A);
    const mask = _maskCache[body];
    if (!mask) throw new Error('CardRender: call loadMasks() before renderPortrait()');

    const dpr = Math.min(2, global.devicePixelRatio || 1);
    const W = canvas.width = canvas.clientWidth * dpr, H = canvas.height = canvas.clientHeight * dpr;
    const main = canvas.getContext('2d'); main.clearRect(0, 0, W, H);

    // fit the figure into the square, small bottom bias
    const figH = H * 0.95, s = figH / cfg.H, offX = (W - cfg.W * s) / 2, offY = H - figH - H * 0.01;

    // ground shadow
    const gx = offX + A.footL.cx * s + (A.footR.cx - A.footL.cx) * s / 2, gy = offY + (cfg.H - 8) * s;
    const g = main.createRadialGradient(gx, gy, 2, gx, gy, M.hipW * s);
    g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    main.fillStyle = g; main.beginPath(); main.ellipse(gx, gy, M.hipW * s, 14 * s * M.unit, 0, 0, 7); main.fill();

    // figure on an offscreen, in mask space
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const c = off.getContext('2d');
    c.setTransform(s, 0, 0, s, offX, offY); c.lineJoin = 'round'; c.lineCap = 'round';

    c.drawImage(mask, 0, 0, cfg.W, cfg.H);
    c.globalCompositeOperation = 'source-in';
    const bodyG = c.createLinearGradient(0, 0, 0, cfg.H);
    bodyG.addColorStop(0, '#2a3833'); bodyG.addColorStop(.55, '#151e1a'); bodyG.addColorStop(1, '#0b100e');
    c.fillStyle = bodyG; c.fillRect(0, 0, cfg.W, cfg.H);
    c.globalCompositeOperation = 'source-atop';
    const rl = c.createLinearGradient(0, 0, cfg.W, 0); rl.addColorStop(0, 'rgba(78,168,255,.85)'); rl.addColorStop(.4, 'rgba(78,168,255,0)');
    c.fillStyle = rl; c.fillRect(0, 0, cfg.W, cfg.H);
    const rr2 = c.createLinearGradient(cfg.W, 0, 0, 0); rr2.addColorStop(0, 'rgba(87,230,208,.7)'); rr2.addColorStop(.45, 'rgba(87,230,208,0)');
    c.fillStyle = rr2; c.fillRect(0, 0, cfg.W, cfg.H);
    c.fillStyle = 'rgba(0,0,0,.3)'; for (let y = 0; y < cfg.H; y += 3) c.fillRect(0, y, cfg.W, 1);

    // per-piece art, back-to-front by z
    c.globalCompositeOperation = 'source-over';
    const drawn = (spec.items || []).map(it => ({ it, k: classify(it) })).filter(x => x.k)
      .sort((a, b) => a.k.z - b.k.z);
    for (const { it, k } of drawn) {
      const fn = ARCHETYPES[k.archetype]; if (!fn) continue;
      k.palette._name = it.name || ''; c.save(); fn(c, A, M, k.palette, it); c.restore();
    }
    main.drawImage(off, 0, 0);
    return { body, count: drawn.length };
  }

  // rollup for the card header (rarity + power)
  function deriveCard(items) {
    let power = 0, top = 0;
    for (const it of items || []) {
      const armor = (it.tags && it.tags.armor) || 0;
      power += armor * 4 + (it.value || 0) / 20;
      top = Math.max(top, tierIndex(it.value, armor));
    }
    return { tier: top, tierName: TIERS[top].name, color: TIERS[top].edge, power: Math.round(power) };
  }

  global.CardRender = { MASKS, ANCHORS, ARCHETYPES, loadMasks, classify, deriveCard, renderPortrait, metrics };
})(typeof window !== 'undefined' ? window : this);
