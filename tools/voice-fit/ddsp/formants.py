"""formants.py: VCTK's formants against ORACLE's rules, per phone (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/formants.py <vctk dir> <export dir> <out dir> [--jobs 8] [--speakers p225,...]

For every line vctk.py can pair (same pairing: vctk.timing over MFA's TextGrid and ORACLE's
trace), measures F1 to F3 with Praat (Burg, 5 ms steps; ceiling 5,000 Hz for men, 5,500 for
women) at 20%, 50% and 80% through each voiced sonorant (vowels, liquids, glides, nasals),
and ORACLE's rule formants at the same points, read off export.mjs's tracks through the same
piecewise-linear map from the speaker's time to the render's that data.item uses.

Writes <out dir>/<spk>.pkl: a list of
  { name, spk, codes, rdur, acc, lr (phones x 3 points x 3 formants: log(measured / rule), NaN
    where not a sonorant or Praat found nothing) }
Nothing is normalised here; the speaker's vocal-tract length (their median log ratio per
formant) comes out at training time, as register and rate do for pitch.
"""
import json, pickle, sys, time
from pathlib import Path
from multiprocessing import Pool
import numpy as np
import soundfile as sf
import parselmouth
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import vctk, syllable

SON = syllable.VOW | {'L', 'R', 'W', 'Y', 'M', 'N', 'NG'}
POINTS = (0.2, 0.5, 0.8)
CFG = {}


def speaker(spk):
    vdir, exp, out = CFG['vctk'], CFG['exp'], CFG['out']
    idx, table, lines, sex = shard(spk), CFG['table'], CFG['lines'][spk], CFG['sex'].get(spk, 'F')
    ceiling = 5000 if sex == 'M' else 5500
    rows, why = [], {}
    for l in lines:
        lid, name = str(l['id']), l['name']
        tgp = vdir / 'mfa' / 'aligned' / spk / f'{name}.TextGrid'
        if lid not in idx or not tgp.exists():
            continue
        L = idx[lid]
        ph, bad = vctk.timing(L['trace'], vctk.textgrid_phones(tgp), table)
        if bad:
            continue
        trace = [t for t in L['trace'] if t['p'] != 'END'][:len(ph)]
        if len(trace) != len(ph):
            continue
        x, sr = sf.read(vdir / 'wav48_silence_trimmed' / spk / f'{name}_mic1.flac', dtype='float64')
        if x.ndim > 1:
            x = x.mean(1)
        fm = parselmouth.Sound(x, sr).to_formant_burg(time_step=0.005, max_number_of_formants=5, maximum_formant=ceiling)
        tr = np.fromfile(exp / f'{lid}.f32', dtype=np.float32).reshape(L['frames'], -1)
        cols = [L['names'].index(k) for k in ('f1', 'f2', 'f3')]
        r = [t['at'] for t in trace] + [L['frames'] * L['frame']]
        lr = np.full((len(ph), len(POINTS), 3), np.nan, np.float32)
        for k, p in enumerate(ph):
            if trace[k]['p'] not in SON or p['end'] - p['start'] < 0.03:
                continue
            for j, u in enumerate(POINTS):
                ts = p['start'] + u * (p['end'] - p['start'])
                rt = r[k] + u * (r[k + 1] - r[k])
                fr = tr[min(int(round(rt / L['frame'])), L['frames'] - 1), cols]
                for f in range(3):
                    v = fm.get_value_at_time(f + 1, ts)
                    if v == v and v > 0 and fr[f] > 0:
                        lr[k, j, f] = np.log(v / fr[f])
        rows.append({'name': name, 'spk': spk, 'codes': [t['p'] for t in trace],
                     'rdur': np.diff(r).astype(np.float32), 'acc': [1 if t.get('acc') else 0 for t in trace], 'lr': lr})
    pickle.dump(rows, open(out / f'{spk}.pkl', 'wb'))
    return spk, len(rows)


def init(cfg):
    CFG.update(cfg)


def shard(spk):
    """The speaker's part of export.mjs's index: the whole index in every worker ran out of memory."""
    return json.load(open(CFG['out'] / '_idx' / f'{spk}.json'))


def main():
    args = sys.argv[1:]
    opt = {}
    for flag in ('--jobs', '--speakers'):
        if flag in args:
            k = args.index(flag); opt[flag] = args[k + 1]; del args[k:k + 2]
    vdir, exp, out = (Path(a) for a in args[:3])
    out.mkdir(parents=True, exist_ok=True)
    lines = {}
    for l in json.load(open(vdir / 'mfa' / 'lines.json')):
        lines.setdefault(l['name'].split('_')[0], []).append(l)
    sex = {}
    for row in open(vdir / 'speaker-info.txt').read().splitlines()[1:]:
        f = row.split()
        if len(f) >= 3:
            sex[f[0]] = f[2]
    want = opt['--speakers'].split(',') if '--speakers' in opt else sorted(lines)
    todo = [s for s in want if '--speakers' in opt or not (out / f'{s}.pkl').exists()]
    (out / '_idx').mkdir(exist_ok=True)
    if any(not (out / '_idx' / f'{s}.json').exists() for s in todo):
        idx = json.load(open(exp / 'index.json'))['lines']
        for s in todo:
            json.dump({str(l['id']): idx[str(l['id'])] for l in lines[s] if str(l['id']) in idx}, open(out / '_idx' / f'{s}.json', 'w'))
        del idx
    cfg = {'vctk': vdir, 'exp': exp, 'out': out, 'table': json.load(open(vdir / 'mfa' / 'phone-table.json')), 'lines': lines, 'sex': sex}
    t0, n = time.time(), 0
    with Pool(int(opt.get('--jobs', 8)), initializer=init, initargs=(cfg,)) as pool:
        for spk, k in pool.imap_unordered(speaker, todo):
            n += k
            print(f'{spk}: {k} lines; {n} so far, {time.time() - t0:.0f} s', flush=True)


if __name__ == '__main__':
    main()
