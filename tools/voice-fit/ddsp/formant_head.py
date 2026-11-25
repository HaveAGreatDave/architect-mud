"""formant_head.py: a per-phone formant controller trained on VCTK (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/formant_head.py <formants dir> <run dir> [--steps N]

The first formant controller worked frame by frame through the twin, on David's ten minutes,
and smeared words. This one takes what worked for pitch: one step per phone (the phone and its
neighbours, through a bidirectional GRU, as syllable.PhoneHead), targets measured directly
(formants.py: Praat's F1 to F3 against the rules' at 20, 50 and 80% through each voiced
sonorant), and 44 hours of other people instead of ten minutes of one.

Outputs per phone: 3 points x 3 formants, each a log ratio on the rules' formant, capped at
+-FLIM. Each speaker's vocal-tract length (their median log ratio per formant over all their
sonorants) is taken out of the targets first, so the head learns how formants move from sound
to sound, not whose throat it was. Obstruents have no target; at play time the curve returns to
zero at their middle, so a stop's or fricative's own formant targets are the rules'.

The gate set's speakers are held out. Writes <run dir>/formant.pt: { net, PH, kind: 'formant' },
which gate.py and listen-build.py accept beside the pitch heads.
"""
import copy, json, math, pickle, sys, time
from pathlib import Path
import numpy as np
import torch
import torch.nn as nn
from torch.nn.utils.rnn import pad_sequence, pack_padded_sequence, pad_packed_sequence
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import syllable, prosody, twin

DEV = syllable.DEV
FLIM = math.log(1.25)
POINTS = (0.2, 0.5, 0.8)
SON = syllable.VOW | {'L', 'R', 'W', 'Y', 'M', 'N', 'NG'}


class FormantHead(nn.Module):
    def __init__(self, nph, h=64):
        super().__init__()
        self.emb = nn.Embedding(nph, 16)
        self.gru = nn.GRU(16 + 4, h, num_layers=2, batch_first=True, bidirectional=True, dropout=0.2)
        self.out = nn.Linear(2 * h, 9)
        nn.init.zeros_(self.out.weight); nn.init.zeros_(self.out.bias)

    def forward(self, ph, ex, lens=None):
        x = torch.cat([self.emb(ph), ex], -1)
        if lens is None:
            h, _ = self.gru(x)
        else:
            h, _ = self.gru(pack_padded_sequence(x, lens, batch_first=True, enforce_sorted=False))
            h, _ = pad_packed_sequence(h, batch_first=True, total_length=ph.shape[1])
        return torch.tanh(self.out(h))


def load(fdir, held):
    trn, test = [], []
    for f in sorted(Path(fdir).glob('*.pkl')):
        rows = pickle.load(open(f, 'rb'))
        if not rows:
            continue
        A = np.concatenate([r['lr'] for r in rows]).reshape(-1, 3)
        vtl = np.nanmedian(A, 0)                                   # the speaker's tract length, per formant
        for r in rows:
            y = np.clip(r['lr'] - vtl, -FLIM, FLIM) / FLIM
            ph, ex = syllable.phone_inputs(r['codes'], r['rdur'], r['acc'], syllable.PHONES)
            (test if f.stem in held else trn).append((ph[0], ex[0], torch.tensor(y.reshape(len(r['codes']), 9))))
    return trn, test


def batch(items):
    lens = torch.tensor([len(p) for p, _, _ in items])
    return (pad_sequence([p for p, _, _ in items], batch_first=True).to(DEV),
            pad_sequence([e for _, e, _ in items], batch_first=True).to(DEV),
            pad_sequence([t for _, _, t in items], batch_first=True, padding_value=float('nan')).to(DEV), lens)


def loss_of(p, y):
    m = ~torch.isnan(y)
    return torch.nn.functional.smooth_l1_loss(p[m], y[m], beta=0.2)


