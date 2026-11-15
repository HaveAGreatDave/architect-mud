// THE STANDS' FANS, BAKED OFF THE MAIN THREAD.
//
// gl/fan-vat.js's bake is a second or so of work (the sculpted figure built and cut down twice, then
// every clip skinned), so the park and the rink ask for it here (fanBakeAsync) and draw their fans as
// cards, or not at all, until it's back. Both levels, then the page ends this.
import { fanBake } from './fan-vat.js';

self.onmessage = () => {
  const out = ['far', 'near'].map((lv) => fanBake(lv));
  self.postMessage({ bakes: out }, out.flatMap((b) => [b.data.buffer, b.stat.buffer, b.idx.buffer]));
};
