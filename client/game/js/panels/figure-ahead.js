// CLOSE-UP FIGURES, ASKED FOR AHEAD AND BUILT IN A WORKER (figure-worker.js).
//
// `figureAhead(key)` says whether a figure (figure.js buildFigure's key) is ready to draw. If it isn't, it's
// queued for the worker and this says no; the caller draws something else meanwhile (the street draws the crowd's
// body, gl/street-hd.js). One build at a time, in the order asked.
//
// ⚠ NO WORKER, NO WAIT. In Node (the gates) or inside a worker (the room's window view, room-outlook.js), the
// figure is built here and now, as it always was, and the answer is yes. A worker that fails does the same from
// then on, so a broken worker costs the old hitch and never a street with nobody close up.
import { buildFigure, figureBuilt, figureAdopt, figureKey } from './figure.js';

let worker = null;            // null not started, false none (or it failed)
const queue = [];             // [{ k, key }] waiting, nearest-asked first
const asked = new Set();      // figureKeys queued or building
let busy = null, seq = 0;

function start() {
  if (worker !== null) return worker;
  try {
    if (typeof Worker !== 'function' || typeof document === 'undefined') return (worker = false);
    const w = new Worker(new URL('./figure-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => {
      const job = busy;
      if (!job || data.id !== job.id) return;
      busy = null;
      if (data.F) figureAdopt(job.key, data.F);
      else console.warn('[figure-ahead] the worker could not build a figure; building it here:', data.error);
      asked.delete(job.k);
      pump();
    };
    w.onerror = (e) => { console.warn('[figure-ahead] worker off, building on the page:', e?.message); worker = false; w.terminate(); busy = null; queue.length = 0; asked.clear(); };
    return (worker = w);
  } catch { return (worker = false); }
}
function pump() {
  if (busy || !worker || !queue.length) return;
  const job = queue.shift();
  if (figureBuilt(job.key)) { asked.delete(job.k); return pump(); }
  busy = { ...job, id: ++seq };
  try { worker.postMessage({ id: busy.id, key: job.key }); }
  catch (e) { console.warn('[figure-ahead] a key would not post; building it here:', e?.message); busy = null; asked.delete(job.k); buildFigure(job.key); pump(); }
}

export function figureAhead(key) {
  if (figureBuilt(key)) return true;
  if (!start()) { buildFigure(key); return true; }
  const k = figureKey(key);
  if (!asked.has(k)) { asked.add(k); queue.push({ k, key }); pump(); }
  return false;
}
// What's waiting, for a bench: queued, and whether one is building.
export const figureAheadStats = () => ({ queued: queue.length, busy: !!busy, worker: worker === null ? 'idle' : worker ? 'on' : 'off' });
