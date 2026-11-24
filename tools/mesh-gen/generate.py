#!/usr/bin/env python3
"""Turn a picture into a Modelshop mesh reference.

    python generate.py <image> --name <ref-name> [--engine hunyuan|lato] [--force]

Two engines:

    hunyuan  Hunyuan3D-2 mini, shape only (the default). Runs on Windows in its own venv, about
             6 GB of VRAM. Set up in ~/Hunyuan3D-2; see README.md.
    lato     LATO.2. Linux only (WSL2 on Windows), with its `lato2` conda env active.

Either way the result is filed where the Modelshop's Reference page looks for it:

    tools/mesh-gen/out/<ref-name>/mesh.glb or mesh.obj   the generated mesh
    tools/mesh-gen/out/<ref-name>/source.<ext>          the picture it came from
    tools/mesh-gen/out/<ref-name>/cond.png              the matted picture the model saw
    tools/mesh-gen/out/<ref-name>/meta.json             engine, settings, date

Standard library only, so any Python 3.8+ runs it. A reference is never a game asset; see
docs/proposals/mesh-reference-pipeline.md.
"""
import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
HOME = Path.home()


def hunyuan_python():
    win = HOME / "Hunyuan3D-2" / ".venv" / "Scripts" / "python.exe"
    return win if win.exists() else HOME / "Hunyuan3D-2" / ".venv" / "bin" / "python"


def run_hunyuan(a, work):
    py = Path(a.python) if a.python else hunyuan_python()
    if not py.exists():
        sys.exit(f"Hunyuan3D-2's Python not found at {py}; set it up per README.md or pass --python")
    cmd = [str(py), str(HERE / "hunyuan_worker.py"), str(a.image), str(work),
           "--steps", str(a.steps), "--octree", str(a.octree), "--seed", str(a.seed)]
    print("running:", " ".join(cmd), flush=True)
    # Run from the checkout so hy3dgen imports; keep the weights in the usual Hugging Face cache.
    r = subprocess.run(cmd, cwd=str(HOME / "Hunyuan3D-2"), env={**os.environ, "PYTHONUTF8": "1"})
    if r.returncode != 0:
        sys.exit(f"Hunyuan3D-2 exited {r.returncode}")
    return work / "mesh.glb", work / "cond.png", {"model": "Hunyuan3D-2 mini (shape only)", "steps": a.steps,
                                                  "octree": a.octree, "seed": a.seed}


def run_lato(a, work):
    lato = Path(a.lato) if a.lato else HOME / "LATO.2"
    script = lato / "scripts" / "image_e2e_inference.py"
    if not script.is_file():
        sys.exit(f"LATO.2 not found at {lato} (looked for {script}); pass --lato")
    src_dir, run_dir = work / "in", work / "run"
    src_dir.mkdir()
    # LATO.2 reads a directory of pictures and names its outputs after each one.
    shutil.copy(a.image, src_dir / ("ref" + a.image.suffix.lower()))
    cmd = [a.python or sys.executable, str(script), "--image_dir", str(src_dir), "--out_dir", str(run_dir),
           "--vert_num", str(a.verts)]
    print("running:", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, cwd=lato)
    if r.returncode != 0:
        sys.exit(f"LATO.2 exited {r.returncode}")
    found = [p for p in sorted(run_dir.rglob("*_pred.obj")) if "_coords" not in p.name]
    if not found:
        sys.exit(f"LATO.2 wrote no *_pred.obj under {run_dir}")
    cond = sorted(run_dir.rglob("*_cond.png"))
    return found[0], (cond[0] if cond else None), {"model": "LATO.2", "vert_num": a.verts}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", type=Path, help="the picture: one object, plain background is best")
    ap.add_argument("--name", required=True, help="the reference's name: letters, digits, - and _")
    ap.add_argument("--engine", choices=["hunyuan", "lato"], default="hunyuan")
    ap.add_argument("--python", help="the engine's Python (default: Hunyuan's venv, or this Python for LATO.2)")
    ap.add_argument("--force", action="store_true", help="replace a reference of the same name")
    ap.add_argument("--steps", type=int, default=30, help="hunyuan: diffusion steps")
    ap.add_argument("--octree", type=int, default=256, help="hunyuan: mesh resolution (384 is finer and slower)")
    ap.add_argument("--seed", type=int, default=1234, help="hunyuan: seed")
    ap.add_argument("--lato", help="lato: the LATO.2 checkout (default ~/LATO.2)")
    ap.add_argument("--verts", type=int, default=2000, help="lato: target vertex count")
    a = ap.parse_args()

    if not a.name.replace("-", "").replace("_", "").isalnum():
        sys.exit("--name takes letters, digits, - and _ only")
    a.image = a.image.resolve()
    if not a.image.is_file():
        sys.exit(f"no such picture: {a.image}")
    dest = OUT / a.name
    if dest.exists() and not a.force:
        sys.exit(f"{dest} exists; pass --force to replace it")

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        mesh, cond, meta = (run_hunyuan if a.engine == "hunyuan" else run_lato)(a, work)
        if not mesh.is_file():
            sys.exit(f"the engine wrote no mesh ({mesh})")
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        shutil.copy(mesh, dest / ("mesh" + mesh.suffix.lower()))
        if cond and cond.is_file():
            shutil.copy(cond, dest / "cond.png")
        shutil.copy(a.image, dest / ("source" + a.image.suffix.lower()))

    meta.update({"source": a.image.name, "made": datetime.datetime.now().isoformat(timespec="seconds")})
    (dest / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {dest}; open the Modelshop's Reference page (/mesh-ref.html?ref={a.name})")


if __name__ == "__main__":
    main()
