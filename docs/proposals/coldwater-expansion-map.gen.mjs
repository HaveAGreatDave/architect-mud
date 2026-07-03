import { writeFileSync } from 'node:fs';

const current = [
  ["zone_powerplantnew","Coolant Flats","CP",-1,-2],["zone_ext_1782953094650","Limelight Lot","KS",0,-2],
  ["zone_slag_flarestack","Flarestack Field","FF",-10,-1],["zone_slag_catalyst","Catalyst Row","CR",-9,-1],
  ["zone_warehouse","Loading Bay West","LW",-2,-1],["zone_city_east","The Loading Bay","LB",-1,-1],
  ["zone_city_north","Threshold Plaza N","TN",0,-1],["zone_city_ne","Custodian Row","CU",1,-1],
  ["zone_meridian","Halcyon Walk","HW",2,-1],["zone_mq_cathode","Cathode Row","CT",3,-1],["zone_mq_chrome_court","Foundry Cut","CC",4,-1],
  ["zone_slag_reclaimer","The Reclaimer","RC",-11,0],["zone_slag_rail","The Rail Throat","RT",-10,0],
  ["zone_slag_yard","The Cracking Yard","CY",-9,0],["zone_slag_gate","Slagworks Gate","SG",-8,0],
  ["zone_ashway_wash","The Dry Wash","DW",-7,0],["zone_ashway_ashfall","Ashfall Mile","AF",-6,0],
  ["zone_ashway_road","The Haul Road","HR",-5,0],["zone_ruins","Old Coldwater","OC",-4,0],
  ["zone_badland_w_gate","Rust Quarter W","QW",-3,0],["zone_outskirts","The Rust Quarter","RQ",-2,0],
  ["zone_city_west","Franchise Strip","FS",-1,0],["zone_threshold","The Threshold","TR",0,0],
  ["zone_thresholdeast","Threshold East","TE",1,0],["zone_velk_exterior","Castoff Walk","Fu",2,0],
  ["zone_mq_marquee","The Marquee","MQ",3,0],["zone_mq_battery","Battery Square","BS",4,0],["zone_mq_precinct","Muster Yard","P9",5,0],
  ["zone_slag_drums","The Drum Yard","DY",-10,1],["zone_slag_sump","The Effluent Sump","ES",-9,1],
  ["zone_deep_waste","The Falloff","BL",-3,1],["zone_badland_sw_outer","The Static Wood","SW",-2,1],
  ["zone_city_sw","The Under Entrance","UE",-1,1],["zone_city_south","The Sprawl Gate","SG2",0,1],
  ["zone_city_se","The Clinic Block","CB",1,1],["zone_drum_exterior","Second Skin","Cl",2,1],
  ["zone_mq_ember","Ember Alley","EM",3,1],["zone_mq_overpass","The Overpass","OP",4,1],["zone_mq_cage","Tin Lane","CG",5,1],
  ["zone_slums","The Sprawl","SP",0,2],["zone_weapons_exterior","Rebar Cut","QS",3,2],
];

