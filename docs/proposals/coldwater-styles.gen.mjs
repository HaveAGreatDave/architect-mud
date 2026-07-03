import { current, proposed, MINX, MAXX, MINY, MAXY, D } from './mapdata.mjs';
import { writeFileSync } from 'node:fs';

// unified tile list with a cluster tag + live/expansion flag
const tiles=[];
for(const [id,,,x,y] of current) tiles.push({x,y,cl:D(id),live:true});
for(const [,,x,y,cl] of proposed) tiles.push({x,y,cl,live:false});

// clusters (incl. bunched Docks on the bay + The Yards in the east) come straight from mapdata
for(const t of tiles) t.ecl=t.cl;

const cols=MAXX-MINX+1, rows=MAXY-MINY+1;
const pitch=54,tile=50,mL=32,mT=120;
const px=x=>mL+(x-MINX)*pitch, py=y=>mT+(y-MINY)*pitch;
const W=mL+cols*pitch+mL;
const legendY0=mT+rows*pitch+28;

// big region labels overlaid on every style [text, gridX, gridY, fontSize]
const labels=[
  ["THE REDLINE",-9,-6,19],["COLDWATER BAY",2.4,-5.6,15],["DOCKS",2.4,-3.2,13],["NORTH CITY",6,-6,18],
  ["THE SPIRE",3.4,-2.1,12],["CIVIC",-2,-2.2,11],["CITY CORE",-0.2,0,17],["MARQUEE",3.5,0.4,13],
  ["THE YARDS",7,0.5,16],["UNDERMARKET",-0.2,3,15],["SLAGWORKS",-9.5,0.5,13],["THE ASHWAY",-6,0.4,13],
  ["BADLANDS",-2.6,1.4,12],["OUTER WASTES",-6,2.6,14],
];

