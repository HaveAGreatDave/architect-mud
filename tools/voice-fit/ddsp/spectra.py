"""spectra.py: each phone's spectral envelope, VCTK against ORACLE (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/spectra.py <vctk dir> <source dir> <out dir> [--per N] [--sex M] [--k '{json}']

Renders N lines per speaker (default 20) through the worklet with the engine's current WK
constants overridden by --k (so the render matches the voice as it now stands, whatever the
export's index carried), then measures, over the middle half of every sonorant and fricative,
the power in each band of EDGES on both the speaker and the render, in dB against the phone's
own 250 to 1,000 Hz peak band. Reuses source.py's picked lines (<source dir>/_idx) and the
export's tracks. Writes <out dir>/<spk>.pkl: [{ name, id, codes, rdur, acc, spk, syn }],
spk and syn (phones x bands), NaN where a phone wasn't measured.
"""
import json, pickle, subprocess, sys
from pathlib import Path
import numpy as np
import soundfile as sf
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import vctk
from phones import VOW

EDGES = np.array([0, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 6000, 7000, 8000, 10000])
SON = VOW | {'L', 'R', 'W', 'Y', 'M', 'N', 'NG'}
FRIC = {'S', 'Z', 'SH', 'ZH', 'F', 'V', 'TH', 'DH', 'HH'}


def bands(x, sr, a, b):
    i, j = int(a * sr), int(b * sr)
    if j - i < int(0.03 * sr) or i < 0 or j > len(x):
        return np.full(len(EDGES) - 1, np.nan)
    P = np.abs(np.fft.rfft(x[i:j] * np.hanning(j - i), 1 << 14)) ** 2
    hz = np.fft.rfftfreq(1 << 14, 1 / sr)
    d = 10 * np.log10(np.array([P[(hz >= EDGES[k]) & (hz < EDGES[k + 1])].mean() for k in range(len(EDGES) - 1)]) + 1e-20)
    return d - d[1:4].max()


def main():
    args = sys.argv[1:]
    opt = {'--per': '20', '--sex': 'M', '--k': '{}'}
    for flag in list(opt):
        if flag in args:
            k = args.index(flag); opt[flag] = args[k + 1]; del args[k:k + 2]
    vdir, src, out = (Path(a) for a in args[:3])
    per, kk = int(opt['--per']), json.loads(opt['--k'])
    (out / 'wav').mkdir(parents=True, exist_ok=True)
    sex = {}
    for row in open(vdir / 'speaker-info.txt').read().splitlines()[1:]:
        f = row.split()
        if len(f) >= 3:
            sex[f[0]] = f[2]
    names = {str(l['id']): l['name'] for l in json.load(open(vdir / 'mfa' / 'lines.json'))}
    table = json.load(open(vdir / 'mfa' / 'phone-table.json'))
    spks = [p.stem for p in sorted((src / '_idx').glob('*.json')) if opt['--sex'] in ('all', sex.get(p.stem))]
    pick, jobs = {}, []
    for s in spks:
        idx = json.load(open(src / '_idx' / f'{s}.json'))
        pick[s] = list(idx.items())[:per]
        for lid, L in pick[s]:
            if not (out / 'wav' / f'{lid}.raw').exists():
                jobs.append({'f32': str(vdir / 'export' / f'{lid}.f32'), 'frames': L['frames'], 'frame': L['frame'], 'k': {**L['k'], **kk},
                             'names': L['names'], 'po': L.get('po', {}), 'out': str(out / 'wav' / f'{lid}.raw')})
    if jobs:
        json.dump(jobs, open(out / 'jobs.json', 'w'))
        subprocess.run(['node', str(HERE / 'play.mjs'), str(out / 'jobs.json')], check=True)
    n = 0
    for s in spks:
        rows = []
        for lid, L in pick[s]:
            nm = names.get(lid); tg = vdir / 'mfa' / 'aligned' / s / f'{nm}.TextGrid'
            if not nm or not tg.exists():
                continue
            ph, bad = vctk.timing(L['trace'], vctk.textgrid_phones(tg), table)
            trc = [t for t in L['trace'] if t['p'] != 'END'][:len(ph or [])]
            if bad or len(trc) != len(ph):
                continue
            x, sr = sf.read(vdir / 'wav48_silence_trimmed' / s / f'{nm}_mic1.flac')
            x = x.mean(1) if x.ndim > 1 else x
            y = np.fromfile(out / 'wav' / f'{lid}.raw', dtype=np.float32).astype(np.float64)
            r = [t['at'] for t in trc] + [L['frames'] * L['frame']]
            S = np.full((len(trc), len(EDGES) - 1), np.nan, np.float32); Y = S.copy()
            for k, t in enumerate(trc):
                if t['p'] not in SON and t['p'] not in FRIC:
                    continue
                a, b = ph[k]['start'], ph[k]['end']; q = (b - a) / 4
                S[k] = bands(x, sr, a + q, b - q)
                a, b = r[k], r[k + 1]; q = (b - a) / 4
                Y[k] = bands(y, 48000, a + q, b - q)
            rows.append({'name': nm, 'id': lid, 'codes': [t['p'] for t in trc], 'rdur': np.diff(r).astype(np.float32),
                         'acc': [1 if t.get('acc') else 0 for t in trc], 'spk': S, 'syn': Y})
        pickle.dump(rows, open(out / f'{s}.pkl', 'wb'))
        n += len(rows)
        print(f'{s}: {len(rows)} lines; {n} so far', flush=True)


if __name__ == '__main__':
    main()
