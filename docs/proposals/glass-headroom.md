# GLASS frame headroom

**Status: design, not built.** The vertex-animated layers it follows from are built (actors,
birds, cloth; see [glass-notes.md](../reference/glass-notes.md#vertex-animated-layers-actors-birds-cloth)).

## Where the time goes

Measured in [glass-notes.md](../reference/glass-notes.md): a settled GL frame spends about 6.5 ms in
`world:build` and 3.8 ms in `world:arms` on the CPU, against 2.4 ms submitting (`world:gl`) and
0.7 ms occluding. `world:arms` is the model arms running every frame to collect adornments
(decals, strokes, sprites, billboards) for geometry that hasn't changed. Uploads aren't the cost;
building the records is. The worst arm is `shell_tower` at 0.52 ms a draw.

So the plan targets record building, not upload. The instanced layers already moved the animated
work to the GPU; what's left is static work repeated every frame.

## Stage 1: measure

- Run `__glWheres` (tools/modelshop/districtcost.js) at every district landmark from a cab and
  from an aircraft, with `setWindshieldProfiler(true, { arms: true })`.
- Three runs each, keeping the minimum: the first run of a cold process is wrong (glass-notes
  "District cost bench").
- Record a per-district table of `world:build`, `world:arms`, the ten dearest arms and decal counts.
  That table is the baseline every later stage is judged against.

## Stage 2: cache each building's adornment output

- Record the records an arm pushes (decal, stroke, sprite and billboard, all in world space) the first
  time a building is drawn, and replay them on later frames instead of running `drawTypeModel`.
- Key on appearance, never the camera (glass-notes "keyed on appearance"): building id, detail tier,
  LOD rung, a quantised night/light band, and the power inputs (`glPowerForCell`).
- An arm that reads `now`, the camera or `cam.unproj` (`emitDecoQuad` does) is uncacheable. Mark it,
  or split it so only its live part runs each frame. Flags, signs that flicker and anything using
  `motionOn` fall here.
- Invalidate on a tier change, a light-band change, a content change to the cell, or an LRU limit.
- Start with `shell_tower`, then the dearest arms from the stage 1 table.
- Behind `RENDER_TUNE.armCache`; 0 is today's path. A/B with a Modelshop pixel diff at every
  district: the picture must not move.

## Stage 3: retained static buffers

- Once a building's records are cached they don't change, so they don't need re-uploading. Give each
  cached building a range in its layer's stream and write it with `stream.writeRange` (it exists and
  nothing uses it) only when the cache entry changes.
- Most records carry a pixel size the caller worked out from distance (`clamp(k / f)`), which is
  the camera dependence that forces a rebuild. Move it into the vertex shader: pass `k`, `lo` and
  `hi` per record, compute the size from `clip.w`, and multiply by a `uDpr` uniform. Every size has
  to keep going through the single DPR funnel (glass-notes "DPR").
- Sprites, strokes and decals first. Clouds, billboards and ground need their alpha fades and sorts
  moved off the CPU first, and are last.
- `scripts/shapes/glstream.mjs` scans for layers uploading the old way. A retained range must pass it
  or be added to it deliberately.

## Leave alone

- **Ground buffer caching** was measured at 0.00 ms and rejected (glass-notes "Ground buffer
  caching (not done)").
- **Strokes** are about 1,500 a frame in one draw call and measured not to be a bottleneck (glass-notes
  "Truss web LOD").
- **The cloud sort** stays: the cards are translucent and need far-first order.

## More vertex animation, if there's still work

- Traffic, if cars start rebuilding geometry per frame (not checked).
- Rotors want a rotation uniform rather than a baked texture, and smoke and fire want GPU particles.
  Neither is a vertex-animation fit.