function render(file,title,sub,map,groups){
  const H=legendY0+groups.length*24+40;
  let s=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="'Segoe UI',system-ui,sans-serif">`;
  s+=`<rect width="${W}" height="${H}" fill="#0b0e13"/>`;
  s+=`<text x="${mL}" y="42" fill="#e6edf3" font-size="26" font-weight="700">${title}</text>`;
  s+=`<text x="${mL}" y="68" fill="#8b98a5" font-size="15">${sub}</text>`;
  s+=`<g transform="translate(${W-46},44)"><text x="0" y="0" fill="#6b7684" font-size="12" text-anchor="middle">N</text><line x1="0" y1="4" x2="0" y2="22" stroke="#6b7684" stroke-width="1.4"/><polygon points="0,2 -4,9 4,9" fill="#6b7684"/></g>`;
  const gmap=Object.fromEntries(groups.map(g=>[g.k,g]));
  for(const t of tiles){
    const g=gmap[map(t)]||{c:"#2a2f38"};
    const X=px(t.x),Y=py(t.y);
    s+=`<rect x="${X}" y="${Y}" width="${tile}" height="${tile}" rx="3" fill="${g.c}" stroke="#00000055" stroke-width="1"/>`;
    if(t.cl==='danger') s+=`<text x="${X+tile-8}" y="${Y+13}" fill="#ffd0d0" font-size="11" text-anchor="middle">☢</text>`;
    if(t.cl==='water') s+=`<text x="${X+tile/2}" y="${Y+tile/2+5}" fill="#bfe0f5" font-size="15" text-anchor="middle" opacity="0.7">≈</text>`;
  }
  for(const [txt,x,y,fs] of labels){
    const cx=px(x)+tile/2, cy=py(y)+tile/2;
    const w=txt.length*fs*0.62+16, hh=fs+10;
    s+=`<rect x="${cx-w/2}" y="${cy-hh/2}" width="${w}" height="${hh}" rx="${hh/2}" fill="#0b0e13" opacity="0.55"/>`;
    s+=`<text x="${cx}" y="${cy+fs*0.35}" fill="#f2f6fa" font-size="${fs}" font-weight="700" letter-spacing="1.2" text-anchor="middle">${txt}</text>`;
  }
  s+=`<text x="${mL}" y="${legendY0-6}" fill="#e6edf3" font-size="16" font-weight="700">Legend — ${title.split('—').pop().trim()}</text>`;
  groups.forEach((g,i)=>{const ey=legendY0+8+i*24;
    s+=`<rect x="${mL}" y="${ey}" width="18" height="18" rx="3" fill="${g.c}" stroke="#00000055"/>`;
    s+=`<text x="${mL+26}" y="${ey+14}" fill="#c7d2dc" font-size="13.5">${g.l}</text>`;});
  s+=`<text x="${mL}" y="${legendY0+8+groups.length*24+16}" fill="#6b7684" font-size="12">▣ Plus THE UNDER — z-1 metro + z-2 caverns (14 tiles) on a separate subterranean layer, not shown.</text>`;
  s+=`</svg>`;
  writeFileSync(file,s);
  return file;
}

const inSet=(cl,...a)=>a.includes(cl);

// STYLE 1 — TERRAIN / LANDMASS
render("style_terrain.svg",
  "ARCHITECT — Terrain View",
  "What each part physically IS: water, city, docks on the shore, slaglands/wastes, or lethal Redline.",
  t=> t.ecl==='water'?'water' : t.ecl==='danger'?'redline' : t.ecl==='docks'?'docks'
      : inSet(t.ecl,'slag','ash','bad','wastes')?'slag':'city',
  [
    {k:'water',c:'#1f5f86',l:'Water — Coldwater Bay & harbour'},
    {k:'docks',c:'#2f8fb0',l:'Docks — waterfront on the bay'},
    {k:'city',c:'#caa25a',l:'City — built-up urban districts'},
    {k:'slag',c:'#7c6a4a',l:'Slaglands & wastes — industrial / ruined ground'},
    {k:'redline',c:'#b23a2e',l:'☢ The Redline — lethal hazard zone'},
  ]);

// STYLE 2 — DANGER / THREAT
render("style_danger.svg",
  "ARCHITECT — Danger Heatmap",
  "How lethal each area is, safe (green) → lethal (deep red).",
  t=> t.ecl==='water'?'water' : t.ecl==='danger'?'lethal' : t.ecl==='market'?'high'
      : inSet(t.ecl,'slag','bad')?'med' : inSet(t.ecl,'ash','wastes','yards')?'low'
      : inSet(t.ecl,'mq','docks')?'guarded':'safe',
  [
    {k:'safe',c:'#2e8b57',l:'Safe — patrolled city core & heights'},
    {k:'guarded',c:'#8ab23a',l:'Low — nightlife, docks & waterfront'},
    {k:'low',c:'#d9c33a',l:'Moderate — ashway, yards & outer wastes'},
    {k:'med',c:'#e08a2c',l:'Rough — slaglands & badlands'},
    {k:'high',c:'#c85a2a',l:'Dangerous — undermarket / deep sprawl'},
    {k:'lethal',c:'#6e1515',l:'☢ Lethal — the Redline'},
    {k:'water',c:'#33628a',l:'Water (impassable)'},
  ]);

// STYLE 3 — FUNCTION / LAND USE
render("style_function.svg",
  "ARCHITECT — Land-Use / Function",
  "What each district is FOR: governance, port, freight, trade, industry, nightlife, hazard.",
  t=> ({cityN:'gov',spire:'fin',civic:'civic',city:'core',mq:'night',docks:'port',yards:'yards',market:'slum',danger:'hazard',water:'water'}[t.ecl])
      || (inSet(t.ecl,'slag','ash','bad','wastes')?'ind':'core'),
  [
    {k:'gov',c:'#3f5fb0',l:'Government / corporate — North City'},
    {k:'fin',c:'#8e6fd0',l:'Elite / finance — the Spire'},
    {k:'civic',c:'#3fb58c',l:'Civic / institutional'},
    {k:'core',c:'#5a8fb0',l:'Mixed urban core'},
    {k:'night',c:'#c05fd0',l:'Nightlife / commercial — Marquee'},
    {k:'port',c:'#33a0c4',l:'Port / waterfront — Docks'},
    {k:'yards',c:'#b0803a',l:'Freight / warehousing — The Yards'},
    {k:'slum',c:'#d08a3a',l:'Black market / slum — Undermarket'},
    {k:'ind',c:'#9a8a4f',l:'Industrial / wasteland'},
    {k:'hazard',c:'#e05555',l:'Hazard / no-go — Redline'},
    {k:'water',c:'#2f77a8',l:'Water'},
  ]);

// STYLE 4 — FACTION / CONTROL
render("style_faction.svg",
  "ARCHITECT — Faction Control",
  "Who holds the ground: corp, police, independents, gangs, mutants, scavengers.",
  t=> inSet(t.ecl,'cityN','spire')?'corp' : inSet(t.ecl,'civic','city')?'muni'
      : inSet(t.ecl,'mq','docks','yards')?'indep' : t.ecl==='market'?'gang' : t.ecl==='danger'?'feral'
      : t.ecl==='water'?'water':'scav',
  [
    {k:'corp',c:'#6f8fe0',l:'Halcyon Corp / the Architect'},
    {k:'muni',c:'#3f9fb0',l:'Municipal / CPD (police)'},
    {k:'indep',c:'#d0a24e',l:'Independent / free trade — docks, yards, Marquee'},
    {k:'gang',c:'#c0572e',l:'Undermarket gangs'},
    {k:'feral',c:'#b0271f',l:'Feral / mutant — unclaimed'},
    {k:'scav',c:'#8a8a5a',l:'Scavengers / unclaimed waste'},
    {k:'water',c:'#2f6f9a',l:'Water'},
  ]);

// STYLE 5 — EXISTING vs EXPANSION (two-colour overlay)
render("style_existing.svg",
  "ARCHITECT — Existing vs Expansion",
  "What's already built (teal) vs the proposed expansion tiles (orange). Surface only.",
  t=> t.live?'live':'new',
  [
    {k:'live',c:'#2f9e8f',l:`Existing tiles — already built (${tiles.filter(t=>t.live).length})`},
    {k:'new',c:'#e08a2c',l:`Expansion tiles — proposed (${tiles.filter(t=>!t.live).length})`},
  ]);

// STYLE 6 — BUILD PHASES as equal-size compact regions (median-cut of the NEW tiles)
const NPHASES=12;
const other=a=>a==='x'?'y':'x';
function partition(arr,k){
  if(k<=1||arr.length<=1) return [arr];
  const xs=arr.map(t=>t.x), ys=arr.map(t=>t.y);
  const ax=(Math.max(...xs)-Math.min(...xs))>=(Math.max(...ys)-Math.min(...ys))?'x':'y';
  const s=[...arr].sort((p,q)=> p[ax]-q[ax] || p[other(ax)]-q[other(ax)]);
  const k1=Math.floor(k/2), cut=Math.round(s.length*k1/k);
  return [...partition(s.slice(0,cut),k1), ...partition(s.slice(cut),k-k1)];
}
const newTiles=tiles.filter(t=>!t.live);
let regions=partition(newTiles,NPHASES);
// order phases outward from the existing core (0,0)
const cxy=r=>[r.reduce((a,t)=>a+t.x,0)/r.length, r.reduce((a,t)=>a+t.y,0)/r.length];
regions.sort((a,b)=>{const[ax,ay]=cxy(a),[bx,by]=cxy(b); return (ax*ax+ay*ay)-(bx*bx+by*by);});
const PAL=['#4363d8','#3cb44b','#f58231','#911eb4','#42d4f4','#f032e6','#e6194B','#bfef45','#469990','#9A6324','#ffe119','#dcbeff'];
const groups=[{k:'built',c:'#3a4049',l:`Already built (${tiles.filter(t=>t.live).length} existing)`}];
regions.forEach((r,i)=>{ const k='ph'+i; for(const t of r) t.region=k; groups.push({k,c:PAL[i%PAL.length],l:`Phase ${i+1} — ${r.length} new tiles`}); });
render("style_phases.svg",
  "ARCHITECT — Build Phases, balanced (≈equal tile counts)",
  `${NPHASES} compact phases of roughly equal size, ordered outward from the city core. Grey = already built.`,
  t=> t.live?'built':t.region,
  groups);

const sizes=regions.map(r=>r.length);
console.log("wrote 6 styles — balanced phases",sizes.length,"sizes",sizes.join(','),"min",Math.min(...sizes),"max",Math.max(...sizes));
