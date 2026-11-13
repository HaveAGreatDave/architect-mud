// Shader prewarm: every program a scene will need, compiled side by side when its context is made.
//
// Each layer builds its program lazily, the first time it draws, and asks for LINK_STATUS straight
// away. A status query waits for that compile, so twenty-odd programs compiled one after another
// inside the first frame, and that frame took seconds. With KHR_parallel_shader_compile the driver
// compiles on worker threads, and nothing waits until a status is asked for. So:
//
//   1. A layer declares its sources at module load: `declareProgram(VERT, FRAG)`, with the scenes
//      that draw it (`{ scenes: ['park'] }`; GLASS's own, 'glass', when it names none).
//   2. A scene's renderer calls `prewarmPrograms(gl, scene)` on a new context (`createGLView` for
//      'glass', and the park, the rink and the room for theirs), which compiles and links every
//      program declared for that scene and asks nothing.
//   3. The layer's builder calls `takeWarm(gl, VERT, FRAG)` first. It gets the prewarmed program
//      (done by then, or nearly) and asks LINK_STATUS as it always did. No warm program, it builds
//      its own exactly as before.
//
// ⚠ ONLY WITH THE EXTENSION. Without it the compiles run in submission order in the GPU process,
// and prewarming programs this frame doesn't use would queue them AHEAD of the ones it does.
//
// ⚠ ONLY THE SCENE'S OWN. Every module that's loaded declares into the one list, so before scenes
// the park, opened after a room or with the rink loaded beside it, compiled the room's figure (a
// 114k-character shader, over a minute through Direct3D's compiler with a cold cache) in a context
// that never draws it. A program two scenes draw names both.
//
// ⚠ A PROGRAM THAT BINDS ATTRIBUTE LOCATIONS before linking declares them in `bind`, because they
// are part of the link. One whose binding is only known at runtime (the shadow and SSAO depth
// programs take the main program's `aPos`) isn't declared and builds cold.

const DECLARED = new Map();          // key → { vs, fs, bind, scenes: Set, late }
const WARM = new WeakMap();          // gl → Map(key → WebGLProgram)

const keyOf = (vs, fs, bind) => vs + '\u0000' + fs + '\u0000' + (bind ? JSON.stringify(bind) : '');

// `scenes` are the scenes that draw it. `late` puts it after the scene's other programs, for a huge
// one that's polled rather than waited on (layerProgramAsync), so it never holds up one that is.
// The same sources declared by two modules are prewarmed in both modules' scenes.
export function declareProgram(vs, fs, bind = null, { scenes = ['glass'], late = false } = {}) {
  const key = keyOf(vs, fs, bind), had = DECLARED.get(key);
  if (had) { for (const s of scenes) had.scenes.add(s); had.late = had.late && late; return; }
  DECLARED.set(key, { vs, fs, bind, scenes: new Set(scenes), late });
}

export function prewarmPrograms(gl, scene = 'glass') {
  if (!gl || WARM.has(gl) || !gl.getExtension('KHR_parallel_shader_compile')) return 0;
  const warm = new Map();
  WARM.set(gl, warm);
  const mine = [...DECLARED].filter(([, d]) => d.scenes.has(scene));
  for (const [key, { vs, fs, bind }] of [...mine.filter(([, d]) => !d.late), ...mine.filter(([, d]) => d.late)]) {
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

// True once every program prewarmed on `gl` and not yet taken has finished compiling, so a scene can
// build without its first LINK_STATUS query holding the page; true at once without the extension or
// with nothing prewarmed, where there's nothing to wait for.
export function prewarmDone(gl) {
  const warm = WARM.get(gl), ext = warm && gl.getExtension('KHR_parallel_shader_compile');
  if (!ext || gl.isContextLost()) return true;
  for (const prog of warm.values()) if (!gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR)) return false;
  return true;
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

// One shader, compiled. Throws with the driver's log, prefixed by `label`.
export function compileShader(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ': ' + log);
  }
  return sh;
}

// A layer's program: the prewarmed one when there is one, built here otherwise. Throws on a failed
// compile or link, naming `label`, which is what every layer's fallback to 2-D catches.
export function layerProgram(gl, vs, fs, label, bind = null) {
  let prog = takeWarm(gl, vs, fs, bind);
  if (!prog) {
    prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vs, label + ' vertex'));
    gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fs, label + ' fragment'));
    if (bind) for (const [i, name] of bind) gl.bindAttribLocation(prog, i, name);
    gl.linkProgram(prog);
  }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(label + ' link: ' + gl.getProgramInfoLog(prog));
  return prog;
}

// A layer's program that never makes the caller wait. `ready()` is false while the driver is still
// compiling (KHR_parallel_shader_compile's COMPLETION_STATUS), then true once linked, after which `p` is
// the program; a failed link logs once and stays not ready. Without the extension it links as
// layerProgram does, at the first `ready()`.
// ⚠ FOR A HUGE SHADER. The close-up figure's fragment shader is ~114k characters: asking LINK_STATUS at
// once froze the page 2.4 s on every Room Stage open, and over a minute the first time after it changed
// (an empty driver cache), which players saw as the room crashing.
export function layerProgramAsync(gl, vs, fs, label, bind = null) {
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  let prog = takeWarm(gl, vs, fs, bind), state = 0;   // 0 compiling, 1 ready, -1 failed
  if (!prog) {
    prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      gl.attachShader(prog, sh);
      gl.deleteShader(sh);
    }
    if (bind) for (const [i, name] of bind) gl.bindAttribLocation(prog, i, name);
    gl.linkProgram(prog);
  }
  return {
    get p() { return prog; },
    ready() {
      if (state) return state > 0;
      if (ext && !gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR)) return false;
      if (gl.getProgramParameter(prog, gl.LINK_STATUS)) { state = 1; return true; }
      if (!gl.isContextLost()) console.warn('[gl] ' + label + ' link:', gl.getProgramInfoLog(prog));
      state = -1;
      return false;
    },
  };
}
