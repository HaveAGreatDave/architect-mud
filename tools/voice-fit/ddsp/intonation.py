"""intonation.py: ORACLE's pitch and timing over a phrase against VCTK speakers on the same lines.

  <venv python> tools/voice-fit/ddsp/intonation.py <vctk dir> <export dir> <lines.json> [--jobs 3]

<export dir> is export.mjs --tracks-only of <lines.json> with the voice under test. The two sides
are measured apart, each on its own timing: the speaker on MFA's phones and the autocorrelation
tracker, ORACLE on its trace and its f0 track. Pitch is in semitones against the line's median
over its vowels. Prints one table, both sides' medians over lines.
"""
import json, pickle, sys
from pathlib import Path
from multiprocessing import Pool
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import data
from vctk import textgrid_phones

FRAME = 0.005
ORACLE_VOW = {'IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'AH', 'AX', 'ER', 'UH', 'UW', 'OW', 'EY', 'AY', 'OY', 'AW',
              'AXR', 'IX', 'UX', 'OH', 'EA', 'IA', 'UA', 'EI', 'OU'}


def vowels_from(segs, f0, t0=0.0):
    """segs [(label, start, end, isvowel)] -> per vowel (mid time, dur, st list)."""
    out = []
    for lab, s, e, v in segs:
        if not v:
            continue
        a, b = int((s - t0) / FRAME), int((e - t0) / FRAME)
        f = f0[a:b]; f = f[f > 0]
        out.append((0.5 * (s + e), e - s, f))
    return out


def metrics(vs, pauses, span):
    vs = [v for v in vs if v[1] > 0.02]
    if len(vs) < 4:
        return None
    allf = np.concatenate([v[2] for v in vs if len(v[2])]) if any(len(v[2]) for v in vs) else np.array([])
    if len(allf) < 20:
        return None
    med = np.median(allf)
    st = lambda f: 12 * np.log2(f / med)
    pts = [(v[0], np.median(st(v[2])), v[2]) for v in vs if len(v[2]) >= 3]
    if len(pts) < 4:
        return None
    t = np.array([p[0] for p in pts]); y = np.array([p[1] for p in pts])
    a = st(allf)
    m = {}
    m['range st (p10-p90)'] = np.percentile(a, 90) - np.percentile(a, 10)
    m['vowel-to-vowel sd st'] = np.std(y)
    m['mean |step| st'] = np.mean(np.abs(np.diff(y)))
    m['declination st/s'] = np.polyfit(t - t[0], y, 1)[0] if t[-1] > t[0] else np.nan
    m['last vowel st'] = y[-1]
    m['first vowel st'] = y[0]
    m['peak position (0-1)'] = (t[np.argmax(y)] - t[0]) / max(t[-1] - t[0], 1e-3)
    moves, slopes = [], []
    for _, _, f in pts:
        s_ = st(f)
        moves.append(s_.max() - s_.min())
        if len(s_) >= 5:
            slopes.append(np.max(np.abs(np.diff(np.convolve(s_, np.ones(3) / 3, 'valid')))) / FRAME)
    m['in-vowel move st'] = np.median(moves)
    m['in-vowel peak slope st/s'] = np.median(slopes) if slopes else np.nan
    m['last vowel fall st'] = st(pts[-1][2])[-1] - st(pts[-1][2])[0]
    d = np.array([v[1] for v in vs])
    m['vowel nPVI'] = 100 * np.mean(np.abs(np.diff(d)) / ((d[1:] + d[:-1]) / 2))
    m['vowel varco'] = 100 * np.std(d) / np.mean(d)
    m['final lengthening'] = d[-1] / np.median(d[:-1])
    m['vowels/s'] = len(vs) / span
    m['pauses/line'] = len(pauses)
    m['pause ms'] = 1000 * np.median(pauses) if pauses else np.nan
    m['_contour'] = np.interp(np.linspace(0, 1, 10), (t - t[0]) / max(t[-1] - t[0], 1e-3), y)
    return m


