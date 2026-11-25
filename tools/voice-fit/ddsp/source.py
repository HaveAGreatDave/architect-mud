"""source.py: voice-source measures per vowel, VCTK against ORACLE's render (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/source.py <vctk dir> <export dir> <out dir> [--per N] [--jobs 6]

For N lines per speaker (default 100) that vctk.timing can pair, measures at 35, 50 and 65% through every vowel (medianed) (the spectrum over 40 ms, pitch and
harmonicity over 100 ms), on the speaker's recording and on ORACLE's render of the same line (export.mjs's
tracks played through the real worklet by play.mjs):

  h1h2   H1-H2, dB: the first two harmonics' levels; higher is breathier (Rd up)
  h1a3   H1-A3, dB: H1 against the harmonic nearest F3; higher is a steeper tilt
  hnr    harmonics-to-noise, dB (Praat's cross-correlation harmonicity); lower is noisier (ah up)

Writes <out dir>/<spk>.pkl: [{ name, id, codes, rdur, acc, spk: (phones x 3), syn: (phones x 3) }],
NaN where a phone isn't a vowel or a measure failed. The render's measures come from the rules'
timing, the speaker's from MFA's; both are taken mid-vowel, so they compare.

The --render pass (first) writes the worklet renders for the chosen lines to <out dir>/wav.
"""
import json, pickle, subprocess, sys, time
from pathlib import Path
from multiprocessing import Pool
import numpy as np
import soundfile as sf
import parselmouth
from parselmouth.praat import call
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import vctk
from phones import VOW

CFG = {}


def measures(x, sr, t, f0_floor=60, f0_ceiling=500, fmax=5500):
    """(h1h2, h1a3, hnr) in dB at time t in x, or NaNs."""
    nan = (np.nan, np.nan, np.nan)
    a, b = int((t - 0.02) * sr), int((t + 0.02) * sr)
    if a < 0 or b > len(x):
        return nan
    seg = x[a:b]
    # Pitch and harmonicity need three periods at the floor, so they read 100 ms round t.
    wide = parselmouth.Sound(x[max(0, int((t - 0.05) * sr)):int((t + 0.05) * sr)], sr)
    f0 = call(wide.to_pitch_ac(0.01, f0_floor, f0_ceiling), 'Get mean', 0, 0, 'Hertz')
    if not f0 == f0 or f0 <= 0:
        return nan
    w = np.hanning(len(seg)); n = 1 << 14
    S = 20 * np.log10(np.abs(np.fft.rfft(seg * w, n)) + 1e-9)
    hz = np.fft.rfftfreq(n, 1 / sr)

    def harm(f):
        m = (hz > f * 0.9) & (hz < f * 1.1)
        return S[m].max() if m.any() else np.nan
    fm = wide.to_formant_burg(0.01, 5, fmax)
    f3 = call(fm, 'Get mean', 3, 0, 0, 'hertz')
    h1, h2 = harm(f0), harm(2 * f0)
    a3 = harm(round(f3 / f0) * f0) if f3 == f3 and f3 > 0 else np.nan
    hnr = call(wide.to_harmonicity_cc(0.01, f0_floor, 0.1, 1.0), 'Get mean', 0, 0)
    return (h1 - h2, h1 - a3, hnr if hnr == hnr and hnr > -100 else np.nan)


def steady(x, sr, a, b, fmax):
    """measures() at 35, 50 and 65% through a vowel, medianed: one point was too noisy to train on."""
    m = np.array([measures(x, sr, a + u * (b - a), fmax=fmax) for u in (0.35, 0.5, 0.65)])
    with np.errstate(all='ignore'):
        return np.nanmedian(m, 0) if np.isfinite(m).any() else m[0]


