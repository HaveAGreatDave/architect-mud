"""pretrain.py: syllable.py's PhoneHead pre-trained on VCTK (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/pretrain.py <targets dir> <run dir> [--steps N] [--speakers N]

Reads vctk.py's per-speaker pickles from <targets dir>. The speakers named in gate-set.json
(heldOutSpeakers) are never trained on: they're the held-out set, scored against the rules
(a zero output) every 500 steps, and the best checkpoint by their loss is kept.

The model, its inputs and its targets are syllable.py's exactly (PhoneHead, phone_inputs, the
capped per-phone targets, the same loss and weights), so the checkpoint, <run dir>/pretrain.pt,
has syllable.pt's shape: { net, PH }, and syllable.py can start from it (the fine-tune on David)
and export-net.py can export it. The only differences are batching (padded, packed sequences,
64 lines a step, on the GPU) and the data. VCTK's targets are already centred per line: pitch
on the line's median (the speaker's register out), durations on the line's median ratio
(speaking rate out).

--speakers N trains on the first N training speakers only, for a quick check.
"""
import copy, json, pickle, sys, time
from pathlib import Path
import numpy as np
import torch
from torch.nn.utils.rnn import pad_sequence, pack_padded_sequence, pad_packed_sequence
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import syllable

DEV = syllable.DEV
W = torch.tensor([1.0, 1.0, 0.5], device=DEV)      # syllable.py's weights: duration, pitch, loudness


def rows_to_tensors(rows, PH):
    out = []
    for r in rows:
        ph, ex = syllable.phone_inputs(r['codes'], r['rdur'], r['acc'], PH)
        out.append((ph[0], ex[0], torch.tensor(r['tgt'])))
    return out


def batch(items):
    lens = torch.tensor([len(p) for p, _, _ in items])
    ph = pad_sequence([p for p, _, _ in items], batch_first=True).to(DEV)
    ex = pad_sequence([e for _, e, _ in items], batch_first=True).to(DEV)
    y = pad_sequence([t for _, _, t in items], batch_first=True, padding_value=float('nan')).to(DEV)
    return ph, ex, y, lens


def forward(net, ph, ex, lens):
    """PhoneHead.forward over a padded batch; padding never reaches the bidirectional GRU."""
    x = torch.cat([net.emb(ph), ex], -1)
    h, _ = net.gru(pack_padded_sequence(x, lens, batch_first=True, enforce_sorted=False))
    h, _ = pad_packed_sequence(h, batch_first=True, total_length=ph.shape[1])
    return torch.tanh(net.out(h))


def loss_of(p, y):
    m = ~torch.isnan(y)
    return torch.nn.functional.smooth_l1_loss((p * W)[m], (y * W)[m], beta=0.2)


def scores(net, items, zero=False):
    """syllable.py's held-out numbers: duration RMS log error, vowel pitch median error in
    cents, vowel level mean error in dB."""
    de, ce, ge = [], [], []
    net.eval()
    with torch.no_grad():
        for k in range(0, len(items), 256):
            ph, ex, y, lens = batch(items[k:k + 256])
            p = torch.zeros_like(y) if zero else forward(net, ph, ex, lens)
            for j, (lst, lim) in enumerate(((de, syllable.DLIM), (ce, syllable.CLIM), (ge, syllable.GLIM))):
                m = ~torch.isnan(y[..., j]); lst += ((p[..., j][m] - y[..., j][m]).abs() * lim).tolist()
    return np.sqrt(np.mean(np.square(de))), np.median(ce), np.mean(ge)


def held_loss(net, items):
    net.eval(); tot, n = 0.0, 0
    with torch.no_grad():
        for k in range(0, len(items), 256):
            ph, ex, y, lens = batch(items[k:k + 256])
            tot += loss_of(forward(net, ph, ex, lens), y).item() * len(items[k:k + 256]); n += len(items[k:k + 256])
    return tot / n


def main():
    args = sys.argv[1:]
    opt = {}
    for flag in ('--steps', '--speakers'):
        if flag in args:
            k = args.index(flag); opt[flag] = int(args[k + 1]); del args[k:k + 2]
    tdir, run = Path(args[0]), Path(args[1])
    run.mkdir(parents=True, exist_ok=True)
    held = set(json.load(open(HERE / 'gate-set.json'))['heldOutSpeakers'])
    PH = syllable.PHONES
    trn_rows, test_rows = [], []
    files = sorted(tdir.glob('*.pkl'))   # p225 ... p376, and s5
    n_trn_spk = 0
    for f in files:
        spk = f.stem
        if spk in held:
            test_rows += pickle.load(open(f, 'rb'))
        elif n_trn_spk < opt.get('--speakers', 10 ** 9):
            trn_rows += pickle.load(open(f, 'rb')); n_trn_spk += 1
    codes = {c for r in trn_rows + test_rows for c in r['codes']}
    if codes - set(PH):
        raise ValueError(f'phones missing from syllable.PHONES: {sorted(codes - set(PH))}')
    trn, test = rows_to_tensors(trn_rows, PH), rows_to_tensors(test_rows, PH)
    print(f'{len(trn)} training lines from {n_trn_spk} speakers, {len(test)} held out from {len(held & {f.stem for f in files})} speakers, {DEV}', flush=True)
    if not trn or not test:
        raise SystemExit('need training and held-out speakers both')

    torch.manual_seed(0); rng = np.random.default_rng(0)
    net = syllable.PhoneHead(len(PH)).to(DEV)
    optim = torch.optim.Adam(net.parameters(), lr=2e-3, weight_decay=1e-4)
    steps = opt.get('--steps', 20000)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(optim, steps)
    best, t0, B = (1e9, None, 0), time.time(), 64
    z = scores(net, test, zero=True)
    print(f'rules alone on held-out speakers: duration {z[0]:.3f}, pitch {z[1]:.0f} cents, level {z[2]:.2f} dB', flush=True)
    for s in range(steps):
        net.train()
        ph, ex, y, lens = batch([trn[i] for i in rng.integers(len(trn), size=B)])
        L = loss_of(forward(net, ph, ex, lens), y)
        optim.zero_grad(); L.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
        optim.step(); sched.step()
        if s % 500 == 499 or s == steps - 1:
            v = held_loss(net, test)
            if v < best[0]:
                best = (v, copy.deepcopy(net.state_dict()), s + 1)
                torch.save({'net': best[1], 'PH': PH, 'step': s + 1, 'data': 'VCTK 0.92 (CC BY 4.0)'}, run / 'pretrain.pt')
            print(f'step {s + 1}: train {L.item():.4f}, held out {v:.4f} (best {best[0]:.4f} at {best[2]}), {time.time() - t0:.0f} s', flush=True)
    net.load_state_dict(best[1])
    c = scores(net, test)
    print(f'held out (step {best[2]}): duration RMS log error {z[0]:.3f} -> {c[0]:.3f}, '
          f'vowel pitch median error {z[1]:.0f} -> {c[1]:.0f} cents, vowel level {z[2]:.2f} -> {c[2]:.2f} dB')


if __name__ == '__main__':
    main()
