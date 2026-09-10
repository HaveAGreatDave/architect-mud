// glsl-smoke — the shaders have no compiler on this side of the browser, so give them one rule.
//
//   node scripts/shapes/glsl-smoke.mjs
//
// ⚠ THIS EXISTS BECAUSE A SHADER THAT DOES NOT COMPILE LOOKS LIKE A SHADER THAT DRAWS BADLY.
// `createGLView` catches the throw, sets `RENDER_TUNE.gl` back to 0 and finishes the frame in 2-D —
// which is exactly right for a machine with no WebGL2 and exactly wrong as a way to find out you
// mistyped a uniform. The floor shader lost its two depth uniforms in an edit and came back as a
// green wash over ten test scenes; every one of them measured as a fidelity regression, and none of
// them said "did not compile".
//
// There is no build step here and no headless GL, so nothing between an editor and a player's GPU
// ever reads this code — the same gap `client:smoke` fills for JavaScript, one layer down. Two
// checks, both purely textual, both aimed at the one failure that is silent:
//
//   1. every uXxx / aXxx identifier a shader USES is DECLARED in that same shader
//   2. every name the JS asks for by string — getUniformLocation(prog, 'uXxx') — is declared in one
//      of that file's shaders
//
// The second is the quieter half: a missing uniform location is `null`, `gl.uniform1f(null, x)` is
// a legal no-op, and the shader simply reads zero for ever.
//
// ⚠ COMMENTS ARE STRIPPED FIRST. Shader comments name their own uniforms constantly ("the LUT is
// uMh x uMh"), and a first cut without the strip reported every one of them.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.argv[2] || 'client/game/js/panels/gl');
const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js')).sort();

// GLSL comments only — the JS around the literal keeps its own.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const problems = [];
let shaders = 0, names = 0, asks = 0;

for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  // A shader is a template literal opening with the version pragma. Nothing else in these files
  // starts that way, and the house style forbids a backtick inside a template literal, so the
  // first backtick after the pragma is the end of the source.
  const bodies = [];
  const declaredInFile = new Set();
  const re = /`#version 300 es([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(src))) {
    const body = stripComments(m[1]);
    bodies.push(body);
    shaders++;
    const declared = new Set();
    for (const d of body.matchAll(/\b(?:uniform|in|out)\s+(?:lowp|mediump|highp\s+)?\w+\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;/g)) {
      declared.add(d[1]); declaredInFile.add(d[1]); names++;
    }
    // A local may legitimately carry the prefix, so count any ordinary declaration too.
    for (const d of body.matchAll(/\b\w+\s+(u[A-Z]\w*)\s*[=;,]/g)) declared.add(d[1]);
    // Every uXxx the body mentions has to be one of them.
    // ⚠ UNIFORMS ONLY, NOT ATTRIBUTES. The aXxx prefix is the attribute convention here, but it is
    // also just a name: context.js has a local `float aTop` for the top face's alpha, and a first
    // cut flagged it and its sibling. An attribute typo is caught by the JS half below instead,
    // which is the side it would be made on.
    for (const u of body.matchAll(/\b(u[A-Z]\w*)\b/g)) {
      if (!declared.has(u[1])) problems.push(`${f}: shader uses ${u[1]}, which it never declares`);
    }
  }
  if (!bodies.length) continue;
  // …and every name the JavaScript asks the linker for by string.
  for (const q of src.matchAll(/get(?:Uniform|Attrib)Location\s*\(\s*\w+\s*,\s*'([^']+)'/g)) {
    asks++;
    if (!declaredInFile.has(q[1])) problems.push(`${f}: JS asks for '${q[1]}', which no shader in the file declares`);
  }
  // The same question through the one-letter helper these files use.
  for (const q of src.matchAll(/\bU\(\s*'([^']+)'\s*\)/g)) {
    asks++;
    if (!declaredInFile.has(q[1])) problems.push(`${f}: JS asks for '${q[1]}', which no shader in the file declares`);
  }
}

const uniq = [...new Set(problems)];
if (uniq.length) {
  console.error('\n✗ glsl-smoke — ' + uniq.length + ' undeclared name(s):');
  for (const p of uniq) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ glsl-smoke: ${shaders} shaders over ${files.length} files, ${names} declarations, ${asks} lookups — every name a shader uses and every name the JS asks for is declared.`);
