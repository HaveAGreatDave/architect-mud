"""evaluate.py: the controller through the REAL worklet, on the held-out lines.

  <venv python> tools/voice-fit/ddsp/evaluate.py <run dir> [<demo.wav>]

For each held-out line, the rule tracks on the speaker's timing and the same with the
controller's corrections are written out and played by play.mjs (the worklet itself, not
the twin). Each is measured against the recording: envelope distance (40 mel bands, the
line's level matched, no channel filter) and median F0 error in cents. With a demo path,
writes one file: the speaker, then the rules, then the controller, for every line.
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np
import torch
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import train, data, twin

run = Path(sys.argv[1])
vf = HERE.parent
ck = torch.load(run / 'controller.pt', weights_only=False)
items = data.load(vf / 'out/nn/r3', vf / 'out/nn/align3.json', 'C:/Users/david/Desktop/part3.wav')
test = items[::10]
net = train.FrameHead(ck['nin']); net.load_state_dict(ck['frame']); net.eval()
jobs = []
for it in test:
    x = torch.tensor(train.features(it, ck['PH']))[None]
    with torch.no_grad():
        corr = train.apply(torch.tensor(it['tracks']), net(x)[0]).numpy().astype(np.float32)
    for tag, tr in (('rules', it['tracks']), ('nn', corr)):
        f = run / f"{it['id']}-{tag}.f32"
        tr.astype(np.float32).tofile(f)
        jobs.append({'f32': str(f), 'frames': len(tr), 'frame': it['frame'], 'k': it['k'], 'names': it['names'], 'po': it['po'], 'out': str(run / f"{it['id']}-{tag}.raw")})
json.dump(jobs, open(run / 'jobs.json', 'w'))
subprocess.run(['node', str(HERE / 'play.mjs'), str(run / 'jobs.json')], check=True)


def env(y):
    return train.logmel(torch.tensor(y, dtype=torch.float32), 2048).numpy()


def envdist(y, ref):
    n = min(len(y), len(ref))
    A, B = env(y[:n]), env(ref[:n])
    lv = B.mean(0); loud = lv > lv.max() - 7
    off = np.median((B - A)[:, loud])
    return float(np.abs(A + off - B)[:, loud].mean()) * 10 / np.log(10)   # dB


def f0err(y, it):
    p = data.pitch(y.astype(np.float64), data.SR, it['frame'], len(it['tracks']))
    s = it['f0spk'][:len(p)]
    ok = (p > 0) & (s > 0)
    return float(np.median(np.abs(1200 * np.log2(p[ok] / s[ok])))) if ok.sum() > 5 else float('nan')


rows, demo = [], []
gap = np.zeros(int(0.5 * data.SR), np.float32)
for it in test:
    r = np.fromfile(run / f"{it['id']}-rules.raw", dtype=np.float32)
    c = np.fromfile(run / f"{it['id']}-nn.raw", dtype=np.float32)
    rows.append((envdist(r, it['audio']), envdist(c, it['audio']), f0err(r, it), f0err(c, it), it['text']))
    for s in (it['audio'], r, c):
        demo += [s / (np.abs(s).max() + 1e-9) * 0.8, gap]
    demo.append(gap)
print('envelope dB (rules -> controller)   F0 cents (rules -> controller)')
for a, b, fa, fb, t in rows:
    print(f'{a:5.2f} -> {b:5.2f}        {fa:5.0f} -> {fb:5.0f}     {t[:50]}')
m = np.array([r[:4] for r in rows])
print(f'mean {m[:, 0].mean():.2f} -> {m[:, 1].mean():.2f} dB, F0 {np.nanmean(m[:, 2]):.0f} -> {np.nanmean(m[:, 3]):.0f} cents')
if len(sys.argv) > 2:
    import wave
    y = np.concatenate(demo)
    with wave.open(sys.argv[2], 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(data.SR)
        w.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes())