// hand-named proposed [name,marker,x,y,cluster]
const named = [
  // Uptown / Halcyon Spire
  ["Mediaform Plaza","MP",0,-3,"spire"],["Arcology Terrace","AT",1,-3,"spire"],["The Halcyon Spire","▲",2,-3,"spire"],["Executive Mall","EX",3,-3,"spire"],["Sky Garden","Sy",4,-3,"spire"],["Boardroom Row","BR",5,-3,"spire"],
  ["Uptown Gate","UG",1,-2,"spire"],["Spire Approach","SA",2,-2,"spire"],["Skyway Landing","SK",3,-2,"spire"],["Chrome Heights","CH",4,-2,"spire"],["Investor's Walk","IW",5,-2,"spire"],
  // Civic North
  ["The Commons","CM",-3,-3,"civic"],["Ledger Hall","LG",-2,-3,"civic"],["Civic Steps","CS",-1,-3,"civic"],
  ["Meltwater Row","MR",-3,-2,"civic"],["Aid Station","AD",-2,-2,"civic"],["Sortation Yard","SY",-3,-1,"civic"],
  // Docks & Harbor (core + north/south edges)
  ["North Mole","NM",6,-3,"docks"],["Customs Pier","CX",7,-3,"docks"],["The Seawall",'SE',8,-3,"docks"],
  ["Fishgut Row","FR",6,-2,"docks"],["Brine Yard","BY",7,-2,"docks"],["The Seawatch","SC",8,-2,"docks"],
  ["Harbor Gate","HB",5,-1,"docks"],["Coldstore","Co",6,-1,"docks"],["Gull Roost","GR",7,-1,"docks"],["Watch Point","WP",8,-1,"docks"],
  ["Sluice Gate","SL",6,0,"docks"],["Drowned Piers","DP",7,0,"docks"],["The Breakwater","BW",8,0,"docks"],
  ["The Wharf","WH",6,1,"docks"],["Smuggler's Slip","SS",7,1,"docks"],["Hulk Graveyard","HG",8,1,"docks"],
  ["Tide Flats","TF",6,2,"docks"],["The Netyard","NY",7,2,"docks"],["Drowned Reach","DR",8,2,"docks"],
  ["Low Tide","LT",6,3,"docks"],["The Shallows","TS",7,3,"docks"],["Wreckers' Point","WK",8,3,"docks"],
  // Undermarket / Deep Sprawl
  ["Tarpit Edge","Tk",-3,2,"market"],["The Warrens","WR",-2,2,"market"],["Cardboard Row","Cd",-1,2,"market"],["Scab Alley","Sc",1,2,"market"],["Gutter Market","GM",2,2,"market"],["Ashpit","AP",4,2,"market"],["Slaughter Lane","SN",5,2,"market"],
  ["The Sink","SK2",-3,3,"market"],["Rot Row","RR",-2,3,"market"],["Wormtown","WT",-1,3,"market"],["The Maw","MW",0,3,"market"],["Bonepicker's End","BP",1,3,"market"],["Gasp Hollow","GH",2,3,"market"],["The Deep Maw","DM",3,3,"market"],["Offal Lane","OL",4,3,"market"],["Carrion Way","CW",5,3,"market"],
];

