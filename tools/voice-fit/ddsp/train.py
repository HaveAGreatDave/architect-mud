"""train.py: train ORACLE's controller through the twin, against the speaker's recording.

  <venv python> tools/voice-fit/ddsp/train.py <out dir> [--steps N]

Reads the Part 3 lines (out/nn/r3, align3.json, part3.wav); every tenth line is held out.
The frame head adds corrections to the rule tracks, which the twin plays; the loss is a
multi-resolution log-spectral distance to the recording, with the line's level matched
first (the recording's gain is arbitrary), plus a pull towards zero on every correction
(ten times harder on Rd, which the spectrum hardly pins down). The duration head is fitted
on its own, to the log ratio of the speaker's phone durations over the rules'.

Writes <out>/controller.pt, and <out>/report.json with the held-out losses through the
twin, rules against rules plus controller.
"""
import json, math, sys, time
from pathlib import Path
import numpy as np
import torch
import torch.nn as nn
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import twin, data

DEV = 'cuda' if torch.cuda.is_available() else 'cpu'
# What the frame head corrects, and how far it may go (tanh-bounded): name, kind, limit.
OUTS = [('f0', 'cents', 300), ('f1', 'log', 0.25), ('f2', 'log', 0.25), ('f3', 'log', 0.15),
        ('q1', 'log', 0.5), ('q2', 'log', 0.5), ('q3', 'log', 0.5),
        ('av', 'db', 6), ('ah', 'db', 9), ('af', 'db', 6), ('rd', 'log', 0.5), ('tilt', 'log', 0.5)]
REG = {'rd': 10.0, 'av': 4.0, 'af': 4.0, 'ah': 2.0}
# Rule tracks the network reads, and how each is normalised.
INS = [('f0', 'log'), ('av', 'lin'), ('ah', 'lin'), ('af', 'lin'), ('f1', 'log'), ('f2', 'log'), ('f3', 'log'),
       ('nzdb', 'db'), ('closure', 'lin'), ('rd', 'log'), ('tilt', 'log'), ('creak', 'lin')]


def phone_set(items):
    return sorted({p for it in items for p in it['phone_code']} | {p for it in items for (_, _, p, _) in it['durs']})


def features(it, PH):
    tr = it['tracks']
    cols = []
    for name, kind in INS:
        v = tr[:, twin.IX[name]]
        cols.append(np.log(np.maximum(v, 1e-3)) / 5 if kind == 'log' else (np.clip(v, -60, 0) / 30 if kind == 'db' else v))
    oh = np.zeros((len(tr), len(PH)), np.float32)
    for i, p in enumerate(it['phone_code']):
        if p in PH:
            oh[i, PH.index(p)] = 1
    return np.concatenate([np.stack(cols, 1), oh, it['acc'][:, None], it['pos']], 1).astype(np.float32)


class FrameHead(nn.Module):
    def __init__(self, nin, h=96):
        super().__init__()
        self.inp = nn.Linear(nin, h)
        self.convs = nn.ModuleList([nn.Conv1d(h, h, 5, padding=2) for _ in range(3)])
        self.gru = nn.GRU(h, h, batch_first=True, bidirectional=True)
        self.out = nn.Linear(2 * h, len(OUTS))
        nn.init.zeros_(self.out.weight); nn.init.zeros_(self.out.bias)
        # what's the same in every frame (the voice's static difference), apart from what isn't
        self.const = nn.Parameter(torch.zeros(len(OUTS)))

    def frame_part(self, x):
        h = torch.relu(self.inp(x)).transpose(1, 2)
        for c in self.convs:
            h = h + torch.relu(c(h))
        h, _ = self.gru(h.transpose(1, 2))
        return self.out(h)

    def forward(self, x):            # x: (B, F, nin)
        return torch.tanh(self.const + self.frame_part(x))

    def _unused(self, x):
        h = torch.relu(self.inp(x)).transpose(1, 2)
        for c in self.convs:
            h = h + torch.relu(c(h))
        h, _ = self.gru(h.transpose(1, 2))
        return torch.tanh(self.out(h))   # (B, F, len(OUTS)) in -1..1


class DurHead(nn.Module):
    """Per phone: log(speaker / rule duration), from the phone, its neighbours and stress."""
    def __init__(self, nph, h=64):
        super().__init__()
        self.emb = nn.Embedding(nph, 16)
        self.gru = nn.GRU(16 + 3, h, batch_first=True, bidirectional=True)
        self.out = nn.Linear(2 * h, 1)
        nn.init.zeros_(self.out.weight); nn.init.zeros_(self.out.bias)

    def forward(self, ph, extra):
        h, _ = self.gru(torch.cat([self.emb(ph), extra], -1))
        return 0.7 * torch.tanh(self.out(h).squeeze(-1))


