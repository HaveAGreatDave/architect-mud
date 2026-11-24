"""draw-align.py: a spectrogram of aligned lines with their phone boundaries, to check by eye.

  <venv python> tools/voice-fit/draw-align.py <speaker wav> <align.json> <out.png> <id> [id ...]

One strip per line: the speaker's spectrogram to 6 kHz, a white line at each phone start,
and the phone's name under it. Pauses are drawn grey.
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw
from segment import read_wav

PX_PER_S, H, LABEL = 400, 220, 18


def strip(x, sr, line):
    ph = line['phones']
    t0, t1 = ph[0]['start'] - 0.1, ph[-1]['end'] + 0.1
    seg = x[int(t0 * sr):int(t1 * sr)]
    n, hop = int(0.02 * sr), int(sr / PX_PER_S)
    fr = np.lib.stride_tricks.sliding_window_view(seg, n)[::hop] * np.hanning(n)
    S = 20 * np.log10(np.abs(np.fft.rfft(fr, axis=1)) + 1e-9)
    f = np.fft.rfftfreq(n, 1 / sr)
    S = S[:, f <= 6000]
    S = np.clip((S - (S.max() - 70)) / 70, 0, 1)
    img = (255 * (1 - S.T[::-1])).astype(np.uint8)
    im = Image.fromarray(img).resize((S.shape[0], H)).convert('RGB')
    out = Image.new('RGB', (im.width, H + LABEL), 'white')
    out.paste(im, (0, 0))
    d = ImageDraw.Draw(out)
    for p in ph:
        x0 = int((p['start'] - t0) * PX_PER_S)
        pause = p['p'].startswith('_')
        d.line([(x0, 0), (x0, H)], fill=(170, 170, 170) if pause else (220, 40, 40), width=1)
        if not pause:
            d.text((x0 + 2, H + 3), p['p'], fill='black')
    return out


def main():
    x, sr = read_wav(sys.argv[1])
    A = json.load(open(sys.argv[2]))
    strips = [strip(x, sr, A[i]) for i in sys.argv[4:] if i in A]
    w = max(s.width for s in strips)
    out = Image.new('RGB', (w, sum(s.height + 10 for s in strips)), 'white')
    y = 0
    for s in strips:
        out.paste(s, (0, y))
        y += s.height + 10
    out.save(sys.argv[3])


if __name__ == '__main__':
    main()
