import 'dotenv/config';
import { query } from '../db.js';
const pj=(v,f)=>{if(v==null)return f;if(typeof v==='object')return v;try{return JSON.parse(v)}catch{return f}};
const {rows}=await query(`SELECT id,name,map_id,grid_x,grid_y,parent_zone,exits,flags,ambient_theme FROM zones WHERE id LIKE 'zone_slag%' OR id LIKE 'zone_ash%' ORDER BY id`);
for(const z of rows){console.log(`${z.id} | ${z.name} | map=${z.map_id} grid=(${z.grid_x},${z.grid_y}) parent=${z.parent_zone} flags=${JSON.stringify(pj(z.flags,{}))} theme=${z.ambient_theme}`);console.log(`   exits=${JSON.stringify(pj(z.exits,{}))}`);}
process.exit(0);
