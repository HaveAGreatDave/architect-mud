// Shader prewarm: every program a scene will need, compiled side by side when its context is made.
//
// Each layer builds its program lazily, the first time it draws, and asks for LINK_STATUS straight
// away. A status query waits for that compile, so twenty-odd programs compiled one after another
// inside the first frame, and that frame took seconds. With KHR_parallel_shader_compile the driver
// compiles on worker threads, and nothing waits until a status is asked for. So:
//
//   1. A layer declares its sources at module load: `declareProgram(VERT, FRAG)`.
//   2. `createGLView` calls `prewarmPrograms(gl)` on a new context, which compiles and links every
//      declared program and asks nothing.
//   3. The layer's builder calls `takeWarm(gl, VERT, FRAG)` first. It gets the prewarmed program
//      (done by then, or nearly) and asks LINK_STATUS as it always did. No warm program, it builds
//      its own exactly as before.
//
// ⚠ ONLY WITH THE EXTENSION. Without it the compiles run in submission order in the GPU process,
// and prewarming programs this frame doesn't use would queue them AHEAD of the ones it does.
//
// ⚠ A PROGRAM THAT BINDS ATTRIBUTE LOCATIONS before linking declares them in `bind`, because they
// are part of the link. One whose binding is only known at runtime (the shadow and SSAO depth
// programs take the main program's `aPos`) isn't declared and builds cold.

const DECLARED = new Map();          // key → { vs, fs, bind }
const WARM = new WeakMap();          // gl → Map(key → WebGLProgram)

const keyOf = (vs, fs, bind) => vs + '\u0000' + fs + '\u0000' + (bind ? JSON.stringify(bind) : '');

export function declareProgram(vs, fs, bind = null) {
  DECLARED.set(keyOf(vs, fs, bind), { vs, fs, bind });
}

export function prewarmPrograms(gl) {
  if (!gl || WARM.has(gl) || !gl.getExtension('KHR_parallel_shader_compile')) return 0;
  const warm = new Map();
  WARM.set(gl, warm);
  for (const [key, { vs, fs, bind }] of DECLARED) {
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      gl.attachShader(prog, sh);
      gl.deleteShader(sh);   // flagged; freed with the program
    }
    if (bind) for (const [i, name] of bind) gl.bindAttribLocation(prog, i, name);
    gl.linkProgram(prog);
    warm.set(key, prog);
  }
  return warm.size;
}

// The prewarmed program for these sources, once. Null when there isn't one.
export function takeWarm(gl, vs, fs, bind = null) {
  const warm = WARM.get(gl);
  if (!warm) return null;
  const key = keyOf(vs, fs, bind);
  const prog = warm.get(key);
  if (!prog) return null;
  warm.delete(key);
  return prog;
}
