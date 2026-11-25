"""source_head.py: a per-vowel voice-source controller trained on VCTK (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/source_head.py <source dir> <run dir> [--steps N]

ORACLE's voice source hardly changes from vowel to vowel: across VCTK's lines its H1-H2 spreads
0.7 dB (interquartile) where the speakers' spreads 6.1 dB. People get breathier on weak
syllables and at phrase ends and press on strong ones. This head gives each vowel a correction
to the rd, tilt and ah tracks, in log units, from the line's phones as the pitch head does.

Targets, per vowel (source.py's measures, sense.py's map S):
  d  = speaker's (h1h2, h1a3, hnr) - ORACLE's on the same vowel of the same line, dB
  d -= the speaker's median d             (their own voice quality out; the shape stays)
  t  = argmin |S t - d|^2 + RIDGE |t|^2   (ah barely moves any measure, so it's held back)
  clipped to LIM per track, scaled to +-1.
Played, each track's correction is joined linearly between vowel centres, as pitch is, so it
can't move inside a vowel. The gate set's speakers are held out. Writes <run dir>/source.pt:
{ net, PH, kind: 'source', tracks, lim }.
"""
import copy, json, math, pickle, sys, time
from pathlib import Path
import numpy as np
import torch
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import syllable, formant_head, twin

DEV = syllable.DEV
TRACKS = ('rd', 'tilt', 'ah')
LIM = np.log([2.0, 1.5, 2.5])     # the largest correction per track: rd x2, tilt x1.5, ah x2.5
RIDGE = 4.0                       # dB^2 per log unit^2


def targets(sdir):
    sense = json.load(open(sdir / 'sense.json'))
    S = np.array(sense['S'])
    M = np.linalg.solve(S.T @ S + RIDGE * np.eye(3), S.T)          # dB -> log track change
    held = set(json.load(open(HERE / 'gate-set.json'))['heldOutSpeakers'])
    trn, test = [], []
    for f in sorted(sdir.glob('*.pkl')):
        rows = pickle.load(open(f, 'rb'))
        if not rows:
            continue
        D = np.concatenate([r['spk'] - r['syn'] for r in rows])
        med = np.nanmedian(D, 0)
        for r in rows:
            d = r['spk'] - r['syn'] - med
            ok = np.isfinite(d).all(1)
            t = np.full((len(r['codes']), 3), np.nan, np.float32)
            t[ok] = np.clip(d[ok] @ M.T, -LIM, LIM) / LIM
            ph, ex = syllable.phone_inputs(r['codes'], r['rdur'], r['acc'], syllable.PHONES)
            (test if f.stem in held else trn).append((ph[0], ex[0], torch.tensor(t)))
    return trn, test, S


def controlled(net, PH, tr0, L):
    """The line's rule tracks with the head's source corrections, joined between vowel centres."""
    trace = [t for t in L['trace'] if t['p'] != 'END']
    r = np.array([t['at'] for t in trace] + [L['frames'] * L['frame']])
    codes = [t['p'] for t in trace]
    ph, ex = syllable.phone_inputs(codes, np.diff(r), [1.0 if t.get('acc') else 0.0 for t in trace], PH)
    with torch.no_grad():
        p = net(ph.to(DEV), ex.to(DEV))[0].cpu().numpy() * LIM
    wt = tr0.copy()
    n = len(wt)
    for j, k in enumerate(TRACKS):
        wt[:, twin.IX[k]] *= np.exp(syllable.frame_curve(p[:, j], codes, r, n, L['frame']))
    return wt


class SourceHead(syllable.PhoneHead):
    pass      # three outputs, as PhoneHead: rd, tilt, ah


def main():
    args = sys.argv[1:]
    steps = 6000
    if '--steps' in args:
        k = args.index('--steps'); steps = int(args[k + 1]); del args[k:k + 2]
    sdir, run = Path(args[0]), Path(args[1])
    run.mkdir(parents=True, exist_ok=True)
    trn, test, S = targets(sdir)
    print(f'{len(trn)} training lines, {len(test)} held out, {DEV}', flush=True)
    T = torch.cat([t for _, _, t in trn]); T = T[~torch.isnan(T).any(1)]
    print('target spread (interquartile, log units): ' + ', '.join(
        f'{k} {float((np.percentile(T[:, j], 75) - np.percentile(T[:, j], 25)) * LIM[j]):.3f}' for j, k in enumerate(TRACKS)), flush=True)
    torch.manual_seed(0); rng = np.random.default_rng(0)
    net = SourceHead(len(syllable.PHONES)).to(DEV)
    opt = torch.optim.Adam(net.parameters(), lr=2e-3, weight_decay=1e-4)

    def ev(items, zero=False):
        net.eval(); tot, n = 0.0, 0
        with torch.no_grad():
            for k in range(0, len(items), 256):
                ph, ex, y, lens = formant_head.batch(items[k:k + 256])
                p = torch.zeros_like(y) if zero else formant_head.FormantHead.forward(net, ph, ex, lens)
                tot += formant_head.loss_of(p, y).item() * len(items[k:k + 256]); n += len(items[k:k + 256])
        return tot / n
    z = ev(test, True)
    print(f'rules alone: held-out loss {z:.4f}', flush=True)
    best, t0 = (1e9, None, 0), time.time()
    for s in range(steps):
        net.train()
        ph, ex, y, lens = formant_head.batch([trn[i] for i in rng.integers(len(trn), size=64)])
        L = formant_head.loss_of(formant_head.FormantHead.forward(net, ph, ex, lens), y)
        opt.zero_grad(); L.backward(); torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0); opt.step()
        if s % 250 == 249:
            v = ev(test)
            if v < best[0]:
                best = (v, copy.deepcopy(net.state_dict()), s + 1)
                torch.save({'net': best[1], 'PH': syllable.PHONES, 'kind': 'source', 'tracks': TRACKS, 'lim': LIM.tolist(),
                            'S': S.tolist(), 'step': s + 1, 'data': 'VCTK 0.92 (CC BY 4.0)'}, run / 'source.pt')
            if s % 1000 == 999:
                print(f'step {s + 1}: held out {v:.4f} (best {best[0]:.4f} at {best[2]}), {time.time() - t0:.0f} s', flush=True)
    print(f'held out: loss {z:.4f} (rules) -> {best[0]:.4f} at step {best[2]}')


if __name__ == '__main__':
    main()
