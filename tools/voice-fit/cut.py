"""cut.py: cut ORACLE recordings into one clip per line read, and transcribe each.

  <venv python> tools/voice-fit/cut.py <dir with part1.wav..part4.wav> <clips.json>

Parts 1 and 2 are "Say ___ aloud." read briskly: the gaps between lines are as quiet
as the closures inside words, so no level threshold finds them. But every line starts
with the /s/ of "Say" and no test word in those parts has an s, so each strong hiss
(4-10 kHz holding over SIB_RATIO of the energy for 50 ms or more) starts a line.
Part 3 left real pauses, so it is cut at quiet stretches of GAP seconds. Part 4 is one
passage and isn't cut.

Each clip is transcribed on its own by Whisper base.en: two seconds is too short for it
to loop, which it does over a whole part of this script. Matching clips to script lines,
and dropping false starts and retakes, is match.mjs's job.
"""
import json, sys
from pathlib import Path
import numpy as np
from segment import read_wav, energy

SIB_RATIO = 0.4    # share of a frame's energy in 4-10 kHz that makes it a hiss
SIB_DB = 8         # dB over the noise floor
SIB_MIN = 5        # frames (10 ms) of hiss in a row
SIB_MERGE = 20     # frames: hisses closer than this are one
GAP = 0.3          # s of quiet that ends a line in Part 3
OVER_FLOOR = 10


def sib_onsets(x, sr):
    hop = int(sr * 0.01)
    n = len(x) // hop
    fr = x[:n * hop].reshape(n, hop) * np.hanning(hop)
    S = np.abs(np.fft.rfft(fr, axis=1)) ** 2
    f = np.fft.rfftfreq(hop, 1 / sr)
    hi = S[:, (f >= 4000) & (f <= 10000)].sum(1)
    tot = S.sum(1) + 1e-12
    lvl = 10 * np.log10(tot / hop + 1e-12)
    on = (hi / tot > SIB_RATIO) & (lvl > np.percentile(lvl, 10) + SIB_DB)
    runs, st = [], None
    for i, v in enumerate(on):
        if v and st is None:
            st = i
        if not v and st is not None:
            if i - st >= SIB_MIN:
                runs.append([st, i])
            st = None
    merged = []
    for a, b in runs:
        if merged and a - merged[-1][1] < SIB_MERGE:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return [a * 0.01 for a, b in merged]


def pause_cuts(x, sr):
    e = energy(x, sr)
    on = e > np.percentile(e, 10) + OVER_FLOOR
    spans, st, q = [], None, 0
    for i, v in enumerate(on):
        if v:
            if st is None:
                st = i
            q = 0
        elif st is not None:
            q += 1
            if q * 0.01 >= GAP:
                spans.append((st * 0.01, (i - q + 1) * 0.01))
                st, q = None, 0
    if st is not None:
        spans.append((st * 0.01, len(e) * 0.01))
    return [(a, b) for a, b in spans if b - a >= 0.25]


def main():
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    import torch
    from transformers import pipeline
    asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en',
                   device=0 if torch.cuda.is_available() else -1)
    out = {}
    for part in sorted(src.glob('part*.wav')):
        x, sr = read_wav(part)
        dur = len(x) / sr
        if part.stem in ('part1', 'part2', 'part5'):
            on = sib_onsets(x, sr)
            spans = [(max(0, a - 0.05), (on[k + 1] - 0.03) if k + 1 < len(on) else dur) for k, a in enumerate(on)]
        elif part.stem == 'part3':
            spans = [(max(0, a - 0.08), min(dur, b + 0.08)) for a, b in pause_cuts(x, sr)]
        else:
            spans = [(0, dur)]
        t = np.arange(0, dur, 1 / 16000)
        x16 = np.interp(t, np.arange(len(x)) / sr, x).astype(np.float32)
        clips = []
        for a, b in spans:
            r = asr({'raw': x16[int(a * 16000):int(b * 16000)], 'sampling_rate': 16000}, return_timestamps='word')
            words = []
            for c in r.get('chunks', []):
                t0, t1 = c['timestamp']
                t0 = t0 or 0
                words.append({'w': c['text'].strip(), 't0': round(a + t0, 3),
                              't1': round(a + (t1 if t1 is not None else t0 + 0.3), 3)})
            clips.append({'t0': round(a, 3), 't1': round(b, 3), 'text': r['text'].strip(), 'words': words})
        out[part.stem] = {'sr': sr, 'dur': round(dur, 3), 'clips': clips}
        print(f'{part.name}: {len(clips)} clips', flush=True)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