def speaker(args):
    vctk, name, fr = args
    spk = name.split('_')[0]
    tg = vctk / 'mfa' / 'aligned' / spk / f'{name}.TextGrid'
    if not tg.exists():
        return None
    ph = textgrid_phones(tg)
    x, sr = sf.read(vctk / 'wav48_silence_trimmed' / spk / f'{name}_mic1.flac', dtype='float32')
    if x.ndim > 1:
        x = x.mean(1)
    x = resample_poly(x, 16000, sr).astype(np.float64)
    n = int(len(x) / 16000 / FRAME)
    f0 = data.pitch(x, 16000, FRAME, n, *fr)
    lab = [(l, s, e, bool(l) and l[-1].isdigit()) for l, s, e in ph]
    sp = [i for i, (l, s, e, v) in enumerate(lab) if l not in ('', 'sil', 'sp', 'spn')]
    if not sp:
        return None
    inner = lab[sp[0]:sp[-1] + 1]
    pauses = [e - s for l, s, e, v in inner if l in ('', 'sil', 'sp') and e - s >= 0.05]
    return metrics(vowels_from(inner, f0), pauses, inner[-1][2] - inner[0][1])


def oracle(exp, lid, L):
    tr = np.fromfile(exp / f'{lid}.f32', dtype=np.float32).reshape(L['frames'], -1)
    nm = L['names']
    f0 = tr[:, nm.index('f0')].copy()
    av = tr[:, nm.index('av')]
    f0[av < 0.05 * av.max()] = 0
    T = L['trace']; at = [t['at'] for t in T] + [L['frames'] * FRAME]
    segs = [(t['p'], at[i], at[i + 1], t['p'] in ORACLE_VOW) for i, t in enumerate(T) if t['p'] != 'END']
    sp = [i for i, s in enumerate(segs) if not s[0].startswith('_')]
    inner = segs[sp[0]:sp[-1] + 1]
    pauses = [e - s for l, s, e, v in inner if l.startswith('_') and e - s >= 0.05]
    return metrics(vowels_from(inner, f0), pauses, inner[-1][2] - inner[0][1])


def table(rows, label):
    keys = [k for k in rows[0] if not k.startswith('_')]
    return {k: np.nanmedian([r[k] for r in rows]) for k in keys}


def contour_spread(rows):
    C = np.array([r['_contour'] for r in rows])
    c = C - C.mean(1, keepdims=True)
    # how alike lines are: mean correlation of each line's shape with the average shape
    mean = c.mean(0)
    cors = [np.corrcoef(x, mean)[0, 1] for x in c if np.std(x) > 0]
    return float(np.median(cors)), float(np.mean(np.std(c, 0))), np.round(C.mean(0), 1)


def main():
    a = sys.argv[1:]
    jobs = 3
    if '--jobs' in a:
        k = a.index('--jobs'); jobs = int(a[k + 1]); del a[k:k + 2]
    vctk, exp, lines = Path(a[0]), Path(a[1]), json.load(open(a[2]))
    idx = json.load(open(exp / 'index.json'))
    info = {l.split()[0]: l.split()[2] for l in open(vctk / 'speaker-info.txt') if l.startswith('p')}
    work = [(vctk, l['name'], (60, 300) if info[l['name'].split('_')[0]] == 'M' else (110, 500)) for l in lines]
    cache = exp.parent / (Path(a[2]).stem + '-speakers.pkl')
    if cache.exists():
        S = pickle.load(open(cache, 'rb'))
    else:
        with Pool(jobs) as p:
            S = [r for r in p.map(speaker, work) if r]
        pickle.dump(S, open(cache, 'wb'))
    O = [r for r in (oracle(exp, str(l['id']), idx['lines'][str(l['id'])]) for l in lines) if r]
    ts, to = table(S, 'spk'), table(O, 'oracle')
    print(f'{len(S)} speaker lines, {len(O)} ORACLE lines')
    print(f'{"":28s}{"speakers":>10s}{"ORACLE":>10s}')
    for k in ts:
        print(f'{k:28s}{ts[k]:10.2f}{to[k]:10.2f}')
    for nm, R in (('speakers', S), ('ORACLE', O)):
        c, sd, mean = contour_spread(R)
        print(f'{nm}: shape vs mean shape r={c:.2f}, sd round it {sd:.2f} st, mean contour {mean.tolist()}')


if __name__ == '__main__':
    main()
