// THE PARK'S FANS, BAKED OFF THE MAIN THREAD.
//
// The crowd's figure (ballpark-mesh.js crowdMorph: the street's body in three poses) is half a second
// of work in one block. The park's warm-up (gl/ballpark.js warmBallpark) runs it here while the game's
// open plays, where it can't stall the theme, and seeds the result into the page's cache
// (seedCrowdMorph), so building the park doesn't make it again. One bake, then the page ends this.
import { crowdMorph } from './ballpark-mesh.js';

self.onmessage = (e) => {
  const towels = !!(e.data && e.data.towels);
  const out = crowdMorph({ towels });
  self.postMessage({ towels, out }, [out.buffer]);
};