// name pools for auto-filled cells (used in reading order)
const wastePool = ["Slag Verge","Cinder Flat","Ash Reach","Rust Hollow","Clinker Row","The Tailings","The Scald","Dead Furnace","Ferrous Wash","Scrap Mesa","The Leachfield","Ashen Steppe","Broken Kiln","The Grey Mile","Sootbank","Slaghollow","Ember Waste","The Cull","Rebar Field","Oxide Flats","The Downwind","Char Gully","Pit Nine","The Overburden","Tar Seep","Molten Row","The Windrow","Coke Yard","Fume Alley","The Blight","Cinder Steps","Dross Flat","The Smoulder","Gravel Throat","The Sinter","Rust Marsh","The Palings","Slake Pond","The Endcut","Cold Slag","The Reek","Ashen Verge","Dead Flat","The Verge","Grit Row","The Culvert","Slag Bar","Ashen Cut","The Drossworks","Ferro Flat","The Tipple","Coalsack","The Nadir","Rime Flat","The Gantry","Dust Reach","The Hopper","Cinderway","The Runoff","Grime Row","The Bailey","Ashlot","The Draff","Salt Verge"];
// north city expansion (govt / corporate / residential heights)
const cityNPool = ["Ministry Row","The Assembly","Prefect Plaza","Halcyon Heights","Sable Court","The Concordat","Meridian Heights","Glass Terrace","The Bourse","Registry Hall","Cobalt Court","Vantage Row","Skyline Walk","The Consulate","Ivory Deck","Tessellate Plaza","The Mezzanine","Onyx Row","Datum Court","The Spindle","Highwater Court","The Palisade","Beacon Row","Chancery Walk","Vellum Court","North Gallery","Solace Terrace","The Manifold","Argent Row","The Causeway","Loft Nine","North Terraces","Nimbus Walk","The Overlook","Pilot Row","North Junction","Zephyr Court","The Cloisters","Marble Cut","The Reserve","Halon Court","The Uplink","Verdigris Row","The Colonnade","Static Court","The Parapet","North Rail","North Ingress","Cinder Spire","The Vault"];
// top-left LETHAL frontier (mutant / irradiated / gang)
const dangerPool = ["The Redline","Glowfield","The Killing Floor","Mutie Warren","The Rad Sink","Hazard Nine","The Meltline","Feral Yard","The Screaming Lot","Cull Row","The Bonepit","Rictus Alley","The Slaughterworks","Vex Hollow","The Gnash","Marrow Row","The Flensing","Dread Furnace","North Abattoir","Gore Gully","The Wither","Scourge Flat","The Maul","Ravener Nest","The Blightworks","Carnage Row","The Splinter","Gristle Yard","The Rend","Havoc Flat","The Shambles","Viral Reach","The Chokehold","Necrosis Row","The Cinderpit","Rabid Row","The Gnawing","Offcut Yard","The Rustlung","Feral Cut","The Howl","Sickle Row","The Cleaver","Gallows Flat","The Maggot","Rot Gully","The Snare","Vermin Reach","The Grind","Ashen Maw","The Tannery","Cutthroat Row","The Pyre","Deadfall"];

const MINX=-11,MAXX=8,MINY=-7,MAXY=3;         // expanded northward considerably
const NORTH_EDGE=-4;                            // y <= this is new north expansion
const DANGER_X=-4;                              // x <= this (wiggled) in the north = lethal frontier
const key=(x,y)=>x+","+y;
// deterministic hash 0..1 (GLSL-style) — organic boundaries without Math.random
const h=(x,y)=>{const s=Math.sin(x*127.1+y*311.7)*43758.5453;return s-Math.floor(s);};
// Coldwater Bay — an inlet biting south into the city from the north
const water=new Set(["1,-7","2,-7","3,-7","4,-7","0,-6","1,-6","2,-6","3,-6","4,-6","5,-6","1,-5","2,-5","3,-5","4,-5","2,-4","3,-4"]);
const waterAnchor="2,-6";
const occ=new Set([...current.map(c=>key(c[3],c[4])), ...named.map(p=>key(p[2],p[3]))]);
const marker=(n)=>{const w=n.replace(/^The\s+/,'').split(/\s+/);return (w.length>=2?(w[0][0]+w[1][0]):n.slice(0,2)).toUpperCase();};
const fills=[]; const idx={wastes:0,cityN:0,danger:0};
const pool={wastes:wastePool,cityN:cityNPool,danger:dangerPool};
for(let y=MINY;y<=MAXY;y++) for(let x=MINX;x<=MAXX;x++){
  const k=key(x,y);
  if(occ.has(k)) continue;                 // never touch live/named tiles
  if(water.has(k)){ fills.push([k===waterAnchor?"Coldwater Bay":"","≈",x,y,"water"]); occ.add(k); continue; }
  // region: wiggled Redline/CityN border in the north, wastes elsewhere.
  // The seam between the north expansion and the wastes (green-brown / rust-red border)
  // undulates per-column (-3/-4/-5) instead of a straight y=-4 line.
  const t=h(x*3.7+11,-2.5); const seam=NORTH_EDGE+(t<0.30?1:(t>0.72?-1:0));
  let cl;
  if(y<=seam){
    // three north bands with wavy borders: Redline (far west) | wastes buffer | North City.
    // The wastes band separates the danger from the city — you cross it to get there.
    const dEdge=-8+(h(x*1.3,y)<0.5?-1:0);      // danger only x <= -8/-9
    const wEdge=-5+(h(x*1.9+2,y)<0.55?0:1);    // city starts x > -5/-4
    cl = (x<=dEdge)?"danger" : (x<=wEdge)?"wastes" : "cityN";
  } else {
    cl="wastes";
    // SINGLE-column Redline neck: drops from the NW block to the top of the Slagworks
    // (Reclaimer at -11,0) and stops there — one link, no wrapping around the Slagworks.
    if(x===MINX && y<=0) cl="danger";
  }
  const nm=pool[cl][idx[cl]++]||(cl+" "+x+"/"+y);
  fills.push([nm,marker(nm),x,y,cl]);
  occ.add(k);
}
const proposed=[...named,...fills];

