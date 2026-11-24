"""prosody.py: ORACLE's controller, prosody only, trained directly on measured targets.

  <venv python> tools/voice-fit/ddsp/prosody.py <run dir> [--demo <wav>]

The first cut (train.py) learned formant corrections through the twin against the
recording, and smeared words: a spectral loss rewards blurring towards a room-coloured
average and has no idea what a word is. This one leaves every formant alone and learns
only what makes speech sound robotic, from numbers measured on the speaker:

  pitch     per 5 ms frame, cents between the speaker's F0 and the rules' (data.pitch),
            where both are voiced; octave slips (over 700 cents) are dropped.
  loudness  per frame, the speaker's level against its own line median, minus the rules'
            against theirs (the rules played by the twin), in dB, voiced frames only.
  duration  per phone, log of the speaker's duration over the rules' (align.py).

The frame head outputs F0 in cents and one gain in dB on av, ah and af together; the
duration head a log ratio per phone. Both start at zero, so an untrained controller is the
rules. Evaluation is through the REAL worklet with the PREDICTED durations (as the game
would play it, not the speaker's timing), and it's gated by Whisper: the word error rate
of the held-out lines may not rise over the rules'.
"""
import copy, json, math, subprocess, sys
from pathlib import Path
import numpy as np
import torch
import torch.nn as nn
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import data, twin, train

DEV = 'cuda' if torch.cuda.is_available() else 'cpu'
LIM_C, LIM_DB = 400.0, 9.0


class Head(nn.Module):
    def __init__(self, nin, nout, h=96):
        super().__init__()
        self.inp = nn.Linear(nin, h)
        self.convs = nn.ModuleList([nn.Conv1d(h, h, 5, padding=2) for _ in range(3)])
        self.gru = nn.GRU(h, h, batch_first=True, bidirectional=True)
        self.out = nn.Linear(2 * h, nout)
        nn.init.zeros_(self.out.weight); nn.init.zeros_(self.out.bias)

    def forward(self, x):
        h = torch.relu(self.inp(x)).transpose(1, 2)
        for c in self.convs:
            h = h + torch.relu(c(h))
        h, _ = self.gru(h.transpose(1, 2))
        return torch.tanh(self.out(h))


