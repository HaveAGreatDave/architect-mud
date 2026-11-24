# Mesh reference pipeline

**Status: phase 1 built (the runner and the Modelshop's Reference page); phases 2 and 3 are design.**

Image-to-mesh models such as LATO.2 turn a picture into a mesh. GLASS models are code, and people and animals are numbers over a generator, so a generated mesh can't go into the game as it is. This plan uses those models in three ways that keep the procedural approach:

1. As a **reference** to trace while writing a model by hand.
2. As the source of a few **hero props** (one-off statues, wrecks, ornaments), converted to mesh JSON the way vehicles already are.
3. As a **fitting target** for a generator's numbers (a cat breed, a figure, a building's massing).

Buildings and people stay procedural. A mesh never becomes a building.

## Phase 1: references (built)

- **`tools/mesh-gen/generate.py`** runs LATO.2's `image_e2e_inference.py` on one picture and files the result under `tools/mesh-gen/out/<name>/`: `mesh.obj`, the source picture, the matted picture LATO.2 saw, and `meta.json`. It's standard-library Python run inside LATO.2's own env, in WSL2 on Windows. `out/` is ignored by git. [Its README](../../tools/mesh-gen/README.md) covers setup.
- **The Reference page** (`/mesh-ref.html` in the Modelshop, `tools/modelshop/mesh-ref.js`) lists those folders through `/api/mesh-refs`, reads GLB or OBJ, and draws the mesh beside its source picture. Pick a GLASS model and the reference is fitted to its height and footprint centre and drawn see-through over it (Ghost), beside it (Side) or alone. Sliders set scale, turn and offset. A `.glb`, `.obj` or picture dropped on the page loads without the runner, so any other generator's output works too.
- The page has its own small WebGL2 pass. The reference is arbitrary triangles in y-up metres and the editor's viewport is GLASS's 2-D camera, so both are put into one z-up frame and drawn by one shader.

LATO.2 says it needs about 8 GB of VRAM, which is the whole of an 8 GB card. Close anything else using the GPU, and lower `--verts` if it runs out.

## Phase 2: hero props as mesh JSON (design)

- `scripts/shapes/import-mesh.mjs` takes a reference, cleans and decimates it to a triangle budget, bands its colours to the palette for the comic ink, and writes the same mesh JSON the vehicles use.
- It also writes a simple hull (a few boxes or prisms) into `SHAPE_SINK`, so the prop gets collision, occlusion and LOD and the Lite bake picks it up.
- Props go through the vehicles' gates (`meshes.mjs` holds them exact, `shapes:smoke` runs them), with a size and triangle budget each.
- A prop stands on a tile or in a model. A building is never a mesh.

## Phase 3: fitting a generator's numbers (design)

Change a generator's numbers until its shape matches the reference, and write the numbers, not the mesh.

- **Cats first.** Fit `CAT` (`gl/cat-kit.js`) to a reference and write a draft row for `gl/cat-breeds.js`. The kit is small and well defined, so it's the easiest case to check.
- **People.** Fit `figure.js`'s proportions and a choice of clothes and hair to a portrait.
- **Building massing.** Fit floors, setbacks, roofline and window spacing as `fh`/`h` fractions into a draft arm skeleton. Lettering, doorways (`markDoorway`) and the street door stay hand work.

## Rules

- A reference is a tool input. It never ships, and nothing in `client/` reads `tools/mesh-gen/out/`.
- Use your own concept art or CC0 pictures. A reference is only as clean as its source.
- LATO.2 is MIT-licensed. Any other model used must allow this use.