def apply(tracks, y):
    """The rule tracks with the head's corrections (y in -1..1) applied."""
    cols = list(tracks.unbind(-1))
    for j, (name, kind, lim) in enumerate(OUTS):
        i, d = twin.IX[name], y[..., j] * lim
        if kind == 'cents':
            cols[i] = cols[i] * torch.pow(2.0, d / 1200)
        elif kind == 'log':
            cols[i] = cols[i] * torch.exp(d)
        else:
            cols[i] = cols[i] * torch.pow(10.0, d / 20)
    return torch.stack(cols, -1)


_MEL = {}


def melbank(N, dev, bands=40, lo=80.0, hi=12000.0):
    """Triangular mel bands wide enough (>= 60 Hz at the bottom) that no harmonic is resolved:
    the loss sees the envelope (formants, tilt, noise against voice), not the pitch."""
    key = (N, str(dev))
    if key not in _MEL:
        f = np.fft.rfftfreq(N, 1 / data.SR)
        mel = lambda h: 2595 * np.log10(1 + h / 700)
        e = np.interp(np.linspace(mel(lo), mel(hi), bands + 2), mel(f), f)
        fb = np.zeros((bands, len(f)))
        for i in range(bands):
            a, c, b = e[i:i + 3]
            fb[i] = np.clip(np.minimum((f - a) / (c - a), (b - f) / (b - c)), 0, None)
        _MEL[key] = torch.tensor(fb / fb.sum(1, keepdims=True), dtype=torch.float32, device=dev)
    return _MEL[key]


def logmel(y, N):
    S = torch.stft(y, N, 240, window=torch.hann_window(N, device=y.device), return_complex=True).abs() ** 2
    return torch.log(melbank(N, y.device) @ S + 1e-8)


CHAN = {}   # the recording chain's colour: one log gain per mel band and window, shared by every line


def spec_loss(y, ref):
    n = min(len(y), len(ref))
    y, ref = y[:n], ref[:n]
    tot = 0
    for N in (1024, 2048):
        A, B = logmel(y, N), logmel(ref, N)
        if N in CHAN:
            A = A + CHAN[N][:, None]
        lv = B.mean(0)
        loud = lv > lv.max() - 7                          # frames within ~30 dB of the loudest
        off = (B - A)[:, loud].median().detach()          # the recording's gain is arbitrary
        tot = tot + (A + off - B)[:, loud].abs().mean()
    return tot / 2


def f0_loss(y_tracks, it):
    """Cents between the corrected F0 and the speaker's, where both are voiced."""
    sp = it['f0t']
    ok = (sp > 0) & (it['tr'][:, twin.IX['av']] > 0.3)
    if ok.sum() < 5:
        return torch.zeros((), device=sp.device)
    c = 1200 * torch.log2(y_tracks[ok, twin.IX['f0']] / sp[ok])
    return (c.abs() / 100).clamp(max=6).mean()


