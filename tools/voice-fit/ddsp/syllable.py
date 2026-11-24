"""syllable.py: the prosody controller per phone, not per frame.

  <venv python> tools/voice-fit/ddsp/syllable.py <run dir> [--demo <wav>]

prosody.py's frame head learned pitch frame by frame from noisy targets (the rules miss
the speaker by a median 200 cents a frame, much of it tracker slips and 10 ms alignment),
and wobbled pitch inside words: Whisper's word error rose from 39% to 52%. Intonation
moves per syllable, so this head reads the line's phones (one step per phone, as the
duration head does) and gives three numbers for each:

  duration  log ratio on the rules' duration, capped at +-30%
  pitch     cents, read only on vowels; between vowel centres the correction is joined
            linearly, so pitch can't move inside a vowel or jump at a consonant
  loudness  dB on av, ah and af together, joined the same way

Targets are per phone: the speaker's duration over the rules', and the median of the
frame targets (prosody.targets) over the vowel's frames. Evaluated and gated as
prosody.py does, through the real worklet with the predicted durations.
"""
import copy, json, math, subprocess, sys
from pathlib import Path
import numpy as np
import torch
import torch.nn as nn
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import data, twin, train, prosody

DEV = 'cuda' if torch.cuda.is_available() else 'cpu'
VOW = {'IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'UH', 'UW', 'ER', 'AH', 'AX', 'EY', 'AY', 'OW', 'OY', 'AW', 'IX', 'AXR'}
DLIM, CLIM, GLIM = math.log(1.3), 250.0, 6.0


class PhoneHead(nn.Module):
    def __init__(self, nph, h=64):
        super().__init__()
        self.emb = nn.Embedding(nph, 16)
        self.gru = nn.GRU(16 + 4, h, num_layers=2, batch_first=True, bidirectional=True, dropout=0.2)
        self.out = nn.Linear(2 * h, 3)
        nn.init.zeros_(self.out.weight); nn.init.zeros_(self.out.bias)

    def forward(self, ph, ex):
        h, _ = self.gru(torch.cat([self.emb(ph), ex], -1))
        return torch.tanh(self.out(h))


def phone_inputs(codes, rdur, acc, PH):
    n = len(codes)
    ph = torch.tensor([PH.index(p) if p in PH else 0 for p in codes])[None]
    ex = torch.tensor(np.c_[np.log(np.maximum(rdur, 1e-3)) / 3, acc, np.linspace(0, 1, n), [1.0 if p in VOW else 0.0 for p in codes]], dtype=torch.float32)[None]
    return ph, ex


def phone_targets(it):
    y = prosody.targets(it)                       # frame targets, scaled by prosody's limits
    d = np.array([(a, b) for (a, b, _, _) in it['durs']])
    codes = [p for (_, _, p, _) in it['durs']]
    # frame -> phone, on the speaker's timing (data.load's warp)
    s = np.concatenate([[0], np.cumsum(d[:, 1])])
    t = np.arange(len(y)) * it['frame']
    pi = np.clip(np.searchsorted(s, t, side='right') - 1, 0, len(codes) - 1)
    out = np.full((len(codes), 3), np.nan, np.float32)
    ok = (d[:, 0] > 0.015) & (d[:, 1] > 0.015)
    out[ok, 0] = np.clip(np.log(d[ok, 1] / d[ok, 0]), -DLIM, DLIM) / DLIM
    for i, p in enumerate(codes):
        if p not in VOW:
            continue
        m = pi == i
        c, g = y[m, 0] * prosody.LIM_C, y[m, 1] * prosody.LIM_DB
        if np.isfinite(c).sum() >= 3:
            out[i, 1] = np.clip(np.nanmedian(c), -CLIM, CLIM) / CLIM
        if np.isfinite(g).sum() >= 3:
            out[i, 2] = np.clip(np.nanmedian(g), -GLIM, GLIM) / GLIM
    return out, codes, d


def frame_curve(vals, codes, s, n, frame):
    """Per-vowel values joined linearly between vowel centres, held flat past the ends."""
    cs = [(s[i] + s[i + 1]) / 2 for i, p in enumerate(codes) if p in VOW]
    vs = [vals[i] for i, p in enumerate(codes) if p in VOW]
    if not cs:
        return np.zeros(n)
    return np.interp(np.arange(n) * frame, cs, vs)


def main():
    run = Path(sys.argv[1]); run.mkdir(parents=True, exist_ok=True)
    vf = HERE.parent
    items = data.load(vf / 'out/nn/r3', vf / 'out/nn/align3.json', 'C:/Users/david/Desktop/part3.wav')
    test = items[::10]; trn = [it for i, it in enumerate(items) if i % 10]
    val = trn[::8]; trn = [it for i, it in enumerate(trn) if i % 8]
    PH = train.phone_set(items)
    torch.manual_seed(0); np.random.seed(0)
    for it in items:
        tgt, codes, d = phone_targets(it)
        ph, ex = phone_inputs(codes, d[:, 0], [a for (_, _, _, a) in it['durs']], PH)
        it['P'] = (ph.to(DEV), ex.to(DEV), torch.tensor(tgt).to(DEV))
    net = PhoneHead(len(PH)).to(DEV)
    opt = torch.optim.Adam(net.parameters(), lr=2e-3, weight_decay=1e-4)
    W = torch.tensor([1.0, 1.0, 0.5], device=DEV)

    def loss(its, train_=False):
        tot, n = 0, 0
        for it in its:
            ph, ex, y = it['P']
            p = net(ph, ex)[0]; m = ~torch.isnan(y)
            e = torch.nn.functional.smooth_l1_loss((p * W)[m], (y * W)[m], beta=0.2)
            tot = tot + e; n += 1
        return tot / n

    def scores(its, zero=False):
        de, ce, ge = [], [], []
        for it in its:
            ph, ex, y = it['P']
            with torch.no_grad():
                p = torch.zeros_like(y) if zero else net(ph, ex)[0]
            for j, (lst, lim) in enumerate(((de, DLIM), (ce, CLIM), (ge, GLIM))):
                m = ~torch.isnan(y[:, j]); lst += ((p[m, j] - y[m, j]).abs() * lim).tolist()
        return np.sqrt(np.mean(np.square(de))), np.median(ce), np.mean(ge)

    best = (1e9, None, 0)
    for s in range(4000):
        net.train()
        L = loss([trn[np.random.randint(len(trn))] for _ in range(4)])
        opt.zero_grad(); L.backward(); opt.step()
        if s % 100 == 99:
            net.eval()
            with torch.no_grad():
                v = loss(val).item()
            if v < best[0]:
                best = (v, copy.deepcopy(net.state_dict()), s + 1)
    net.load_state_dict(best[1]); net.eval()
    z, c = scores(test, True), scores(test)
    print(f'held out (step {best[2]}): duration RMS log error {z[0]:.3f} -> {c[0]:.3f}, vowel pitch median error {z[1]:.0f} -> {c[1]:.0f} cents, vowel level {z[2]:.2f} -> {c[2]:.2f} dB')
    torch.save({'net': net.state_dict(), 'PH': PH}, run / 'syllable.pt')

    idx = json.load(open(vf / 'out/nn/r3/index.json'))
    jobs = []
    for it in test:
        L = idx['lines'][it['id']]
        tr0 = np.fromfile(vf / f"out/nn/r3/{it['id']}.f32", dtype=np.float32).reshape(L['frames'], -1)
        trace = [t for t in L['trace'] if t['p'] != 'END']
        r = np.array([t['at'] for t in trace] + [L['frames'] * L['frame']])
        codes = [t['p'] for t in trace]
        ph, ex = phone_inputs(codes, np.diff(r), [1.0 if t.get('acc') else 0.0 for t in trace], PH)
        with torch.no_grad():
            p = net(ph.to(DEV), ex.to(DEV))[0].cpu().numpy()
        V = {'rules': tr0}
        for tag, use_d, use_p in (('dur', 1, 0), ('pitch', 0, 1), ('ctl', 1, 1)):
            dur = np.diff(r) * (np.exp(p[:, 0] * DLIM) if use_d else 1)
            s = np.concatenate([[r[0]], r[0] + np.cumsum(dur)])
            wt, _, _ = prosody.warp(tr0, r, s, L['frame'])
            if use_p:
                n = len(wt)
                cc = frame_curve(p[:, 1] * CLIM, codes, s, n, L['frame'])
                gg = frame_curve(p[:, 2] * GLIM, codes, s, n, L['frame'])
                wt = wt.copy(); wt[:, twin.IX['f0']] *= 2 ** (cc / 1200)
                for k in ('av', 'ah', 'af'):
                    wt[:, twin.IX[k]] *= 10 ** (gg / 20)
            V[tag] = wt
        for tag, tr in V.items():
            f = run / f"{it['id']}-{tag}.f32"; tr.astype(np.float32).tofile(f)
            jobs.append({'f32': str(f), 'frames': len(tr), 'frame': L['frame'], 'k': L['k'], 'names': L['names'], 'po': L.get('po', {}), 'out': str(run / f"{it['id']}-{tag}.raw")})
    json.dump(jobs, open(run / 'jobs.json', 'w'))
    subprocess.run(['node', str(HERE / 'play.mjs'), str(run / 'jobs.json')], check=True)

    from transformers import pipeline
    from scipy.signal import resample_poly
    asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en', device=-1)
    norm = lambda s: ''.join(ch.lower() if ch.isalnum() or ch in " '" else ' ' for ch in s).split()

    def wer(a, b):
        a, b = norm(a), norm(b)
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
            e, n = wer(it['text'], asr({'raw': resample_poly(y, 1, 3).astype(np.float32), 'sampling_rate': 16000})['text'])
            tot[tag][0] += e; tot[tag][1] += n
            if tag in ('rules', 'ctl'):
                demo += [y / (np.abs(y).max() + 1e-9) * 0.8, gap]
        demo.append(gap)
    for k, (e, n) in tot.items():
        print(f'  {k:6} WER {e / n:.1%}')
    w0, w1 = tot['rules'][0] / tot['rules'][1], tot['ctl'][0] / tot['ctl'][1]
    print('gate:', 'PASS' if w1 <= w0 else 'FAIL')
    if '--demo' in sys.argv:
        import wave
        yy = np.concatenate(demo)
        with wave.open(sys.argv[sys.argv.index('--demo') + 1], 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(data.SR)
            w.writeframes((np.clip(yy, -1, 1) * 32767).astype(np.int16).tobytes())


if __name__ == '__main__':
    main()