def speaker(spk):
    vdir, exp, out = CFG['vctk'], CFG['exp'], CFG['out']
    idx = json.load(open(out / '_idx' / f'{spk}.json'))
    rows = []
    for l in CFG['pick'][spk]:
        lid, name = str(l['id']), l['name']
        L = idx.get(lid)
        tg = vdir / 'mfa' / 'aligned' / spk / f'{name}.TextGrid'
        if L is None or not tg.exists():   # MFA leaves a few lines unaligned
            continue
        ph, bad = vctk.timing(L['trace'], vctk.textgrid_phones(vdir / 'mfa' / 'aligned' / spk / f'{name}.TextGrid'), CFG['table'])
        trace = [t for t in L['trace'] if t['p'] != 'END'][:len(ph or [])]
        rp = out / 'wav' / f'{lid}.raw'
        if bad or len(trace) != len(ph) or not rp.exists():
            continue
        x, sr = sf.read(vdir / 'wav48_silence_trimmed' / spk / f'{name}_mic1.flac', dtype='float64')
        x = x.mean(1) if x.ndim > 1 else x
        y = np.fromfile(rp, dtype=np.float32).astype(np.float64)
        r = [t['at'] for t in trace] + [L['frames'] * L['frame']]
        S = np.full((len(ph), 3), np.nan, np.float32); Y = S.copy()
        fmax = 5000 if CFG['sex'].get(spk) == 'M' else 5500
        for k, t in enumerate(trace):
            if t['p'] not in VOW or ph[k]['end'] - ph[k]['start'] < 0.06 or r[k + 1] - r[k] < 0.06:
                continue
            S[k] = steady(x, sr, ph[k]['start'], ph[k]['end'], fmax)
            Y[k] = steady(y, 48000, r[k], r[k + 1], 5000)
        rows.append({'name': name, 'id': lid, 'codes': [t['p'] for t in trace], 'rdur': np.diff(r).astype(np.float32),
                     'acc': [1 if t.get('acc') else 0 for t in trace], 'spk': S, 'syn': Y})
    pickle.dump(rows, open(out / f'{spk}.pkl', 'wb'))
    return spk, len(rows)


def init(cfg):
    CFG.update(cfg)


def main():
    args = sys.argv[1:]
    opt = {}
    for flag in ('--per', '--jobs'):
        if flag in args:
            k = args.index(flag); opt[flag] = int(args[k + 1]); del args[k:k + 2]
    vdir, exp, out = (Path(a) for a in args[:3])
    out.mkdir(parents=True, exist_ok=True); (out / 'wav').mkdir(exist_ok=True); (out / '_idx').mkdir(exist_ok=True)
    per = opt.get('--per', 100)
    lines = {}
    for l in json.load(open(vdir / 'mfa' / 'lines.json')):
        lines.setdefault(l['name'].split('_')[0], []).append(l)
    rng = np.random.default_rng(3)
    pick = {s: [ls[i] for i in sorted(rng.choice(len(ls), min(per, len(ls)), replace=False))] for s, ls in lines.items()}
    sex = {}
    for row in open(vdir / 'speaker-info.txt').read().splitlines()[1:]:
        f = row.split()
        if len(f) >= 3:
            sex[f[0]] = f[2]
    # The chosen lines' index shards (the full index is read only if one is missing: it can
    # run a busy machine out of memory), and their renders through the worklet.
    if any(not (out / '_idx' / f'{s}.json').exists() for s in pick):
        full = json.load(open(exp / 'index.json'))['lines']
        for s, ls in pick.items():
            json.dump({str(l['id']): full[str(l['id'])] for l in ls if str(l['id']) in full}, open(out / '_idx' / f'{s}.json', 'w'))
        del full
    jobs = []
    for s, ls in pick.items():
        idx = json.load(open(out / '_idx' / f'{s}.json'))
        for l in ls:
            lid = str(l['id'])
            if lid in idx and not (out / 'wav' / f'{lid}.raw').exists():
                L = idx[lid]
                jobs.append({'f32': str(exp / f'{lid}.f32'), 'frames': L['frames'], 'frame': L['frame'], 'k': L['k'],
                             'names': L['names'], 'po': L.get('po', {}), 'out': str(out / 'wav' / f'{lid}.raw')})
    if jobs:
        json.dump(jobs, open(out / 'jobs.json', 'w'))
        subprocess.run(['node', str(HERE / 'play.mjs'), str(out / 'jobs.json')], check=True)
    cfg = {'vctk': vdir, 'exp': exp, 'out': out, 'table': json.load(open(vdir / 'mfa' / 'phone-table.json')), 'pick': pick, 'sex': sex}
    t0, n = time.time(), 0
    with Pool(opt.get('--jobs', 6), initializer=init, initargs=(cfg,)) as pool:
        for spk, k in pool.imap_unordered(speaker, sorted(s for s in pick if not (out / f'{s}.pkl').exists())):
            n += k
            print(f'{spk}: {k} lines; {n} so far, {time.time() - t0:.0f} s', flush=True)


if __name__ == '__main__':
    main()