def main():
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    steps = int(sys.argv[sys.argv.index('--steps') + 1]) if '--steps' in sys.argv else 1500
    vf = HERE.parent
    items = data.load(vf / 'out/nn/r3', vf / 'out/nn/align3.json', 'C:/Users/david/Desktop/part3.wav')
    test = items[::10]; train = [it for i, it in enumerate(items) if i % 10]
    PH = phone_set(items)
    torch.manual_seed(0); np.random.seed(0)
    for it in items:
        it['x'] = torch.tensor(features(it, PH))[None].to(DEV)
        it['tr'] = torch.tensor(it['tracks']).to(DEV)
        it['ref'] = torch.tensor(it['audio']).to(DEV)
        it['f0t'] = torch.tensor(it['f0spk'][:len(it['tracks'])]).to(DEV)
        n = int(math.ceil(len(it['tracks']) * it['frame'] * data.SR))
        g = torch.Generator().manual_seed(int(it['id']))
        it['noise'] = twin.pink(torch.rand(n, generator=g) * 2 - 1).to(DEV)

    def loss_of(it, net, reg=True):
        y = net(it['x'])[0] if net else torch.zeros(len(it['tracks']), len(OUTS), device=DEV)
        trk = apply(it['tr'], y)
        # F0 learns from the speaker's measured pitch only: through the spectrum it buys level
        f0d = trk[:, twin.IX['f0']].detach()
        trk_s = torch.cat([trk[:, :twin.IX['f0']], f0d[:, None], trk[:, twin.IX['f0'] + 1:]], 1)
        wav = twin.render(trk_s, it['k'], presence_db=it['presence'], noise=it['noise'])
        L = spec_loss(wav, it['ref']) + 0.3 * f0_loss(trk, it)
        if reg and net:
            w = torch.tensor([REG.get(n, 1.0) for n, _, _ in OUTS], device=DEV)
            fp = net.frame_part(it['x'])[0]
            L = L + 0.002 * (torch.tanh(net.const) ** 2 * w).mean() + 0.05 * (fp ** 2 * w).mean()
        return L

    # Fit the channel first, rules alone, so the controller starts from a fair comparison.
    for N in (1024, 2048):
        CHAN[N] = torch.zeros(40, device=DEV, requires_grad=True)
    copt = torch.optim.Adam(list(CHAN.values()), lr=0.05)
    for s_ in range(150):
        it = train[np.random.randint(len(train))]
        L = loss_of(it, None)
        copt.zero_grad(); L.backward(); copt.step()
    for N in CHAN:
        CHAN[N].requires_grad_(False)
    print('channel (dB, 1024):', (CHAN[1024] * 10 / math.log(10)).round().tolist(), flush=True)
    with torch.no_grad():
        base = {it['id']: loss_of(it, None).item() for it in test}
    print(f'held out, rules alone: {np.mean(list(base.values())):.4f}  ({len(train)} train, {len(test)} test, {len(PH)} phones, {DEV})', flush=True)

    net = FrameHead(train[0]['x'].shape[-1]).to(DEV)
    print('frame head weights', sum(p.numel() for p in net.parameters()), flush=True)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    t0 = time.time()
    hist = []
    import copy
    best = (1e9, None)
    for s in range(steps):
        it = train[np.random.randint(len(train))]
        L = loss_of(it, net)
        opt.zero_grad(); L.backward(); torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0); opt.step()
        if s % 50 == 49 or s == steps - 1:
            with torch.no_grad():
                te = np.mean([loss_of(it, net, reg=False).item() for it in test])
            hist.append((s + 1, te))
            if te < best[0]:
                best = (te, copy.deepcopy(net.state_dict()))
            print(f'step {s + 1}: held out {te:.4f}  ({time.time() - t0:.0f} s)', flush=True)

    net.load_state_dict(best[1])
    print(f'kept the best: held out {best[0]:.4f}', flush=True)
    # durations
    dnet = DurHead(len(PH)).to(DEV)
    dopt = torch.optim.Adam(dnet.parameters(), lr=3e-3)
    def dbatch(it):
        ph = torch.tensor([PH.index(p) for (_, _, p, _) in it['durs']], device=DEV)[None]
        d = np.array([(a, b, c) for (a, b, _, c) in it['durs']])
        ok = (d[:, 0] > 0.015) & (d[:, 1] > 0.015)
        tgt = torch.tensor(np.log(np.maximum(d[:, 1], 1e-3) / np.maximum(d[:, 0], 1e-3)), dtype=torch.float32, device=DEV)
        ex = torch.tensor(np.c_[np.log(np.maximum(d[:, 0], 1e-3)) / 3, d[:, 2], np.linspace(0, 1, len(d))], dtype=torch.float32, device=DEV)[None]
        return ph, ex, tgt, torch.tensor(ok, device=DEV)
    for s in range(3000):
        ph, ex, tgt, ok = dbatch(train[np.random.randint(len(train))])
        L = ((dnet(ph, ex)[0] - tgt)[ok] ** 2).mean()
        dopt.zero_grad(); L.backward(); dopt.step()
    with torch.no_grad():
        rb, rn = [], []
        for it in test:
            ph, ex, tgt, ok = dbatch(it)
            rb.append(((tgt[ok]) ** 2).mean().item()); rn.append(((dnet(ph, ex)[0] - tgt)[ok] ** 2).mean().item())
    print(f'durations, held out RMS log error: rules {math.sqrt(np.mean(rb)):.3f}, with head {math.sqrt(np.mean(rn)):.3f}')

    torch.save({'chan': {N: v.cpu() for N, v in CHAN.items()}, 'frame': net.state_dict(), 'dur': dnet.state_dict(), 'PH': PH, 'nin': train[0]['x'].shape[-1]}, out / 'controller.pt')
    with torch.no_grad():
        after = {it['id']: loss_of(it, net, reg=False).item() for it in test}
        # what the head does, on average, held out
        ys = torch.cat([net(it['x'])[0] for it in test])
        mean_corr = {n: round(float((ys[:, j] * lim).mean()), 3) for j, (n, _, lim) in enumerate(OUTS)}
        rms_corr = {n: round(float((ys[:, j] * lim).std()), 3) for j, (n, _, lim) in enumerate(OUTS)}   # frame to frame
    json.dump({'test': [it['id'] for it in test], 'rules': base, 'controller': after, 'history': hist,
               'mean_correction': mean_corr, 'rms_correction': rms_corr,
               'dur_rms': [math.sqrt(np.mean(rb)), math.sqrt(np.mean(rn))]}, open(out / 'report.json', 'w'), indent=1)
    print('mean correction', mean_corr)
    print('frame-to-frame spread', rms_corr)


if __name__ == '__main__':
    main()
