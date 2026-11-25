"""consonant_head.py: a per-obstruent noise controller trained on VCTK (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/consonant_head.py <consonant dir> <run dir> [--steps N]

The table (audio-engine.js PH: nf, ng, bg, bq) now sits near VCTK's averages per phone; what it
can't hold is context. A /k/ before /iy/ is brighter than before /uw/, a /t/ at a stressed onset
is louder than one in a cluster, an /s/ at a phrase end is longer and weaker. This head gives
each fricative, affricate and stop a correction to the nf, af and nq tracks, in log units, from
the line's phones as the pitch head does.

Targets, per obstruent (consonant.py's measures):
  d  = speaker's (cog, spread, lvl) - ORACLE's on the same phone of the same line
  d -= the speaker's median d per phone  (their own consonants and the table's offsets out)
  nf += d.cog (log Hz, one to one)   nq -= d.spread (a wider band is a lower Q)
  af += d.lvl * ln10 / 20            (dB to a log amplitude)
  clipped to LIM per track, scaled to +-1.
Played, each correction is held flat over its own phone (nothing to join: obstruents don't
glide). The gate set's speakers are held out. Writes <run dir>/consonant.pt:
{ net, PH, kind: 'consonant', tracks, lim }.
"""
import copy, pickle, sys, time, json
from pathlib import Path
import numpy as np
import torch
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import syllable, formant_head, twin

DEV = syllable.DEV
TRACKS = ('nf', 'af', 'nq')
LIM = np.log([1.3, 2.0, 1.6])     # nf x1.3, af x2 (6 dB), nq x1.6
LN = np.log(10) / 20


def targets(cdir):
    held = set(json.load(open(HERE / 'gate-set.json'))['heldOutSpeakers'])
    trn, test = [], []
    for f in sorted(cdir.glob('*.pkl')):
        rows = pickle.load(open(f, 'rb'))
        if not rows:
            continue
        # the speaker's median difference per phone: their own consonants, and whatever the table still has wrong
        by = {}
        for r in rows:
            for c, d in zip(r['codes'], r['spk'] - r['syn']):
                if np.isfinite(d).all():
                    by.setdefault(c, []).append(d)
        med = {c: np.median(v, 0) for c, v in by.items() if len(v) >= 3}
        for r in rows:
            t = np.full((len(r['codes']), 3), np.nan, np.float32)
            for k, (c, d) in enumerate(zip(r['codes'], r['spk'] - r['syn'])):
                if c in med and np.isfinite(d).all():
                    d = d - med[c]
                    u = np.array([d[0], d[2] * LN, -d[1]])
                    t[k] = np.clip(u, -LIM, LIM) / LIM
            ph, ex = syllable.phone_inputs(r['codes'], r['rdur'], r['acc'], syllable.PHONES)
            (test if f.stem in held else trn).append((ph[0], ex[0], torch.tensor(t)))
    return trn, test


def controlled(net, PH, tr0, L):
    """The line's rule tracks with the head's noise corrections, flat over each obstruent."""
    trace = [t for t in L['trace'] if t['p'] != 'END']
    r = np.array([t['at'] for t in trace] + [L['frames'] * L['frame']])
    codes = [t['p'] for t in trace]
    ph, ex = syllable.phone_inputs(codes, np.diff(r), [1.0 if t.get('acc') else 0.0 for t in trace], PH)
    with torch.no_grad():
        p = net(ph.to(DEV), ex.to(DEV))[0].cpu().numpy() * LIM
    wt = tr0.copy()
    n = len(wt)
    from consonant import FRIC, STOP
    for k, c in enumerate(codes):
        if c not in FRIC and c not in STOP:
            continue
        a, b = int(r[k] / L['frame']), min(n, int(r[k + 1] / L['frame']))
        for j, name in enumerate(TRACKS):
            wt[a:b, twin.IX[name]] *= np.exp(p[k, j])
    return wt


class ConsonantHead(syllable.PhoneHead):
    pass      # three outputs, as PhoneHead: nf, af, nq


def main():
    args = sys.argv[1:]
    steps = 6000
    if '--steps' in args:
        k = args.index('--steps'); steps = int(args[k + 1]); del args[k:k + 2]
    cdir, run = Path(args[0]), Path(args[1])
    run.mkdir(parents=True, exist_ok=True)
    trn, test = targets(cdir)
    print(f'{len(trn)} training lines, {len(test)} held out, {DEV}', flush=True)
    T = torch.cat([t for _, _, t in trn]); T = T[~torch.isnan(T).any(1)]
    print(f'{len(T)} obstruents; target spread (interquartile, log units): ' + ', '.join(
        f'{k} {float((np.percentile(T[:, j], 75) - np.percentile(T[:, j], 25)) * LIM[j]):.3f}' for j, k in enumerate(TRACKS)), flush=True)
    torch.manual_seed(0); rng = np.random.default_rng(0)
    net = ConsonantHead(len(syllable.PHONES)).to(DEV)
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
                torch.save({'net': best[1], 'PH': syllable.PHONES, 'kind': 'consonant', 'tracks': TRACKS, 'lim': LIM.tolist(),
                            'step': s + 1, 'data': 'VCTK 0.92 (CC BY 4.0)'}, run / 'consonant.pt')
            if s % 1000 == 999:
                print(f'step {s + 1}: held out {v:.4f} (best {best[0]:.4f} at {best[2]}), {time.time() - t0:.0f} s', flush=True)
    print(f'held out: loss {z:.4f} (rules) -> {best[0]:.4f} at step {best[2]}')


if __name__ == '__main__':
    main()