// --- Docks/Yards geography ---
// The old east "docks" block (x>=5) becomes The Yards (freight/warehousing).
// A single BUNCHED docks area sits on the south shore of Coldwater Bay (near the water, not the whole shoreline).
const YARDS=["Container Row","The Freightworks","Gantry Yard","The Sidings","Pallet Row","Crane Alley","The Depot","Boxcar Lane","The Marshalling Yard","Reefer Row","The Loadout","Dray Street","The Weighbridge","Chassis Row","The Transfer Dock","Forklift Flat","The Bonded Store","Tare Row","The Railhead","Skid Row","The Interchange","Bulk Yard"];
const DOCKS={"1,-3":"The Wharf","2,-3":"The Quays","3,-3":"Fishmarket Dock","4,-3":"Smuggler's Slip","1,-4":"Cold Storage","4,-4":"The Boat Yard"};
let yi=0;
for(const p of proposed){ if(p[4]==='docks'){ p[4]='yards'; p[0]=YARDS[yi++]||p[0]; p[1]=marker(p[0]); } }
for(const p of proposed){ const dn=DOCKS[p[2]+","+p[3]]; if(dn){ p[0]=dn; p[1]=marker(p[0]); p[4]='docks'; } }
const pc=(cl)=>proposed.filter(p=>p[4]===cl).length;

// expanded under (14)
const under = [
  ["Uptown Platform","UP",3,0,"↑ Spire Approach"],
  ["Reservoir Halt","RH",0,1,"↑ Dry Wash"],["Slagworks Halt","SH",1,1,"↑ Cracking Yard"],["Ashline Cut","AC",2,1,""],
  ["Central Exchange","CE",3,1,"↑ Threshold"],["Marquee Platform","MF",4,1,"↑ The Marquee"],["Dockside Terminus","DT",5,1,"↑ Sluice Gate"],
  ["Sprawl Platform","SF",3,2,"↑ The Sprawl"],["Sump Junction","SJ",4,2,""],["The Nest","NS",5,2,""],
  ["The Sunless Sea","Su",2,3,""],["Fungal Cavern","FG",3,3,""],["The Deep Line","DL",4,3,""],["Maintenance Vault","MV",5,3,""],
];

const D=(id)=> id.startsWith("zone_slag_")?"slag": id.startsWith("zone_ashway_")?"ash":
  (id.startsWith("zone_ruins")||id.startsWith("zone_badland_")||id==="zone_deep_waste"||id==="zone_outskirts")?"bad":
  (id.startsWith("zone_mq_")||id==="zone_meridian"||id==="zone_velk_exterior"||id==="zone_drum_exterior"||id==="zone_weapons_exterior")?"mq":"city";
const DIST={slag:{f:"#7a3418",s:"#c76b34",l:"Slagworks (live)"},ash:{f:"#5c5236",s:"#a8996a",l:"The Ashway (live)"},
  bad:{f:"#454b2c",s:"#8a934f",l:"Ruins & Badlands (live)"},city:{f:"#1c4c56",s:"#3fa0b0",l:"City Core (live)"},mq:{f:"#4a2150",s:"#c05fd0",l:"Marquee District (live)"}};
