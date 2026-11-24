"""cv.py: prosody candidates scored by Whisper over all 65 Part 3 lines, 5-fold.

  <venv python> tools/voice-fit/ddsp/cv.py <run dir> [--demo <dir>]

syllable.py's gate held out 7 lines (62 words): two words either way was noise. Here every
line is held out once: anything learned is trained on the other four folds, and each
candidate is played through the real worklet (play.mjs) and transcribed by Whisper base.en
on the CPU. Candidates are transforms of the rule tracks for one line:

  rules     the tracks as the engine makes them
  comma     the pause at a comma ('_C') cut to 90 ms; David's measured 50 to 130 ms
            (median 80) with silence in only 4 of 11, against the rules' ~300 ms
  table     per-phone duration ratios: the median speaker/rules log ratio for each
            (phone, accented) pair over the training folds, shrunk towards 0 by n/(n+20)
            and capped at +-25%. Medians over many tokens don't carry DTW's boundary noise
  pitch     syllable.py's per-vowel pitch, trained on the other folds
  pitchloud the same with its per-vowel loudness
  and combinations.
"""
import json, math, pickle, subprocess, sys
from pathlib import Path
import numpy as np
import torch
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import data, twin, train, prosody, syllable as SY

VF = HERE.parent
DEV = SY.DEV
COMMA = 0.09


def train_pitch(trn, PH, seed=0):
    torch.manual_seed(seed); np.random.seed(seed)
    val = trn[::8]; tr = [it for i, it in enumerate(trn) if i % 8]
    net = SY.PhoneHead(len(PH)).to(DEV)
    opt = torch.optim.Adam(net.parameters(), lr=2e-3, weight_decay=1e-4)
    W = torch.tensor([0.0, 1.0, 0.5], device=DEV)    # durations not learned here

    def loss(its):
        t = 0
        for it in its:
            ph, ex, y = it['P']; p = net(ph, ex)[0]; m = ~torch.isnan(y)
            t = t + torch.nn.functional.smooth_l1_loss((p * W)[m], (y * W)[m], beta=0.2)
        return t / len(its)
    best = (1e9, None)
    import copy
    for s in range(3000):
        net.train(); L = loss([tr[np.random.randint(len(tr))] for _ in range(4)])
        opt.zero_grad(); L.backward(); opt.step()
        if s % 100 == 99:
            net.eval()
            with torch.no_grad():
                v = loss(val).item()
            if v < best[0]:
                best = (v, copy.deepcopy(net.state_dict()))
    net.load_state_dict(best[1]); net.eval()
    return net


def dur_table(trn):
    acc = {}
    for it in trn:
        for (r, s, p, a) in it['durs']:
            if r > 0.015 and s > 0.015 and p not in ('_', '__', '_C', '_Q', '_QW'):
                acc.setdefault((p, a), []).append(math.log(s / r))
    lim = math.log(1.25)
    return {k: float(np.clip(np.median(v) * len(v) / (len(v) + 20), -lim, lim)) for k, v in acc.items()}


