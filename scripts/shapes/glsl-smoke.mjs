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
  // ⚠ A NAME THE JS SUBSTITUTES OUT IS NOT AN IDENTIFIER THE COMPILER EVER SEES. Three shaders
  // size an array from a JS constant the only way GLSL ES allows — `src.split('SSAO_TAPS')
  // .join(String(SSAO_TAPS))` — so the token is gone before `shaderSource` is called. Read off
  // the substitution itself rather than from a list, or the list is a second copy of it.
  const substituted = [...src.matchAll(/\.split\(\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\)/g)].map((m0) => m0[1]);
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
    // ── ⚠ AND A SCREAMING_CAPS NAME, WHICH IS HOW A JS CONSTANT LEAKS INTO GLSL ──────────────
    // A tuning number lives as a module const beside the shader and then gets spelled into the
    // source as a bare identifier. That is not a wrong number, it is a COMPILE failure, and the
    // throw takes the whole GL world pass down with it: the city falls back to 2-D mid-frame, so
    // terrain comes out the wrong biome and a massif keeps its hairlines and loses its faces.
    // SNOW_REACH and SNOW_GAIN shipped that way in billboards.js and neither rule above could
    // see it — neither is a uXxx, and neither is a name the JS asks the linker for by string.
    // ⚠ INTERPOLATIONS ARE CUT FIRST. ${HEIGHT_FOG_GLSL} is JavaScript, resolved before the
    // string ever reaches a compiler, so the name inside it is not a GLSL identifier at all — a
    // first cut without the cut reported every injected snippet in the directory.
    const bare = body.replace(/\$\{[^}]*\}/g, ' ');
    const capsOk = new Set(substituted);
    for (const d of bare.matchAll(/#define\s+([A-Z_][A-Z0-9_]*)/g)) capsOk.add(d[1]);
    // ⚠ EVERY DECLARATOR, NOT JUST THE FIRST. `const float GE_WARP = 80.0, GE_WARP_F = 0.0055;`
    // declares two names and a regex that stops at the first one invents a finding about the
    // second — the same multi-declarator trap `imports:smoke` records against its own scanner.
    for (const d of bare.matchAll(/\b(?:const\s+)?(?:float|int|uint|bool|[iub]?vec[234]|mat[234])\s+([^;{}]*);/g)) {
      for (const part of d[1].split(',')) {
        const m2 = /^\s*([A-Za-z_]\w*)/.exec(part);
        if (m2 && /^[A-Z_][A-Z0-9_]*$/.test(m2[1])) capsOk.add(m2[1]);
      }
    }
    for (const u of bare.matchAll(/\b([A-Z][A-Z0-9]*_[A-Z0-9_]*)\b/g)) {
      if (!capsOk.has(u[1])) problems.push(`${f}: shader uses ${u[1]}, which it never declares — a JS const is not a GLSL one`);
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
