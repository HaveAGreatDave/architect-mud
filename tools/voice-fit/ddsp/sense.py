"""sense.py: how ORACLE's source tracks move the source measures (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/sense.py <source dir> <export dir> [--lines N]

source.py measures H1-H2, H1-A3 and HNR on a speaker and on ORACLE. To turn the difference into
track corrections, this finds the local map from the tracks to the measures: for N lines
(default 150) of source.py's set, each of rd, tilt and ah is scaled across the whole line by
STEP (one at a time, log units), rendered through the worklet, and measured at every vowel as
source.py does. Each column of S is the median change per unit of log scale:

  d(h1h2, h1a3, hnr) = S . d(log rd, log tilt, log ah)

Writes <source dir>/sense.json: { tracks, measures, S, step, n } and prints S with each entry's
spread, so a measure a track doesn't move shows as a near-zero column.
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import source
from phones import VOW

TRACKS = ('rd', 'tilt', 'ah')
STEP = {'rd': np.log(1.5), 'tilt': np.log(0.6), 'ah': np.log(2.5)}


def main():
    args = sys.argv[1:]
    n = 150
    if '--lines' in args:
        k = args.index('--lines'); n = int(args[k + 1]); del args[k:k + 2]
    sdir, exp = Path(args[0]), Path(args[1])
    idx = {}
    for f in sorted((sdir / '_idx').glob('*.json')):
        idx.update(json.load(open(f)))
    lids = sorted(idx, key=lambda s: int(s))[::max(1, len(idx) // n)][:n]
    work = sdir / 'sense'; work.mkdir(exist_ok=True)
    jobs = []
    for lid in lids:
        L = idx[lid]
        tr = np.fromfile(exp / f'{lid}.f32', dtype=np.float32).reshape(L['frames'], -1)
        for k in TRACKS:
            t = tr.copy(); t[:, L['names'].index(k)] *= np.exp(STEP[k])
            f = work / f'{lid}-{k}.f32'; t.tofile(f)
            jobs.append({'f32': str(f), 'frames': L['frames'], 'frame': L['frame'], 'k': L['k'], 'names': L['names'],
                         'po': L.get('po', {}), 'out': str(work / f'{lid}-{k}.raw')})
    json.dump(jobs, open(work / 'jobs.json', 'w'))
    subprocess.run(['node', str(HERE / 'play.mjs'), str(work / 'jobs.json')], check=True)

    d = {k: [] for k in TRACKS}
    for lid in lids:
        L = idx[lid]
        trace = [t for t in L['trace'] if t['p'] != 'END']
        r = [t['at'] for t in trace] + [L['frames'] * L['frame']]
        base = np.fromfile(sdir / 'wav' / f'{lid}.raw', dtype=np.float32).astype(np.float64)
        ys = {k: np.fromfile(work / f'{lid}-{k}.raw', dtype=np.float32).astype(np.float64) for k in TRACKS}
        for i, t in enumerate(trace):
            if t['p'] not in VOW or r[i + 1] - r[i] < 0.06:
                continue
            tm = (r[i] + r[i + 1]) / 2
            m0 = np.array(source.measures(base, 48000, tm, fmax=5000))
            for k in TRACKS:
                d[k].append((np.array(source.measures(ys[k], 48000, tm, fmax=5000)) - m0) / STEP[k])
    S, spread = np.zeros((3, 3)), np.zeros((3, 3))
    for j, k in enumerate(TRACKS):
        D = np.array(d[k]); D = D[np.isfinite(D).all(1)]
        S[:, j] = np.median(D, 0)
        spread[:, j] = np.subtract(*np.percentile(D, [75, 25], 0))
    names = ('h1h2', 'h1a3', 'hnr')
    print(f'{len(lids)} lines; dB per unit log scale (interquartile spread in brackets):')
    print('        ' + ''.join(f'{k:>18}' for k in TRACKS))
    for i, m in enumerate(names):
        print(f'{m:8}' + ''.join(f'{S[i, j]:9.2f} ({spread[i, j]:5.2f})' for j in range(3)))
    json.dump({'tracks': TRACKS, 'measures': names, 'S': S.tolist(), 'spread': spread.tolist(),
               'step': {k: float(v) for k, v in STEP.items()}, 'n': len(lids)}, open(sdir / 'sense.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
