# mesh-gen

**STATUS: BUILT (phase 1 of [mesh-reference-pipeline.md](../../docs/proposals/mesh-reference-pipeline.md)).**

Turns a picture into a mesh reference for the Modelshop's Reference page (`/mesh-ref.html`). A reference is something to trace while writing an arm, a concept script or a generator's numbers. It never ships in the game.

```bash
python tools/mesh-gen/generate.py photo.png --name corner-shop
```

That writes `out/corner-shop/` with the mesh, the source picture, the matted picture the model saw (`cond.png`) and `meta.json`, and the Reference page lists it straight away. `out/` is ignored by git. A picture of one object on a plain background works best; the background is removed for you. Any other generator's `.glb` or `.obj` works too: put it in a folder under `out/`, or open, drop or paste it on the Reference page.

Use only your own concept art or CC0 pictures: a reference is only as clean as its source.

## Engines

### Hunyuan3D-2 mini (the default)

Tencent's image-to-shape model, shape stage only. Runs on Windows in about 4 GB of VRAM, so an 8 GB card such as a 2070 Super is enough. The texture stage is left out: it needs more memory and a reference only needs the shape.

Set up once, outside the repo:

```bash
git clone --depth 1 https://github.com/Tencent/Hunyuan3D-2.git ~/Hunyuan3D-2
```

```bash
cd ~/Hunyuan3D-2 && python -m venv .venv
```

Then, in that venv, install the CUDA build of PyTorch (`pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124`), the packages `diffusers==0.32.2 transformers==4.49.0 einops opencv-python numpy omegaconf tqdm trimesh pymeshlab pygltflib accelerate rembg onnxruntime`, and the checkout itself with `pip install --no-deps -e .`.

Keep those two pins. `transformers` 5 renamed DINOv2's attention layers, so the weights no longer load, and the newest `diffusers` needs a `huggingface_hub` that `transformers` 4.49 won't take.

The weights (`tencent/Hunyuan3D-2mini`, about 7.6 GB) and the `u2net` background remover download into the caches on the first run. On a slow line that takes hours; after it, a picture takes about 30 seconds on a 2070 Super and peaks at 4.1 GB of VRAM.

The worker builds the model on the GPU in fp16. Built on the CPU in fp32, as the library does by default, it needs about 11 GB of RAM and crashes a 16 GB machine with an access violation.

`generate.py` finds the venv at `~/Hunyuan3D-2/.venv` and runs `hunyuan_worker.py` with it. `--octree 384` gives a finer mesh and takes longer; `--seed` gives another try at the same picture.

Licence: the Tencent Hunyuan Community License. It doesn't apply in the EU, the UK or South Korea, and a product with over a million monthly users needs Tencent's own licence. Built with Tencent Hunyuan 3D 2.0.

### LATO.2 (`--engine lato`)

Cleaner, artist-like topology, but Linux only: its setup is a bash script that builds CUDA extensions, so on Windows it runs in WSL2. Its README says it needs about 8 GB of VRAM.

```bash
git clone https://github.com/LoHhhha/LATO.2.git ~/LATO.2
cd ~/LATO.2 && . ./setup.sh --all
python scripts/ckpt_download.py
```

Then, with `conda activate lato2`, run `generate.py --engine lato` from WSL. MIT licence.