const nCnt=(cl)=>fills.filter(f=>f[4]===cl).length;
const PROP={water:{f:"#0f3a57",s:"#3d86bf",l:"≈ Coldwater Bay — water, north inlet ("+nCnt('water')+")"},
  cityN:{f:"#22315e",s:"#6f8fe0",l:"⊕ North City expansion — govt/corporate/residential heights ("+nCnt('cityN')+")"},
  danger:{f:"#5a1616",s:"#e05555",l:"⊕ ☢ The Redline — LETHAL frontier, top-left ("+nCnt('danger')+")"},
  spire:{f:"#4a3d0c",s:"#e8c84a",l:"⊕ Uptown / Halcyon Spire (11)"},
  civic:{f:"#123f34",s:"#4ec79a",l:"⊕ Civic North (6)"},
  docks:{f:"#0d4a5e",s:"#33c4d8",l:"⊕ The Docks — bay waterfront ("+pc('docks')+")"},
  yards:{f:"#4a3a1c",s:"#b0803a",l:"⊕ The Yards — freight/warehousing, east ("+pc('yards')+")"},
  market:{f:"#4a2f16",s:"#d08a3a",l:"⊕ Undermarket / Deep Sprawl (16)"},
  wastes:{f:"#3a3d1c",s:"#9aa24f",l:"⊕ Outer Wastes infill ("+nCnt('wastes')+")"},
  under:{f:"#2e1a45",s:"#a06fd0",l:"⊕ The Under: metro + caverns, z-1/z-2 (14)"}};

const pitch=90,tile=82,mL=40,mT=100;
const px=x=>mL+(x-MINX)*pitch, py=y=>mT+(y-MINY)*pitch;
const cols=MAXX-MINX+1, rows=MAXY-MINY+1;
const gridBottom=mT+rows*pitch;
const insetTop=gridBottom+30;
const insetOX=mL+40, insetOY=insetTop+40, ipitch=150, itile=120, iH=74.4;
const W=mL+cols*pitch+40;
const legendRows=Math.ceil((5+Object.keys(PROP).length)/2);
const H=insetOY+4*ipitch+60+legendRows*28+40;

let s=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="'Segoe UI',system-ui,sans-serif">`;
s+=`<rect width="${W}" height="${H}" fill="#0b0e13"/>`;
s+=`<defs><filter id="g"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
const nWater=nCnt('water'), nLand=proposed.length-nWater;
s+=`<text x="${mL}" y="44" fill="#e6edf3" font-size="30" font-weight="700">ARCHITECT — North Expansion: Coldwater Bay + Lethal Frontier</text>`;
s+=`<text x="${mL}" y="72" fill="#8b98a5" font-size="16">41 live · ${nLand} proposed land · ${nWater} water · 14 under · full ${cols}×${rows} rectangle · organic districts · ☢ lethal top-left · ≈ bay bites into the north city · N ↑</text>`;
s+=`<g transform="translate(${W-70},46)"><text x="0" y="0" fill="#6b7684" font-size="13" text-anchor="middle">N</text><line x1="0" y1="4" x2="0" y2="26" stroke="#6b7684" stroke-width="1.5"/><polygon points="0,2 -4,10 4,10" fill="#6b7684"/></g>`;

