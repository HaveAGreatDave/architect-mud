"""measure-loud.py: how loudness falls across a sentence, for the speaker and a render.

  <venv python> tools/voice-fit/measure-loud.py <wav> <align.json> <trace.json>
  <venv python> tools/voice-fit/measure-loud.py --trace <render dir>

Each vowel's level is the RMS of its middle half in dB, against the loudest vowel in its
line. Fitted by least squares on the vowel's place in its sentence (0 at the first vowel,
1 at the last), separately for accented vowels (the trace's `acc`) and the rest, so the
slope isn't stress moving about. Also the mean level of the vowels after the line's last
accent against the accented ones (the post-nuclear drop). The trace says which vowels
are accented on both sides: the speaker's phones are the render's, carried across.
"""
import json, sys
from pathlib import Path
import numpy as np
from segment import read_wav

VOW = {'IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'UH', 'UW', 'ER', 'AH', 'AX', 'EY', 'AY', 'OW', 'OY', 'AW'}


def levels(x, sr, phones, tr):
    rows = []
    for k, ph in enumerate(phones):
        if ph['p'] not in VOW or ph['end'] - ph['start'] < 0.03:
            continue
        a = ph['start'] + 0.25 * (ph['end'] - ph['start'])
        b = ph['end'] - 0.25 * (ph['end'] - ph['start'])
        seg = x[int(a * sr):int(b * sr)]
        rows.append([ph['start'], 10 * np.log10((seg ** 2).mean() + 1e-12), 1 if tr[k].get('acc') else 0])
    if len(rows) < 4:
        return []
    r = np.array(rows)
    r[:, 0] = (r[:, 0] - r[0, 0]) / max(1e-6, r[-1, 0] - r[0, 0])
    r[:, 1] -= r[:, 1].max()
    # after the last accent
    last = max([i for i in range(len(r)) if r[i, 2]] or [len(r)])
    post = np.zeros(len(r)); post[last + 1:] = 1
    return np.column_stack([r, post]).tolist()


def main():
    allr = []
    if sys.argv[1] == '--trace':
        rdir = Path(sys.argv[2])
        traces = json.load(open(rdir / 'trace.json'))
        for sid, tr in traces.items():
            x, sr = read_wav(rdir / f'{sid}.wav')
            ph = [{'p': tr[k]['p'], 'start': tr[k]['at'], 'end': tr[k + 1]['at']} for k in range(len(tr) - 1)]
            allr += levels(x, sr, ph, tr)
    else:
        x, sr = read_wav(sys.argv[1])
        A, traces = json.load(open(sys.argv[2])), json.load(open(sys.argv[3]))
        for sid, line in A.items():
            if sid in traces:
                allr += levels(x, sr, line['phones'], traces[sid])
    r = np.array(allr)
    out = {}
    for name, m in (('accented', r[:, 2] == 1), ('unaccented', (r[:, 2] == 0) & (r[:, 3] == 0))):
        k, c = np.polyfit(r[m, 0], r[m, 1], 1)
        out[name] = {'slope_db': round(float(k), 2), 'n': int(m.sum())}
    acc = r[(r[:, 2] == 1), 1].mean()
    out['post_nuclear_db'] = round(float(r[r[:, 3] == 1, 1].mean() - acc), 2)
    out['unaccented_vs_accented_db'] = round(float(r[(r[:, 2] == 0) & (r[:, 3] == 0), 1].mean() - acc), 2)
    print(json.dumps(out))


if __name__ == '__main__':
    main()
