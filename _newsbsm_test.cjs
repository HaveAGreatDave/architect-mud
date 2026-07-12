const fs = require('fs'), path = require('path'), url = require('url');
const root = process.cwd();
// 1) Compile the .bsm via the (browser-global) compiler, eval'd in this non-strict CJS scope
eval(fs.readFileSync(path.join(root,'client/devpanel/js/bsm-compiler.js'),'utf8'));
const c = compileBsm(fs.readFileSync(path.join(root,'data/scripts/raptor_news.bsm'),'utf8'));
console.log('meta.type      :', c.meta.type);
console.log('anchors        :', c.newsScript.anchors);
console.log('reporters      :', c.newsScript.reporters);
console.log('announcer      :', c.newsScript.announcer);
console.log('title          :', c.newsScript.title, '| assets:', c.assets.map(a=>a.id));
console.log('pool keys      :', Object.keys(c.newsScript.pools).sort().join(', '));
console.log('unknownDirectiv:', c._debug.unknownDirectives);
console.log('npcIds (should be empty):', c.npcIds);
(async () => {
  const mod = await import(url.pathToFileURL(path.join(root,'plugins/broadcast/index.js')).href);
  const stories = [
    {headline:'Loose Cannabis Now Cheaper Than Water in the Undermarket', body:'Officials called it "thrilling" and urged residents to keep purchasing.', byline:'The Coldwater Crier'},
    {headline:'Traffic in the Yards Achieves Sentience; Demands a Council Seat', body:'It has already filed the paperwork, which is more than most councilmen manage.', byline:'Static Weekly'},
    {headline:'The Machine Rules the Basin "Fine, Probably"; Residents Unconvinced', body:'An investigation was ruled out on the grounds of general futility.', byline:'The Daily Rust'},
    {headline:'Sinkhole in Franchise Strip Reclassified as "Feature"', body:'', byline:'x'},
    {headline:'Pigeon Elected to Neighborhood Council', body:'', byline:'x'},
    {headline:'Vending Machine Gives Child Free Soylent', body:'', byline:'x'},
  ];
  const g = mod._test.assembleNewsGraph(c.newsScript, 'bc_test', stories, 'bucket0');
  console.log('\n=== ASSEMBLED BULLETIN ===\n');
  const nodes = g.nodes; let id = g._start, seen = new Set();
  while (id && nodes[id] && !seen.has(id)) {
    seen.add(id); const nd = nodes[id];
    const type = nd.type || nd.data?.type;
    const text = nd.data?.text ?? nd.text;
    if (type === 'title_card') console.log('[TITLE CARD: ' + (nd.data?.graphic_id ?? nd.graphic_id) + ']');
    else if (type === 'say') console.log(' • ' + text);
    id = nd.next || nd.data?.next;
  }
})().catch(e => { console.error('ERR', e); process.exit(1); });