const tileEl=(X,Y,w,h,name,mk,f,st,dashed,note,danger)=>{
  let t=`<g><rect x="${X}" y="${Y}" width="${w}" height="${h}" rx="7" fill="${f}" stroke="${st}" stroke-width="${dashed?2.5:1.6}"${dashed?' stroke-dasharray="7 5" filter="url(#g)"':''}/>`;
  if(danger) t+=`<text x="${X+w-9}" y="${Y+15}" fill="#ff8a8a" font-size="12" text-anchor="middle">☢</text>`;
  if(mk) t+=`<text x="${X+w/2}" y="${Y+h*0.45}" fill="#f0f4f8" font-size="${Math.round(h*0.30)}" font-weight="700" text-anchor="middle">${mk}</text>`;
  const words=name.split(' ');let l1=name,l2='';
  if(name.length>11){let a=[],b=[],half=0;for(const wd of words){if(half<name.length/2){a.push(wd);half+=wd.length+1;}else b.push(wd);}l1=a.join(' ');l2=b.join(' ');}
  const baseY=note?Y+h-26:(l2?Y+h-20:Y+h-14);
  t+=`<text x="${X+w/2}" y="${baseY}" fill="#c7d2dc" font-size="10.5" text-anchor="middle">${l1}</text>`;
  if(l2) t+=`<text x="${X+w/2}" y="${baseY+12}" fill="#c7d2dc" font-size="10.5" text-anchor="middle">${l2}</text>`;
  if(note) t+=`<text x="${X+w/2}" y="${Y+h-8}" fill="#c9a6f0" font-size="10" text-anchor="middle">${note}</text>`;
  return t+`</g>`;
};

for(const [id,name,mk,x,y] of current){const d=DIST[D(id)];s+=tileEl(px(x),py(y),tile,tile,name,mk,d.f,d.s,false);}
for(const [name,mk,x,y,cl] of proposed){const p=PROP[cl];s+=tileEl(px(x),py(y),tile,tile,name,mk,p.f,p.s,cl!=='water',null,cl==='danger');}

// UNDER inset
s+=`<line x1="${mL}" y1="${insetTop}" x2="${W-40}" y2="${insetTop}" stroke="#20262f" stroke-width="1"/>`;
s+=`<text x="${mL}" y="${insetTop+26}" fill="#c9a6f0" font-size="17" font-weight="700">THE UNDER — z-1 metro line + z-2 caverns (expanded, 14)</text>`;
const ix=c=>insetOX+c*ipitch, iy=r=>insetOY+r*ipitch;
const rail=(c1,r1,c2,r2)=>`<line x1="${ix(c1)+itile/2}" y1="${iy(r1)+iH/2}" x2="${ix(c2)+itile/2}" y2="${iy(r2)+iH/2}" stroke="#a06fd0" stroke-width="3" stroke-dasharray="2 6" opacity="0.85"/>`;
s+=rail(0,1,1,1)+rail(1,1,2,1)+rail(2,1,3,1)+rail(3,1,4,1)+rail(4,1,5,1);
s+=rail(3,0,3,1);
s+=rail(3,1,3,2)+rail(3,2,4,2)+rail(4,2,5,2);
s+=rail(4,2,4,3)+rail(2,3,3,3)+rail(3,3,4,3)+rail(4,3,5,3);
for(const [name,mk,c,r,note] of under){s+=tileEl(ix(c),iy(r),itile,iH,name,mk,PROP.under.f,PROP.under.s,true,note);}

// legend
let ly=insetOY+4*ipitch-28;
s+=`<text x="${mL}" y="${ly}" fill="#e6edf3" font-size="17" font-weight="700">Legend</text>`;
const items=[...Object.values(DIST),...Object.values(PROP)];
items.forEach((it,i)=>{const col=i%2,row=Math.floor(i/2);const ex=mL+col*640,ey=ly+14+row*28;
  const dash=it.l.startsWith('⊕');
  s+=`<rect x="${ex}" y="${ey}" width="20" height="20" rx="4" fill="${it.f}" stroke="${it.s}" stroke-width="${dash?2.5:1.6}"${dash?' stroke-dasharray="5 4"':''}/>`;
  s+=`<text x="${ex+28}" y="${ey+15}" fill="#c7d2dc" font-size="14">${it.l}</text>`;});
s+=`</svg>`;
if(process.argv[2]) writeFileSync(process.argv[2],s);
// reusable exports for the alternate-style renderer
export { current, proposed, under, MINX, MAXX, MINY, MAXY, D };
