"""group-voice.py: a voice's vowels and pitch from a group of VCTK speakers (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/group-voice.py <vctk dir> <source dir> <out.json> --sex M|F [--accents American,Canadian] [--per N]

For the group's speakers (sex and accent from speaker-info.txt), over N lines each (default 60,
source.py's picks in <source dir>/_idx), measures with Praat F1 to F3 at 20% and 80% through every
vowel MFA aligned (ceiling 5,000 Hz for men, 5,500 for women), and the pitch over each vowel.
Writes the medians as a voice fragment in the shape fit.mjs gives a fitted voice:
  { f0, vowels: { IY: { f: [F1, F2, F3] at 20%, vs: 80% / 20% }, EY: { f, to: 80% }, ... },
    n: vowels measured per phone, speakers }
Each speaker's medians first, then the median over speakers, so a talkative speaker doesn't
outvote the rest.
"""
import json, sys
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

DIPH = {'EY', 'AY', 'OW', 'AW', 'OY'}
CFG = {}


def speaker(spk):
    vdir, src = CFG['vctk'], CFG['src']
    ceil = 5000 if CFG['sex'] == 'M' else 5500
    idx = json.load(open(src / '_idx' / f'{spk}.json'))
    got, f0s = {}, []
    for lid, L in list(idx.items())[:CFG['per']]:
        nm = CFG['names'].get(lid); tg = vdir / 'mfa' / 'aligned' / spk / f'{nm}.TextGrid'
        if not nm or not tg.exists():
            continue
        ph, bad = vctk.timing(L['trace'], vctk.textgrid_phones(tg), CFG['table'])
        trc = [t for t in L['trace'] if t['p'] != 'END'][:len(ph or [])]
        if bad or len(trc) != len(ph):
            continue
        x, sr = sf.read(vdir / 'wav48_silence_trimmed' / spk / f'{nm}_mic1.flac')
        s = parselmouth.Sound(x.mean(1) if x.ndim > 1 else x, sr)
        fm = s.to_formant_burg(0.005, 5, ceil, 0.025, 50)
        pt = s.to_pitch_ac(0.01, 60 if CFG['sex'] == 'M' else 120, 300 if CFG['sex'] == 'M' else 450)
        for k, t in enumerate(trc):
            c = t['p']
            a, b = ph[k]['start'], ph[k]['end']
            if c not in VOW or b - a < 0.06:
                continue
            row = []
            for u in (0.2, 0.8):
                row.append([call(fm, 'Get value at time', n, a + u * (b - a), 'hertz', 'linear') for n in (1, 2, 3)])
            row = np.array(row)
            if np.isfinite(row).all():
                got.setdefault(c, []).append(row)
            p = call(pt, 'Get mean', a, b, 'Hertz')
            if p == p:
                f0s.append(p)
    return spk, {c: np.median(v, 0).tolist() for c, v in got.items() if len(v) >= 3}, float(np.median(f0s)) if f0s else None


def init(cfg):
    CFG.update(cfg)


def main():
    args = sys.argv[1:]
    opt = {'--sex': 'M', '--accents': 'American,Canadian', '--per': '60'}
    for flag in list(opt):
        if flag in args:
            k = args.index(flag); opt[flag] = args[k + 1]; del args[k:k + 2]
    vdir, src, out = Path(args[0]), Path(args[1]), Path(args[2])
    acc = set(opt['--accents'].split(','))
    spks = []
    for row in open(vdir / 'speaker-info.txt').read().splitlines()[1:]:
        f = row.split()
        if len(f) >= 4 and f[2] == opt['--sex'] and f[3] in acc and (src / '_idx' / f'{f[0]}.json').exists():
            spks.append(f[0])
    cfg = {'vctk': vdir, 'src': src, 'sex': opt['--sex'], 'per': int(opt['--per']),
           'names': {str(l['id']): l['name'] for l in json.load(open(vdir / 'mfa' / 'lines.json'))},
           'table': json.load(open(vdir / 'mfa' / 'phone-table.json'))}
    with Pool(4, initializer=init, initargs=(cfg,)) as pool:
        res = pool.map(speaker, spks)
    per = {}
    for spk, v, f0 in res:
        for c, m in v.items():
            per.setdefault(c, []).append(m)
    f0 = float(np.median([r[2] for r in res if r[2]]))
    vowels, n = {}, {}
    for c, ms in sorted(per.items()):
        m = np.median(ms, 0)          # (2 points x 3 formants)
        a, b = m[0], m[1]
        n[c] = len(ms)
        if c in DIPH:
            vowels[c] = {'f': [round(float(v)) for v in a], 'to': [round(float(v)) for v in b]}
        else:
            vowels[c] = {'f': [round(float(v)) for v in a], 'vs': [round(float(b[k] / a[k]), 3) for k in range(3)]}
    json.dump({'f0': round(f0, 1), 'vowels': vowels, 'n': n, 'speakers': [r[0] for r in res]}, open(out, 'w'), indent=1)
    print(f'{opt["--sex"]}: {len(res)} speakers, f0 {f0:.1f} Hz, {len(vowels)} vowels -> {out}')


if __name__ == '__main__':
    main()
