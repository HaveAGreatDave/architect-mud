const fs=require('fs');let src=fs.readFileSync('scratch.cjs','utf8');
src=src.replace(/  \[`  const key = \`\\$\{voidKey\}\|\\$\{window\}\`;[\s\S]*?const dests = near \? destsFromGate\(voidKey, near\.x, near\.y, all\) : all;`\],\n/, `  [\`  const key = \\`\\${voidKey}|\\${window}\\`;\`, \`  const gate0 = near ? nearestGate(voidKey, near.x, near.y) : null;
  const key = \\`\\${voidKey}|\\${window}|\\${gate0?.id || ''}\\`;\`],
  [\`  const v = VOIDS[voidKey], gate = regionGates(voidKey)[0];
  let route = null;\`, \`  const v = VOIDS[voidKey], gate = gate0 || regionGates(voidKey)[0];
  let route = null;\`],
  [\`  const dests = destsFor(voidKey, null);
  if (dests.length) {
    const d = dests[0];\`, \`  const all = destsFor(voidKey, null);
  const dests = near ? destsFromGate(voidKey, near.x, near.y, all) : all;
  if (dests.length) {
    const d = dests[0];\`],
`);
fs.writeFileSync('scratch.cjs',src);
