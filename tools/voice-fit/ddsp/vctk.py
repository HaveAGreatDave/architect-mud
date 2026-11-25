"""vctk.py: VCTK's lines as training targets for syllable.py (docs/proposals/oracle-teacher.md).

  python ddsp/vctk.py <vctk dir> <export dir> <out dir> [--limit N] [--speakers p225,p226]

Reads, for each line:
  <vctk dir>/mfa/lines.json, phone-table.json    from vctk-dict.mjs
  <vctk dir>/mfa/aligned/<spk>/<line>.TextGrid   MFA's phones on the recording
  <export dir>/index.json, <id>.f32              export.mjs --tracks-only: ORACLE's rule tracks
                                                 and phone trace for the same text
  <vctk dir>/wav48_silence_trimmed/<spk>/<line>_mic1.flac

Pairs ORACLE's trace with MFA's phones by edit distance over the phone table, gives each
word gap ('_') the silence MFA found there, warps the tracks with data.item, and measures
per-phone targets with syllable.phone_targets. The speaker's pitch is scaled so its median
matches the rules' on the line: the targets are the shape of the line's pitch, not the
speaker's register (which is kept apart as `reg`, in cents).

Writes <out dir>/<spk>.pkl: a list of
  { name, spk, id, codes, rdur, sdur, acc, tgt (phones x 3, NaN where unmeasured), reg, rate, dlog }
(reg: the speaker's pitch over the rules', cents; rate: the line's median log duration ratio;
dlog: each phone's log duration ratio less rate, uncapped, NaN under 15 ms; tgt's column 0 is it capped)
and <out dir>/log.json with why every dropped line was dropped.
"""
import json, pickle, re, sys, time
from pathlib import Path
from collections import Counter
import numpy as np
import soundfile as sf
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

F0_RANGE = (60, 500)        # VCTK has women and children's-range voices; David's tracker stops at 300
MAX_EDITS = 2               # inserted or deleted phones a line may have before it's dropped


def textgrid_phones(p):
    """The phones tier of an MFA long TextGrid: [(label, start, end)]."""
    t = Path(p).read_text(encoding='utf-8')
    tier = t[t.index('name = "phones"'):]
    out = []
    for m in re.finditer(r'xmin = ([\d.]+)\s+xmax = ([\d.]+)\s+text = "([^"]*)"', tier):
        out.append((m.group(3), float(m.group(1)), float(m.group(2))))
    return out


def pair(a, b):
    """Edit-distance alignment of a and b. Returns [(i or None, j or None)]."""
    n, m = len(a), len(b)
    D = np.zeros((n + 1, m + 1), int); D[:, 0] = np.arange(n + 1); D[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j - 1] + (a[i - 1] != b[j - 1]), D[i - 1, j] + 1, D[i, j - 1] + 1)
    i, j, out = n, m, []
    while i or j:
        if i and j and D[i, j] == D[i - 1, j - 1] + (a[i - 1] != b[j - 1]):
            out.append((i - 1, j - 1)); i -= 1; j -= 1
        elif i and D[i, j] == D[i - 1, j] + 1:
            out.append((i - 1, None)); i -= 1
        else:
            out.append((None, j - 1)); j -= 1
    return out[::-1]


def timing(trace, tg, table):
    """align.py's phone list for the trace, from MFA's phones, or (None, why)."""
    if trace and trace[-1]['p'] == 'END':
        trace = trace[:-1]
    phones = [(l, s, e) for (l, s, e) in tg if l not in ('', 'sil', 'sp', 'spn')]
    real = [k for k, t in enumerate(trace) if not t['p'].startswith('_')]
    a = [table.get(trace[k]['p'], '?') for k in real]
    b = [re.sub(r'\d', '', l) for (l, _, _) in phones]
    pr = pair(a, b)
    if sum(1 for i, j in pr if i is None or j is None) > MAX_EDITS:
        return None, 'mismatch'
    times = {}
    for i, j in pr:
        if i is not None and j is not None:
            times[real[i]] = (phones[j][1], phones[j][2])
    out, k = [], 0
    for k, t in enumerate(trace):
        if k in times:
            s, e = times[k]
        else:
            # a gap, or a phone MFA didn't say: from the previous phone's end to the next one's start
            prev = next((times[q][1] for q in range(k - 1, -1, -1) if q in times), None)
            nxt = next((times[q][0] for q in range(k + 1, len(trace)) if q in times), None)
            if prev is None and nxt is None:
                return None, 'empty'
            s = prev if prev is not None else nxt
            e = nxt if nxt is not None else prev
        out.append({'p': t['p'], 'start': s, 'end': max(e, s)})
    return out, None


