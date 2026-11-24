"""data.py: the training set for the controller: rule tracks on the speaker's own timing.

For each line export.mjs rendered (its tracks and phone trace) and align.py carried onto
the recording (each phone's start and end in the speaker's file), the tracks are warped
piecewise-linearly so every phone starts when the speaker's does. Then the twin, playing
them, lines up frame for frame with the recording, and a spectral loss compares like
with like. Each item:

  tracks   (F, 24) the rule tracks, warped, at the engine's 5 ms frames
  phone    (F,) the index of the phone each frame is in (PHONES)
  acc      (F,) 1 inside an accented phone
  pos      (F, 2) place in the phone and in the line, 0 to 1
  audio    the speaker's line at 48 kHz, from the warped tracks' time 0
  k        the line's worklet constants; po its processor options
  durs     per phone: (rule duration, speaker duration), seconds
"""
import json
from pathlib import Path
import numpy as np
from scipy.signal import resample_poly
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from segment import read_wav

SR = 48000


def load(export_dir, align_json, wav):
    d = Path(export_dir)
    idx = json.load(open(d / 'index.json'))
    A = json.load(open(align_json))
    x, sr = read_wav(wav)
    items = []
    for lid, L in idx['lines'].items():
        if lid not in A:
            continue
        tr = np.fromfile(d / f'{lid}.f32', dtype=np.float32).reshape(L['frames'], -1)
        trace, ph = L['trace'], A[lid]['phones']
        if len(trace) == len(ph) + 1:      # the trace's last entry is the line's closing pause
            trace = trace[:-1]
        if len(trace) != len(ph):
            continue
        frame = L['frame']
        rend_end = L['frames'] * frame
        r = np.array([t['at'] for t in trace] + [rend_end])
        base = ph[0]['start'] - r[0]
        s = np.array([p['start'] for p in ph] + [ph[-1]['end'] + (rend_end - r[-2]) * 0.0 + 0.15]) - base
        s = np.maximum.accumulate(s + np.arange(len(s)) * 1e-6)   # strictly rising
        n = int(np.ceil(s[-1] / frame))
        t = np.arange(n) * frame
        rt = np.interp(t, s, r)                                    # render time of each speaker frame
        fi = np.clip(rt / frame, 0, L['frames'] - 1)
        i0 = np.floor(fi).astype(int); i1 = np.minimum(i0 + 1, L['frames'] - 1); u = (fi - i0)[:, None]
        wt = tr[i0] * (1 - u) + tr[i1] * u
        pi = np.clip(np.searchsorted(s, t, side='right') - 1, 0, len(ph) - 1)
        span = np.maximum(s[pi + 1] - s[pi], 1e-3)
        a0 = int(round(base * sr))
        seg = x[max(0, a0):a0 + int(np.ceil(s[-1] * sr))]
        if a0 < 0:
            seg = np.concatenate([np.zeros(-a0), seg])
        aud = resample_poly(seg, SR, sr) if sr != SR else seg
        f0s = pitch(aud.astype(np.float64), SR, frame, n)
        items.append({
            'f0spk': f0s,
            'id': lid, 'text': L['text'], 'tracks': wt.astype(np.float32), 'phone_code': [trace[i]['p'] for i in pi],
            'acc': np.array([1.0 if trace[i].get('acc') else 0.0 for i in pi], dtype=np.float32),
            'pos': np.stack([(t - s[pi]) / span, t / s[-1]], 1).astype(np.float32),
            'audio': aud.astype(np.float32), 'k': L['k'], 'po': L.get('po', {}), 'names': L['names'], 'frame': frame,
            'presence': idx['presenceDb'],
            'durs': [(r[i + 1] - r[i], s[i + 1] - s[i], trace[i]['p'], 1 if trace[i].get('acc') else 0) for i in range(len(ph))],
        })
    return items


def pitch(x, sr, frame, n):
    """The speaker's F0 per frame, 0 where unvoiced: autocorrelation over 40 ms, 55-300 Hz,
    voiced where the peak is 0.5 of the energy and the frame is within 30 dB of the loudest."""
    w = int(0.04 * sr); lo, hi = int(sr / 300), int(sr / 55)
    x = np.convolve(x, np.ones(8) / 8, 'same')[::4]; sr4 = sr // 4; w4, lo4, hi4 = w // 4, lo // 4, hi // 4
    out = np.zeros(n, np.float32); e = np.zeros(n)
    for i in range(n):
        c = int(i * frame * sr4); seg = x[max(0, c - w4 // 2):c + w4 // 2]
        if len(seg) < w4: continue
        seg = seg - seg.mean(); e[i] = (seg ** 2).mean()
        ac = np.correlate(seg, seg, 'full')[len(seg) - 1:]
        k = lo4 + int(np.argmax(ac[lo4:hi4]))
        if ac[k] > 0.5 * ac[0]:
            # parabolic peak for sub-sample lag
            a, b, cc = ac[k - 1], ac[k], ac[k + 1] if k + 1 < len(ac) else ac[k]
            d = 0.5 * (a - cc) / (a - 2 * b + cc) if (a - 2 * b + cc) != 0 else 0
            out[i] = sr4 / (k + d)
    out[e < e.max() * 1e-3] = 0
    return out
