"""Hunyuan3D-2 mini, shape only: one picture in, one mesh out.

Run by generate.py with Hunyuan3D-2's own Python (its venv), never on its own:

    <hunyuan venv python> hunyuan_worker.py <image> <out_dir> [--steps 30] [--octree 256] [--seed 1234]

Writes <out_dir>/mesh.glb and <out_dir>/cond.png (the matted picture the model saw). The texture
stage is left out: it needs more than 8 GB of VRAM, and a reference only needs the shape.
Built with Tencent Hunyuan 3D 2.0 (Tencent Hunyuan Community License).
"""
import argparse
import sys
import time
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image", type=Path)
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--model", default="tencent/Hunyuan3D-2mini")
    ap.add_argument("--subfolder", default="hunyuan3d-dit-v2-mini")
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--octree", type=int, default=256, help="mesh resolution; 384 is finer and slower")
    ap.add_argument("--seed", type=int, default=1234)
    a = ap.parse_args()

    import torch
    from PIL import Image
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

    if not torch.cuda.is_available():
        sys.exit("CUDA isn't available to this Python; install the CUDA build of PyTorch")

    t0 = time.time()
    # A picture with no transparency gets its background removed; one with an alpha (a palette PNG
    # with a transparent index counts) is used as it is.
    image = Image.open(a.image).convert("RGBA")
    if image.getextrema()[3][0] == 255:
        # u2net, not rembg's default BRIA model: BRIA wants several GB of RAM on the CPU and ran out
        # on a 16 GB machine with a browser and dev servers open.
        from rembg import new_session, remove
        image = remove(image.convert("RGB"), session=new_session("u2net"), bgcolor=[255, 255, 255, 0]).convert("RGBA")
    a.out_dir.mkdir(parents=True, exist_ok=True)
    image.save(a.out_dir / "cond.png")

    # Build the model on the GPU in fp16. Left alone, it's built on the CPU in fp32 beside the 3.8 GB
    # of fp16 weights, about 11 GB of RAM, and on a 16 GB machine that crashes as an access violation
    # in a Linear's __init__ rather than a clear out-of-memory error.
    torch.set_default_dtype(torch.float16)
    with torch.device("cuda"):
        pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(a.model, subfolder=a.subfolder, use_safetensors=True)
    torch.set_default_dtype(torch.float32)
    print(f"loaded in {time.time() - t0:.0f}s", flush=True)
    mesh = pipe(
        image=image,
        num_inference_steps=a.steps,
        octree_resolution=a.octree,
        num_chunks=8000,
        generator=torch.manual_seed(a.seed),
        output_type="trimesh",
    )[0]
    mesh.export(a.out_dir / "mesh.glb")
    print(f"mesh: {len(mesh.vertices)} vertices, {len(mesh.faces)} faces, {time.time() - t0:.0f}s, "
          f"peak VRAM {torch.cuda.max_memory_allocated() / 2**30:.1f} GB", flush=True)


if __name__ == "__main__":
    main()