def main():
    run = Path(sys.argv[1]); run.mkdir(parents=True, exist_ok=True)
    pk = VF / 'out/nn/items3.pkl'
    items = pickle.load(open(pk, 'rb')) if pk.exists() else data.load(VF / 'out/nn/r3', VF / 'out/nn/align3.json', 'C:/Users/david/Desktop/part3.wav')
    PH = train.phone_set(items)
    for it in items:
        tgt, codes, d = SY.phone_targets(it)
        ph, ex = SY.phone_inputs(codes, d[:, 0], [a for (_, _, _, a) in it['durs']], PH)
        it['P'] = (ph.to(DEV), ex.to(DEV), torch.tensor(tgt).to(DEV))
    idx = json.load(open(VF / 'out/nn/r3/index.json'))
    K = 5
    jobs, plan = [], []
    for f in range(K):
        test = items[f::K]; trn = [it for i, it in enumerate(items) if i % K != f]
        net = train_pitch(trn, PH); tab = dur_table(trn)
        for it in test:
            L = idx['lines'][it['id']]
            tr0 = np.fromfile(VF / f"out/nn/r3/{it['id']}.f32", dtype=np.float32).reshape(L['frames'], -1)
            trace = [t for t in L['trace'] if t['p'] != 'END']
            r = np.array([t['at'] for t in trace] + [L['frames'] * L['frame']])
            codes = [t['p'] for t in trace]; acc = [1 if t.get('acc') else 0 for t in trace]
            ph, ex = SY.phone_inputs(codes, np.diff(r), acc, PH)
            with torch.no_grad():
                p = net(ph.to(DEV), ex.to(DEV))[0].cpu().numpy()
            rd = np.diff(r)
            comma = np.array([min(COMMA / x, 1.0) if c == '_C' else 1.0 for c, x in zip(codes, rd)])
            table = np.array([math.exp(tab.get((c, a), 0.0)) for c, a in zip(codes, acc)])
            V = {}
            for tag, dm, use_p, use_g in (('rules', 1, 0, 0), ('comma', comma, 0, 0), ('table', table, 0, 0),
                                          ('comma+table', comma * table, 0, 0), ('pitch', 1, 1, 0),
                                          ('pitchloud', 1, 1, 1), ('comma+pitch', comma, 1, 0),
                                          ('all', comma * table, 1, 0)):
                s = np.concatenate([[r[0]], r[0] + np.cumsum(rd * dm)])
                wt, _, _ = prosody.warp(tr0, r, s, L['frame'])
                wt = wt.copy(); n = len(wt)
                if use_p:
                    wt[:, twin.IX['f0']] *= 2 ** (SY.frame_curve(p[:, 1] * SY.CLIM, codes, s, n, L['frame']) / 1200)
                if use_g:
                    g = 10 ** (SY.frame_curve(p[:, 2] * SY.GLIM, codes, s, n, L['frame']) / 20)
                    for k in ('av', 'ah', 'af'):
                        wt[:, twin.IX[k]] *= g
                V[tag] = wt
            for tag, tr in V.items():
                fn = run / f"{it['id']}-{tag}.f32"; tr.astype(np.float32).tofile(fn)
                jobs.append({'f32': str(fn), 'frames': len(tr), 'frame': L['frame'], 'k': L['k'], 'names': L['names'], 'po': L.get('po', {}), 'out': str(run / f"{it['id']}-{tag}.raw")})
            plan.append(it)
        print(f'fold {f} trained', flush=True)
    tags = list(V)
    json.dump(jobs, open(run / 'jobs.json', 'w'))
    subprocess.run(['node', str(HERE / 'play.mjs'), str(run / 'jobs.json')], check=True)

    from transformers import pipeline
    from scipy.signal import resample_poly
    asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en', device=-1)
    norm = lambda s: ''.join(ch.lower() if ch.isalnum() or ch in " '" else ' ' for ch in s).split()

    def wer(a, b):
        a, b = norm(a), norm(b); D = np.arange(len(b) + 1)
        for i in range(1, len(a) + 1):
            prev, D[0] = D.copy(), i
            for j in range(1, len(b) + 1):
                D[j] = min(prev[j] + 1, D[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
        return int(D[len(b)]), len(a)
    per = {}
    for it in plan:
        for tag in tags:
            y = np.fromfile(run / f"{it['id']}-{tag}.raw", dtype=np.float32)
            e, n = wer(it['text'], asr({'raw': resample_poly(y, 1, 3).astype(np.float32), 'sampling_rate': 16000})['text'])
            per.setdefault(tag, []).append((it['id'], e, n))
    json.dump(per, open(run / 'wer.json', 'w'))
    base = np.array([e for (_, e, _) in per['rules']]); N = sum(n for (_, _, n) in per['rules'])
    rng = np.random.default_rng(0)
    for tag in tags:
        e = np.array([x[1] for x in per[tag]]); d = e - base
        bs = [d[rng.integers(0, len(d), len(d))].sum() for _ in range(2000)]
        print(f'  {tag:12} WER {e.sum() / N:.1%}  ({e.sum()} errors; vs rules {d.sum():+d}, 90% CI {np.percentile(bs, 5):+.0f}..{np.percentile(bs, 95):+.0f}; lines better {int((d < 0).sum())} worse {int((d > 0).sum())})')


if __name__ == '__main__':
    main()