def level_db(y, n, frame):
    """Frame level in dB, 25 ms RMS centred on each 5 ms frame."""
    w = int(0.025 * data.SR)
    out = np.full(n, -120.0)
    for i in range(n):
        c = int(i * frame * data.SR); s = y[max(0, c - w // 2):c + w // 2]
        if len(s):
            out[i] = 10 * np.log10((s.astype(np.float64) ** 2).mean() + 1e-12)
    return out


def medfilt(v, k=5):
    p = np.pad(v, k // 2, mode='edge')
    return np.array([np.median(p[i:i + k]) for i in range(len(v))])


def targets(it):
    tr = it['tracks']; n = len(tr)
    av = tr[:, twin.IX['av']]
    sp = it['f0spk'][:n]; rf = tr[:, twin.IX['f0']]
    c = np.where((sp > 0) & (av > 0.3), 1200 * np.log2(np.maximum(sp, 1) / np.maximum(rf, 1)), np.nan)
    c[np.abs(c) > 700] = np.nan
    ok = ~np.isnan(c)
    cs = c.copy(); cs[ok] = medfilt(c[ok]) if ok.sum() > 5 else c[ok]
    with torch.no_grad():
        y = twin.render(torch.tensor(tr), it['k'], presence_db=it['presence'], seed=int(it['id'])).numpy()
    ls, lr = level_db(it['audio'], n, it['frame']), level_db(y, n, it['frame'])
    v = (av > 0.3) & (ls > ls.max() - 35)
    d = np.full(n, np.nan)
    if v.sum() > 5:
        d[v] = medfilt((ls[v] - np.median(ls[v])) - (lr[v] - np.median(lr[v])))
    d = np.clip(d, -LIM_DB, LIM_DB)
    return np.stack([cs / LIM_C, d / LIM_DB], 1).astype(np.float32)


def apply(tracks, y):
    t = tracks.copy()
    t[:, twin.IX['f0']] *= 2 ** (y[:, 0] * LIM_C / 1200)
    g = 10 ** (y[:, 1] * LIM_DB / 20)
    for k in ('av', 'ah', 'af'):
        t[:, twin.IX[k]] *= g
    return t


def warp(tracks, r, s, frame):
    """Tracks re-timed so the phone boundaries r (seconds, rising) fall at s."""
    n = int(np.ceil(s[-1] / frame)); t = np.arange(n) * frame
    rt = np.interp(t, s, r); fi = np.clip(rt / frame, 0, len(tracks) - 1)
    i0 = np.floor(fi).astype(int); i1 = np.minimum(i0 + 1, len(tracks) - 1); u = (fi - i0)[:, None]
    return (tracks[i0] * (1 - u) + tracks[i1] * u).astype(np.float32), t, rt


def main():
    run = Path(sys.argv[1]); run.mkdir(parents=True, exist_ok=True)
    vf = HERE.parent
    items = data.load(vf / 'out/nn/r3', vf / 'out/nn/align3.json', 'C:/Users/david/Desktop/part3.wav')
    test = items[::10]; trn = [it for i, it in enumerate(items) if i % 10]
    val = trn[::8]; trn = [it for i, it in enumerate(trn) if i % 8]   # checkpoint on val, report on test
    PH = train.phone_set(items)
    torch.manual_seed(0); np.random.seed(0)
    for it in items:
        it['x'] = torch.tensor(train.features(it, PH))[None].to(DEV)
        it['y'] = torch.tensor(targets(it)).to(DEV)
    print(f'{len(trn)} train, {len(val)} validate, {len(test)} test', flush=True)

    def floss(net, it):
        p = net(it['x'])[0]; y = it['y']; m = ~torch.isnan(y)
        e = torch.nn.functional.smooth_l1_loss(p[m], y[m], beta=0.1)
        return e + 0.01 * (p ** 2).mean()

    def err(net, its):
        """Held-out: median |pitch error| in cents and mean |level error| in dB, against the targets."""
        ce, de = [], []
        for it in its:
            with torch.no_grad():
                p = net(it['x'])[0] if net else torch.zeros_like(it['y'])
            y = it['y']
            m0, m1 = ~torch.isnan(y[:, 0]), ~torch.isnan(y[:, 1])
            ce += ((p[m0, 0] - y[m0, 0]).abs() * LIM_C).tolist(); de += ((p[m1, 1] - y[m1, 1]).abs() * LIM_DB).tolist()
        return float(np.median(ce)), float(np.mean(de))

    net = Head(trn[0]['x'].shape[-1], 2).to(DEV)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    best = (1e9, None)
    for s in range(3000):
        it = trn[np.random.randint(len(trn))]
        L = floss(net, it); opt.zero_grad(); L.backward(); opt.step()
        if s % 100 == 99:
            c, d = err(net, val); sc = c / 100 + d
            if sc < best[0]:
                best = (sc, copy.deepcopy(net.state_dict()), s + 1)
    net.load_state_dict(best[1]); net.eval()
    r0, r1 = err(None, test), err(net, test)
    print(f'pitch, held out median error: rules {r0[0]:.0f} cents, controller {r1[0]:.0f} (step {best[2]})')
    print(f'loudness, held out mean error: rules {r0[1]:.2f} dB, controller {r1[1]:.2f}')

    # durations: on phones, the speaker's over the rules'
    dnet = train.DurHead(len(PH)).to(DEV)
    dopt = torch.optim.Adam(dnet.parameters(), lr=3e-3)

    def db(it):
        ph = torch.tensor([PH.index(p) for (_, _, p, _) in it['durs']], device=DEV)[None]
        d = np.array([(a, b, c) for (a, b, _, c) in it['durs']])
        ok = (d[:, 0] > 0.015) & (d[:, 1] > 0.015)
        tgt = torch.tensor(np.log(np.maximum(d[:, 1], 1e-3) / np.maximum(d[:, 0], 1e-3)), dtype=torch.float32, device=DEV)
        ex = torch.tensor(np.c_[np.log(np.maximum(d[:, 0], 1e-3)) / 3, d[:, 2], np.linspace(0, 1, len(d))], dtype=torch.float32, device=DEV)[None]
        return ph, ex, tgt, torch.tensor(ok, device=DEV), d

    def dval(its, net_):
        e = []
        for it in its:
            ph, ex, tgt, ok, _ = db(it)
            with torch.no_grad():
                p = net_(ph, ex)[0] if net_ else torch.zeros_like(tgt)
            e += ((p - tgt)[ok] ** 2).tolist()
        return math.sqrt(np.mean(e))
    dbest = (1e9, None)
    for s in range(3000):
        ph, ex, tgt, ok, _ = db(trn[np.random.randint(len(trn))])
        L = torch.nn.functional.smooth_l1_loss(dnet(ph, ex)[0][ok], tgt[ok], beta=0.2)
        dopt.zero_grad(); L.backward(); dopt.step()
        if s % 100 == 99:
            v = dval(val, dnet)
            if v < dbest[0]:
                dbest = (v, copy.deepcopy(dnet.state_dict()))
    dnet.load_state_dict(dbest[1]); dnet.eval()
    print(f'durations, held out RMS log error: rules {dval(test, None):.3f}, controller {dval(test, dnet):.3f}')
    torch.save({'frame': net.state_dict(), 'dur': dnet.state_dict(), 'PH': PH, 'nin': trn[0]['x'].shape[-1]}, run / 'prosody.pt')

    # ── the game's way: rule tracks re-timed by the predicted durations, then corrected ──
    idx = json.load(open(vf / 'out/nn/r3/index.json'))
    jobs = []
    for it in test:
        L = idx['lines'][it['id']]
        tr0 = np.fromfile(vf / f"out/nn/r3/{it['id']}.f32", dtype=np.float32).reshape(L['frames'], -1)
        trace = [t for t in L['trace'] if t['p'] != 'END']
        r = np.array([t['at'] for t in trace] + [L['frames'] * L['frame']])
        ph, ex, _, _, d = db(it)
        with torch.no_grad():
            ratio = np.exp(dnet(ph, ex)[0].cpu().numpy())
        dur = np.diff(r)
        dur[:len(ratio)] *= ratio
        s = np.concatenate([[r[0]], r[0] + np.cumsum(dur)])
        wt, t, rt = warp(tr0, r, s, L['frame'])
        # features on the new timing, as the game would compute them
        pi = np.clip(np.searchsorted(s, t, side='right') - 1, 0, len(trace) - 1)
        span = np.maximum(s[pi + 1] - s[pi], 1e-3)
        feat = {'tracks': wt, 'phone_code': [trace[i]['p'] for i in pi],
                'acc': np.array([1.0 if trace[i].get('acc') else 0.0 for i in pi], np.float32),
                'pos': np.stack([(t - s[pi]) / span, t / s[-1]], 1).astype(np.float32)}
        with torch.no_grad():
            y = net(torch.tensor(train.features(feat, PH))[None].to(DEV))[0].cpu().numpy()
        ctl = apply(wt, y)
        # the two halves apart: durations alone, and pitch and loudness alone on the rules' timing
        pr = np.clip(np.searchsorted(r, np.arange(L['frames']) * L['frame'], side='right') - 1, 0, len(trace) - 1)
        sp_ = np.maximum(r[pr + 1] - r[pr], 1e-3); tt = np.arange(L['frames']) * L['frame']
        f0 = {'tracks': tr0, 'phone_code': [trace[i]['p'] for i in pr],
              'acc': np.array([1.0 if trace[i].get('acc') else 0.0 for i in pr], np.float32),
              'pos': np.stack([(tt - r[pr]) / sp_, tt / r[-1]], 1).astype(np.float32)}
        with torch.no_grad():
            y0 = net(torch.tensor(train.features(f0, PH))[None].to(DEV))[0].cpu().numpy()
        VARIANTS = {'rules': tr0, 'dur': wt, 'pitch': apply(tr0, y0), 'ctl': ctl}
        for tag, tr in VARIANTS.items():
            f = run / f"{it['id']}-{tag}.f32"; tr.astype(np.float32).tofile(f)
            jobs.append({'f32': str(f), 'frames': len(tr), 'frame': L['frame'], 'k': L['k'], 'names': L['names'], 'po': L.get('po', {}), 'out': str(run / f"{it['id']}-{tag}.raw")})
    json.dump(jobs, open(run / 'jobs.json', 'w'))
    subprocess.run(['node', str(HERE / 'play.mjs'), str(run / 'jobs.json')], check=True)

    # ── Whisper gate ──
    from transformers import pipeline
    asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en', device=-1)
    from scipy.signal import resample_poly
    norm = lambda s: [w for w in ''.join(ch.lower() if ch.isalnum() or ch in " '" else ' ' for ch in s).split()]

    def wer(ref, hyp):
        a, b = norm(ref), norm(hyp)
        D = np.arange(len(b) + 1)
        for i in range(1, len(a) + 1):
            prev, D[0] = D.copy(), i
            for j in range(1, len(b) + 1):
                D[j] = min(prev[j] + 1, D[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
        return D[len(b)], len(a)
    tot = {k: [0, 0] for k in ('rules', 'dur', 'pitch', 'ctl')}
    demo, gap = [], np.zeros(int(0.5 * data.SR), np.float32)
    for it in test:
        demo += [it['audio'] / (np.abs(it['audio']).max() + 1e-9) * 0.8, gap]
        for tag in tot:
            y = np.fromfile(run / f"{it['id']}-{tag}.raw", dtype=np.float32)
            h = asr({'raw': resample_poly(y, 1, 3).astype(np.float32), 'sampling_rate': 16000})['text']
            e, n = wer(it['text'], h); tot[tag][0] += e; tot[tag][1] += n
            print(f'  {tag:5} {e}/{n}  {h.strip()}')
            if tag in ('rules', 'ctl'):
                demo += [y / (np.abs(y).max() + 1e-9) * 0.8, gap]
        demo.append(gap)
    for k, (e, n) in tot.items():
        print(f'  {k:6} WER {e / n:.1%}')
    w0, w1 = tot['rules'][0] / tot['rules'][1], tot['ctl'][0] / tot['ctl'][1]
    print(f'Whisper word error rate, held out: rules {w0:.1%}, controller {w1:.1%}  ->  {"PASS" if w1 <= w0 else "FAIL"}')
    if '--demo' in sys.argv:
        import wave
        yy = np.concatenate(demo)
        with wave.open(sys.argv[sys.argv.index('--demo') + 1], 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(data.SR)
            w.writeframes((np.clip(yy, -1, 1) * 32767).astype(np.int16).tobytes())


if __name__ == '__main__':
    main()