def evaluate(net, items, zero=False):
    """Held-out loss and the median absolute error per formant, in percent."""
    net.eval(); tot, n, err = 0.0, 0, [[], [], []]
    with torch.no_grad():
        for k in range(0, len(items), 256):
            ph, ex, y, lens = batch(items[k:k + 256])
            p = torch.zeros_like(y) if zero else net(ph, ex, lens)
            tot += loss_of(p, y).item() * len(items[k:k + 256]); n += len(items[k:k + 256])
            d = (p - y).reshape(*y.shape[:2], 3, 3)
            yy = y.reshape(*y.shape[:2], 3, 3)
            for f in range(3):
                m = ~torch.isnan(yy[..., f]); err[f] += (d[..., f][m].abs() * FLIM).tolist()
    return tot / n, [100 * (math.exp(np.median(e)) - 1) for e in err]


def controlled(net, PH, tr0, L):
    """The line's rule tracks with the head's formant corrections, curve through each sonorant's
    three points, back to zero at each obstruent's middle, held flat past the ends."""
    trace = [t for t in L['trace'] if t['p'] != 'END']
    r = np.array([t['at'] for t in trace] + [L['frames'] * L['frame']])
    codes = [t['p'] for t in trace]
    ph, ex = syllable.phone_inputs(codes, np.diff(r), [1.0 if t.get('acc') else 0.0 for t in trace], PH)
    with torch.no_grad():
        p = net(ph.to(DEV), ex.to(DEV))[0].cpu().numpy().reshape(len(codes), 3, 3) * FLIM
    ts, vs = [], []
    for k, c in enumerate(codes):
        if c in SON:
            for j, u in enumerate(POINTS):
                ts.append(r[k] + u * (r[k + 1] - r[k])); vs.append(p[k, j])
        elif not c.startswith('_'):
            ts.append((r[k] + r[k + 1]) / 2); vs.append(np.zeros(3))
    wt = tr0.copy()
    if not ts:
        return wt
    t = np.arange(len(wt)) * L['frame']
    vs = np.array(vs)
    for f, name in enumerate(('f1', 'f2', 'f3')):
        wt[:, twin.IX[name]] *= np.exp(np.interp(t, ts, vs[:, f]))
    return wt


def main():
    args = sys.argv[1:]
    steps = 20000
    if '--steps' in args:
        k = args.index('--steps'); steps = int(args[k + 1]); del args[k:k + 2]
    fdir, run = Path(args[0]), Path(args[1])
    run.mkdir(parents=True, exist_ok=True)
    held = set(json.load(open(HERE / 'gate-set.json'))['heldOutSpeakers'])
    trn, test = load(fdir, held)
    print(f'{len(trn)} training lines, {len(test)} held out, {DEV}', flush=True)
    torch.manual_seed(0); rng = np.random.default_rng(0)
    net = FormantHead(len(syllable.PHONES)).to(DEV)
    opt = torch.optim.Adam(net.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps)
    z = evaluate(net, test, zero=True)
    print(f'rules alone: loss {z[0]:.4f}, median formant error F1 {z[1][0]:.1f}%, F2 {z[1][1]:.1f}%, F3 {z[1][2]:.1f}%', flush=True)
    best, t0 = (1e9, None, 0), time.time()
    for s in range(steps):
        net.train()
        ph, ex, y, lens = batch([trn[i] for i in rng.integers(len(trn), size=64)])
        L = loss_of(net(ph, ex, lens), y)
        opt.zero_grad(); L.backward(); torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0); opt.step(); sched.step()
        if s % 1000 == 999 or s == steps - 1:
            v, e = evaluate(net, test)
            if v < best[0]:
                best = (v, copy.deepcopy(net.state_dict()), s + 1)
                torch.save({'net': best[1], 'PH': syllable.PHONES, 'kind': 'formant', 'step': s + 1,
                            'data': 'VCTK 0.92 (CC BY 4.0)'}, run / 'formant.pt')
            print(f'step {s + 1}: held out {v:.4f}, F1 {e[0]:.1f}% F2 {e[1]:.1f}% F3 {e[2]:.1f}%, {time.time() - t0:.0f} s', flush=True)
    net.load_state_dict(best[1])
    v, e = evaluate(net, test)
    print(f'held out (step {best[2]}): median formant error F1 {z[1][0]:.1f} -> {e[0]:.1f}%, F2 {z[1][1]:.1f} -> {e[1]:.1f}%, F3 {z[1][2]:.1f} -> {e[2]:.1f}%')


if __name__ == '__main__':
    main()
