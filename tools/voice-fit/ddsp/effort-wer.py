"""effort-wer.py: Whisper word error per effort level, on effort.mjs's renders.

  <venv python> tools/voice-fit/ddsp/effort-wer.py <effort.mjs out dir>

A line's errors are capped at its word count (Whisper loops on a line it can't make out).
"""
import json, sys
from pathlib import Path
import numpy as np
from scipy.signal import resample_poly
from transformers import pipeline

d = Path(sys.argv[1]); jobs = json.load(open(d / 'jobs.json'))
asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en', device=-1)
norm = lambda s: ''.join(ch.lower() if ch.isalnum() or ch in " '" else ' ' for ch in s).split()
def wer(a, b):
    a, b = norm(a), norm(b); D = np.arange(len(b) + 1)
    for i in range(1, len(a) + 1):
        prev, D[0] = D.copy(), i
        for j in range(1, len(b) + 1):
            D[j] = min(prev[j] + 1, D[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
    return min(int(D[len(b)]), len(a)), len(a)
tot = {}
for j in jobs:
    y = np.fromfile(j['raw'], dtype=np.float32); y = y / (np.abs(y).max() + 1e-9) * 0.8
    h = asr({'raw': resample_poly(y, 1, 3).astype(np.float32), 'sampling_rate': 16000})['text']
    e, n = wer(j['text'], h); t = tot.setdefault(j['effort'], [0, 0]); t[0] += e; t[1] += n
    if j['effort'] in (-1, 2): print(f"  {j['effort']:>4} {h.strip()[:70]}")
for k in sorted(tot):
    print(f'effort {k:>4}: WER {tot[k][0] / tot[k][1]:.1%} ({tot[k][0]}/{tot[k][1]})')
