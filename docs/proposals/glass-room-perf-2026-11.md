# GLASS and ROOM performance: where the time goes (2026-11-17)

**Status: findings only. Nothing changed.** This read the code and didn't profile it. Every item below needs a route-bench number (`__benchRoute`, gl-core.md phase 0) before and after.

## Summary

- **GLASS's GL path is already lean.** The sun and near shadows are kept, the mass buffer uploads only dirty slots, uniform locations are cached, and Lite skips occlusion and street life. What's left is small allocations, plus the two big phase 2 items (pack the vertex, cull back faces), and both of those change the picture.
- **ROOM is where the easy wins are.** It redraws the whole frame on every animation frame, even with a still camera in an empty room, and it rebuilds and re-uploads several batches a frame.

## ROOM, ranked

1. **Skip the frame when nothing changed.** `room-stage.js` `frame` → `draw` → `R.render` (about :3102) runs in full every rAF: the `watch*` functions, the outlook, every light uniform, post, depth of field and the mirror. Keep a key over the camera pose, the lamp state, the people and props batches, and a clock bucket, and skip `R.render` when the key matches. Lamps with an `fx` (strobe, sweep, beat), fire, the TV, figures that are moving and the vat have to count as changed, or they freeze. This is the biggest win on a phone, where the Stage spends most of its time standing still. Risk: medium (something freezes if a moving thing is missed).
2. **People and props are rebuilt every frame.** `drawPeople` (room-stage.js:2942) calls `figurePeople` for everyone, then `R.setFigures`. While anyone eats or holds something, or a fridge, poker table, plumbing or drip is live, it builds the props batch again and uploads it again (gl/room.js `upload`). Cache the still parts by layout and rewrite only what moves. Hoist the empty steam batch (:2992) to a constant, as `EMPTY_BATCH` already is. Risk: low.
3. **Decals go up whole on every vendor, vitals or stadium tick.** `pushDecals` (room-stage.js:1871) → `setDecals` (gl/room.js:925) filters, builds a `Set`, allocates a new `Float32Array` and rebuilds `decalRuns`. Keep one buffer, `bufferSubData` the quads that changed, and bucket the runs by kind (plain, foil, glow) here, not three times in `render`. Risk: low.
4. **`render()` allocates every frame** (gl/room.js:1009-1053): `roomMatrices` (a new `Float32Array` from `multiply`), `[...home]`, the `.slice()` calls, the `flat`, `draw` and `setLight` closures, and the `forEach`/`some` closures over the lamps. Give `core/mat4.js` a `multiply(out, a, b)` call site here and hoist the closures. Risk: none.
5. **`pushLocks`** (room-stage.js:527) allocates a new `Float32Array` while the vendor animates. Use a grow-only scratch buffer. Risk: none.
6. **The mirror** (`mirrorInView`, gl/room.js:788) allocates eight or more arrays per mirror per frame, then draws an extra scene pass. Use scratch arrays, and keep the mirror's target when neither the camera nor the figures in it moved. Risk: low.
7. **A covered Stage.** Nothing in room-*.js stops the loop when another app covers the pane, only on context loss. Stop rAF on `pane:released`, or when the host is hidden. Check first how the Stage is parked when covered. Risk: none.

## GLASS, ranked (all small)

1. **The kept upload path** (gl/context.js:1720-1765). `keptMerge` sorts the free list and allocates per run, and `keptFinish` rebuilds every slot into new objects and sorts again, on every upload with a dirty slot. That's every recentre and tile-stream frame while the camera moves, about 200 slots on a cockpit. Update the slots in place and re-sort only when one moves. `recentre-exact.mjs` and `retain-check.mjs` cover it. This one is worth doing: it lands on exactly the moving-camera frames that make the p99 (168 ms on the Marrow drive).
2. **`worldSun`** (context.js:1976) builds a new `Float32Array` and object every frame. Keep a private 16-float copy and set it only when the sun shadow is redrawn.
3. **`drawFade`** (context.js:2340) spreads the whole `opts` bag every frame.
4. **The approach and Ken views** (approach.js:217-235, arena-ken.js:307-358) build uniform arrays per draw. Use module scratch arrays.
5. **`lampshadow.js:71`** sorts its candidates every lamp pass. Check whether the pass is kept.

### The two big phase 2 items

- **Pack the mass vertex (item 3): feasible and contained.** `STRIDE = 25` floats (context.js:51). One layout function (`massLayout`, :1609) and one writer (`packGroup`, ~:1560). Lite bakes go through `packGroup` too, so the bake format doesn't change. Keep pos and uv float32. The edge distances use 1e6 sentinels, so they can't be unorm. `K.data` and the `bufferSubData` offsets need a byte-based buffer, and `massDebug` and `recentre-exact.mjs` read stride 25. Oct normals and unorm8 colour shift shading by one quantisation step. That halves upload and memory, which matters most on phones.
- **Back-face culling (item 7): not cheap.** Culling is off on purpose (context.js:1994: soffits and canopy undersides) and off again in shadow.js, lampshadow.js, propshadow.js, ground.js and strokes.js. It needs a "closed" flag per group from the arms through `SHAPE_SINK`, a separate draw run (which splits the multi-draw), and a winding check on every arm. Leave it until packing has landed and been measured.

## Unification

**Do the small shared pieces; don't build the one GL host yet.** gl-core.md phase 6 already concluded that one host saves memory and compiles, not frame time. Nothing in this pass changes that. The duplication that costs something:

- **`core/program.js`.** The `prog` plus cached-uniform helper is written twice inside ROOM alone (gl/room.js:526, gl/room-post.js:106), and 13 `gl.createShader` copies are left (core-baseline.json). This is the next phase 1 module, and it also gives every renderer the warm compile `programs.js` already does for GLASS.
- **`core/camera.js`.** ROOM's `roomView`/`roomProj` and the probe bake's inline look-at (gl/room.js:465, :842) repeat what GLASS's camera does. One `lookAt`/`perspective` that writes into `out` serves both, and fixes ROOM item 4 at the same time.
- **The frustum and bounds test** in ROOM's mirror (gl/room.js:797-812) is generic and belongs beside it.
- **`core/target.js` and `core/lost.js`** are still worth doing: 75 `TEXTURE_MIN_FILTER` and 7 context-loss listeners remain. They're cleanup, not speed.

## Suggested order

1. ROOM 4, 5 and 6 (no picture change), with `core/camera.js` from the unification list.
2. GLASS 1 (the kept upload path), measured on `perf:move` and a moving route.
3. ROOM 1 (skip unchanged frames), behind a `RENDER_TUNE`-style switch so it can be turned off, measured on a phone.
4. ROOM 2 and 3.
5. `core/program.js`.
6. Pack the mass vertex.

Nothing here was done in this pass because `gl/room.js`, `room-stage.js` and `gl/context.js` all carry other sessions' uncommitted work.
