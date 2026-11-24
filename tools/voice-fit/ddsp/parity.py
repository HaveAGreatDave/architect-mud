"""parity.py: how close the twin is to the real worklet, on export.mjs's lines.

  <venv python> tools/voice-fit/ddsp/parity.py <export dir> [--wav <dir>]

Log-mel distance (80 bands to 8 kHz, 25 ms frames, dB, mean absolute, frames within 50 dB
of the line's loudest) between the twin and the worklet on the same tracks, per line and
overall, after matching overall level. The bar is the same distance between the worklet
and the twin with its noise reseeded: noise alone moves a log spectrum a few dB.
"""
import json, sys
from pathlib import Path
import numpy as np
import torch
sys.path.insert(0, str(Path(__file__).parent))
import twin

SR = 48000


def logmel(x):
    X = torch.stft(torch.tensor(x, dtype=torch.float32), 1200, 240, window=torch.hann_window(1200), return_complex=True).abs() ** 2
    f = np.fft.rfftfreq(1200, 1 / SR)
    mel = lambda h: 2595 * np.log10(1 + h / 700)
    edges = np.interp(np.linspace(mel(60), mel(8000), 82), mel(f), f)
    fb = np.zeros((80, len(f)))
    for i in range(80):
        lo, c, hi = edges[i:i + 3]
        fb[i] = np.clip(np.minimum((f - lo) / (c - lo), (hi - f) / (hi - c)), 0, None)
    M = torch.tensor(fb, dtype=torch.float32) @ X
    return 10 * torch.log10(M + 1e-10).numpy()


def dist(a, b):
    n = min(len(a), len(b))
    A, B = logmel(a[:n]), logmel(b[:n])
    loud = A.max(0) > A.max() - 50
    off = np.median((A - B)[:, loud])
    return float(np.abs(A - B - off)[:, loud].mean())


def main():
    d = Path(sys.argv[1])
    out = Path(sys.argv[sys.argv.index('--wav') + 1]) if '--wav' in sys.argv else None
    idx = json.load(open(d / 'index.json'))
    rows = []
    for lid, L in idx['lines'].items():
        tr = torch.tensor(np.fromfile(d / f'{lid}.f32', dtype=np.float32).reshape(L['frames'], -1))
        ref = np.fromfile(d / f'{lid}.raw', dtype=np.float32)
        y0 = twin.render(tr, L['k'], presence_db=idx['presenceDb'], seed=1).numpy()
        y1 = twin.render(tr, L['k'], presence_db=idx['presenceDb'], seed=2).numpy()
        rows.append((dist(ref, y0), dist(y1, y0), L['text']))
        if out:
            import wave
            out.mkdir(parents=True, exist_ok=True)
            for name, s in (('worklet', ref), ('twin', y0)):
                s = s / (np.abs(s).max() + 1e-9) * 0.89
                with wave.open(str(out / f'{lid}-{name}.wav'), 'wb') as w:
                    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
                    w.writeframes((s * 32767).astype(np.int16).tobytes())
    for a, b, t in rows:
        print(f'{a:5.2f} dB  (noise {b:4.2f})  {t[:60]}')
    print(f'mean {np.mean([r[0] for r in rows]):.2f} dB against the worklet; reseeding the noise alone moves it {np.mean([r[1] for r in rows]):.2f} dB')


if __name__ == '__main__':
    main()