def main():
    import data, syllable   # here, not at the top: timing() and textgrid_phones() need no PyTorch
    args = sys.argv[1:]
    opt = {}
    for flag in ('--limit', '--speakers'):
        if flag in args:
            k = args.index(flag); opt[flag] = args[k + 1]; del args[k:k + 2]
    vctk, exp, out = (Path(a) for a in args[:3])
    out.mkdir(parents=True, exist_ok=True)
    mfa = vctk / 'mfa'
    lines = json.load(open(mfa / 'lines.json'))
    table = json.load(open(mfa / 'phone-table.json'))
    idx = json.load(open(exp / 'index.json'))
    want = set(opt['--speakers'].split(',')) if '--speakers' in opt else None
    by_spk = {}
    for l in lines:
        spk = l['name'].split('_')[0]
        if want and spk not in want:
            continue
        by_spk.setdefault(spk, []).append(l)
    limit = int(opt.get('--limit', 10 ** 9))
    why, kept, t0 = Counter(), 0, time.time()
    log = {}
    for spk in sorted(by_spk):
        if (out / f'{spk}.pkl').exists() and not want:
            continue
        rows = []
        for l in by_spk[spk][:limit]:
            lid, name = str(l['id']), l['name']
            tgp = mfa / 'aligned' / spk / f'{name}.TextGrid'
            if lid not in idx['lines']:
                why['not exported'] += 1; log[name] = 'not exported'; continue
            if not tgp.exists():
                why['not aligned'] += 1; log[name] = 'not aligned'; continue
            L = idx['lines'][lid]
            ph, bad = timing(L['trace'], textgrid_phones(tgp), table)
            if bad:
                why[bad] += 1; log[name] = bad; continue
            x, sr = sf.read(vctk / 'wav48_silence_trimmed' / spk / f'{name}_mic1.flac', dtype='float32')
            if x.ndim > 1:
                x = x.mean(1)
            it = data.item(exp, idx, lid, L, ph, x, sr, F0_RANGE)
            if it is None:
                why['trace length'] += 1; log[name] = 'trace length'; continue
            # Register out: scale the speaker's pitch to the rules' median on voiced frames.
            rf = it['tracks'][:len(it['f0spk']), syllable.twin.IX['f0']]
            v = (it['f0spk'] > 0) & (rf > 0)
            if v.sum() < 10:
                why['unvoiced'] += 1; log[name] = 'unvoiced'; continue
            reg = 1200 * np.log2(np.median(it['f0spk'][v]) / np.median(rf[v]))
            it['f0spk'] = it['f0spk'] * 2 ** (-reg / 1200)
            tgt, codes, d = syllable.phone_targets(it)
            # Rate out: the duration targets are log ratios centred on the line's median,
            # so a slow reader's every phone isn't at the cap.
            ok = (d[:, 0] > 0.015) & (d[:, 1] > 0.015)
            if ok.sum() < 5:
                why['too short'] += 1; log[name] = 'too short'; continue
            lr = np.log(d[ok, 1] / d[ok, 0]); rate = float(np.median(lr))
            tgt[:, 0] = np.nan
            tgt[ok, 0] = np.clip(lr - rate, -syllable.DLIM, syllable.DLIM) / syllable.DLIM
            rows.append({'name': name, 'spk': spk, 'id': lid, 'codes': codes, 'rdur': d[:, 0].astype(np.float32),
                         'sdur': d[:, 1].astype(np.float32), 'acc': [a for (_, _, _, a) in it['durs']],
                         'tgt': tgt, 'reg': float(reg), 'rate': rate,
                         'dlog': np.where(ok, np.log(np.maximum(d[:, 1], 1e-3) / np.maximum(d[:, 0], 1e-3)) - rate, np.nan).astype(np.float32)})
        pickle.dump(rows, open(out / f'{spk}.pkl', 'wb'))
        kept += len(rows)
        print(f'{spk}: {len(rows)} lines kept; {kept} so far, {dict(why)} dropped, {time.time() - t0:.0f} s', flush=True)
    json.dump(log, open(out / 'log.json', 'w'), indent=0)


if __name__ == '__main__':
    main()
