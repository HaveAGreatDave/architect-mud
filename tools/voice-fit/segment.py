"""segment.py: transcribe ORACLE recordings with a timestamp on every word.

  <venv python> tools/voice-fit/segment.py <dir with part1.wav..part4.wav> <out.json>

Runs anywhere with numpy, torch and transformers (the Hunyuan3D venv has them). Whisper
base.en is fetched into the Hugging Face cache on first use. The audio stays local.

Each part is cut into windows of about WIN seconds, each ending at the quietest 100 ms
near its mark, so no word is cut in half, and each window is transcribed on its own:
a whole part in one go made Whisper repeat itself. Out comes every word with its start
and end in the file. Cutting the stream into lines, and dropping retakes, is match.mjs's
job. Energy pauses (`pauses`) go out too: where a reader left real gaps (Part 3), they
are the cleanest line breaks there are.
"""
import json, sys, wave
from pathlib import Path
import numpy as np

WIN = 20.0        # s, about how long each transcribed window runs
SLACK = 4.0       # s either side of the mark to look for the quietest point
GAP = 0.3         # s of quiet that counts as a pause between lines
OVER_FLOOR = 10   # dB over the noise floor (10th percentile) that counts as sound


def read_wav(p):
    with wave.open(str(p), 'rb') as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
    if ch > 1:
        x = x.reshape(-1, ch).mean(1)
    return x, sr


def energy(x, sr):
    hop = int(0.01 * sr)
    n = len(x) // hop
    return 10 * np.log10(np.maximum(1e-10, (x[:n * hop].reshape(n, hop) ** 2).mean(1)))


def windows(e):
    """Cut points (in 10 ms frames) at the quietest 100 ms near every WIN seconds."""
    n = len(e)
    cuts, at = [0], 0
    sm = np.convolve(e, np.ones(10) / 10, mode='same')
    while at + int((WIN + SLACK) * 100) < n:
        lo, hi = at + int((WIN - SLACK) * 100), at + int((WIN + SLACK) * 100)
        at = lo + int(np.argmin(sm[lo:hi]))
        cuts.append(at)
    cuts.append(n)
    return cuts


def pauses(e):
    """Midpoints (s) of every quiet stretch of GAP seconds or more."""
    on = e > np.percentile(e, 10) + OVER_FLOOR
    out, q = [], 0
    for i, v in enumerate(on):
        if not v:
            q += 1
        else:
            if q * 0.01 >= GAP:
                out.append(round((i - q / 2) * 0.01, 3))
            q = 0
    return out


def main():
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    import torch
    from transformers import pipeline
    asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en',
                   device=0 if torch.cuda.is_available() else -1)
    result = {}
    for part in sorted(src.glob('part*.wav')):
        x, sr = read_wav(part)
        e = energy(x, sr)
        t = np.arange(0, len(x) / sr, 1 / 16000)
        x16 = np.interp(t, np.arange(len(x)) / sr, x).astype(np.float32)   # Whisper wants 16 kHz
        words = []
        cuts = windows(e)
        for a, b in zip(cuts, cuts[1:]):
            a_s, b_s = a * 0.01, b * 0.01
            clip = x16[int(a_s * 16000):int(b_s * 16000)]
            r = asr({'raw': clip, 'sampling_rate': 16000}, return_timestamps='word')
            for c in r.get('chunks', []):
                t0, t1 = c['timestamp']
                t0 = t0 or 0
                words.append({'w': c['text'].strip(), 't0': round(a_s + t0, 3),
                              't1': round(a_s + (t1 if t1 is not None else t0 + 0.3), 3)})
        result[part.stem] = {'sr': sr, 'dur': round(len(x) / sr, 3), 'words': words, 'pauses': pauses(e)}
        print(f'{part.name}: {len(words)} words in {len(cuts) - 1} windows', flush=True)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(result, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
