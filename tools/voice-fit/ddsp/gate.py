"""gate.py: the word-error gate over the 200-line gate set (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/gate.py <run dir> <voice.json> [--model name=ckpt ...]

Exports gate-set.json's lines with ORACLE's rules (export.mjs --tracks-only, once per run dir),
applies each named model to them, plays every version through the real worklet (play.mjs), and
has Whisper base.en transcribe it. A model is one checkpoint or several joined by '+'
(vctk=pretrain.pt+formant.pt): pitch heads (syllable.pt, pretrain.pt) and formant heads
(formant_head.py's formant.pt) and source heads (source_head.py's source.pt). A model with a
pitch head is played as 'pitch' (pitch and loudness only, as the voice ships today) and, if it
is only pitch heads, as 'ctl' (durations too); one without is tagged by its kinds ('fmt',
'sou', 'fmt+sou').

Prints word error per version, overall and per source (harvard, banter, booth), and for each
version against the rules the change with a 95% interval from a paired bootstrap over lines,
so a difference of a few words can be told from noise. A version passes when the top of its
interval is under MARGIN (2 points): it can't be shown to make words more than a little worse.
A bar of zero would ask the interval to prove no harm at all, which nothing near the rules
can. Writes <run dir>/gate.json.

Nothing here needs a recording: the gate lines are text only, which is why there can be 200.
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np
import torch
from scipy.signal import resample_poly
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import syllable

DEV = syllable.DEV
MARGIN = 0.02          # word error a version may add, at the top of its 95% interval


def load_head(ck):
    """('pitch' | 'formant', net, PH) from a checkpoint: syllable.pt and pretrain.pt are pitch
    heads; formant_head.py's formant.pt says kind 'formant'."""
    c = torch.load(ck, map_location=DEV)
    if c.get('kind') == 'formant':
        import formant_head
        net = formant_head.FormantHead(len(c['PH'])).to(DEV)
        kind = 'formant'
    elif c.get('kind') == 'source':
        import source_head
        net = source_head.SourceHead(len(c['PH'])).to(DEV)
        kind = 'source'
    elif c.get('kind') == 'consonant':
        import consonant_head
        net = consonant_head.ConsonantHead(len(c['PH'])).to(DEV)
        kind = 'consonant'
    else:
        net = syllable.PhoneHead(len(c['PH'])).to(DEV)
        kind = 'pitch'
    net.load_state_dict(c['net']); net.eval()
    return kind, net, c['PH']


def apply_heads(heads, tr0, L, durations):
    """Formant heads first, on the rules' timing, then pitch heads (with their durations only
    when no formant head is in the mix, since those re-time the line)."""
    import formant_head
    tr = tr0
    import source_head
    for kind, net, PH in heads:
        if kind == 'formant':
            tr = formant_head.controlled(net, PH, tr, L)
    for kind, net, PH in heads:
        if kind == 'source':
            tr = source_head.controlled(net, PH, tr, L)
    for kind, net, PH in heads:
        if kind == 'consonant':
            import consonant_head
            tr = consonant_head.controlled(net, PH, tr, L)
    for kind, net, PH in heads:
        if kind == 'pitch':
            tr = syllable.controlled(net, PH, tr, L, durations, True)
    return tr


def main():
    args = sys.argv[1:]
    models = {}
    while '--model' in args:
        k = args.index('--model'); name, ck = args[k + 1].split('=', 1); models[name] = ck; del args[k:k + 2]
    run, voice = Path(args[0]), Path(args[1])
    run.mkdir(parents=True, exist_ok=True)
    gate = json.load(open(HERE / 'gate-set.json'))
    lines = gate['lines']

    exp = run / 'export'
    if not (exp / 'index.json').exists():
        json.dump([{'id': l['id'], 'text': l['text']} for l in lines], open(run / 'lines.json', 'w'))
        subprocess.run(['node', str(HERE / 'export.mjs'), str(voice), str(run / 'lines.json'), str(exp), '1e9', '--tracks-only'], check=True)
    idx = json.load(open(exp / 'index.json'))

    versions = {'rules': None}
    for name, spec in models.items():
        heads = [load_head(ck) for ck in spec.split('+')]
        kinds = {h[0] for h in heads}
        if 'pitch' in kinds:
            versions[f'{name}:pitch'] = (heads, False)
            if kinds == {'pitch'}:
                versions[f'{name}:ctl'] = (heads, True)
        else:
            versions[f'{name}:{"+".join(sorted(k[:3] for k in kinds))}'] = (heads, False)

    jobs, wav = [], run / 'wav'
    wav.mkdir(exist_ok=True)
    for l in lines:
        lid = str(l['id']); L = idx['lines'][lid]
        tr0 = np.fromfile(exp / f'{lid}.f32', dtype=np.float32).reshape(L['frames'], -1)
        for tag, v in versions.items():
            tr = tr0 if v is None else apply_heads(v[0], tr0, L, v[1])
            safe = tag.replace(':', '-')
            f = wav / f'{lid}-{safe}.f32'; tr.astype(np.float32).tofile(f)
            jobs.append({'f32': str(f), 'frames': len(tr), 'frame': L['frame'], 'k': L['k'], 'names': L['names'],
                         'po': L.get('po', {}), 'out': str(wav / f'{lid}-{safe}.raw')})
    json.dump(jobs, open(run / 'jobs.json', 'w'))
    subprocess.run(['node', str(HERE / 'play.mjs'), str(run / 'jobs.json')], check=True)

    from transformers import pipeline
    asr = pipeline('automatic-speech-recognition', model='openai/whisper-base.en',
                   device=0 if torch.cuda.is_available() else -1)
    err = {tag: np.zeros(len(lines)) for tag in versions}
    nw = np.zeros(len(lines))
    said = {tag: [] for tag in versions}
    for i, l in enumerate(lines):
        for tag in versions:
            y = np.fromfile(wav / f"{l['id']}-{tag.replace(':', '-')}.raw", dtype=np.float32)
            # Whisper can fall into a loop ("I'm sorry, I'm sorry, ..." for 300 words) on a
            # line it can't make out, and three such lines once swamped the other 197. So its
            # output is capped near the line's length, and a line counts at most all its words.
            n0 = len(syllable._words(l['text']))
            t = asr({'raw': resample_poly(y, 1, 3).astype(np.float32), 'sampling_rate': 16000},
                    generate_kwargs={'max_new_tokens': 4 * n0 + 10})['text']
            e, n = syllable.wer(l['text'], t)
            e = min(e, n)
            err[tag][i] = e; nw[i] = n; said[tag].append(t.strip())

    srcs = sorted({l['src'] for l in lines})
    rng = np.random.default_rng(0)
    boot = rng.integers(len(lines), size=(2000, len(lines)))
    out = {'words': int(nw.sum()), 'versions': {}}
    print(f"{len(lines)} lines, {int(nw.sum())} words")
    print(f"{'version':16} {'WER':>6}  " + '  '.join(f'{s:>7}' for s in srcs) + '   vs rules (95%)')
    base = err['rules']
    for tag in versions:
        w = err[tag].sum() / nw.sum()
        per = {s: err[tag][[l['src'] == s for l in lines]].sum() / nw[[l['src'] == s for l in lines]].sum() for s in srcs}
        row = {'wer': w, 'by_source': per}
        cmp = ''
        if tag != 'rules':
            d = (err[tag] - base)
            bd = d[boot].sum(1) / nw[boot].sum(1)
            lo, hi = np.percentile(bd, [2.5, 97.5])
            row.update({'delta': d.sum() / nw.sum(), 'ci': [lo, hi], 'pass': bool(hi <= MARGIN)})
            cmp = f"{d.sum() / nw.sum():+.1%} [{lo:+.1%}, {hi:+.1%}] {'PASS' if hi <= MARGIN else 'FAIL'}"
        out['versions'][tag] = row
        print(f"{tag:16} {w:6.1%}  " + '  '.join(f'{per[s]:7.1%}' for s in srcs) + f'   {cmp}')
    out['transcripts'] = {tag: said[tag] for tag in versions}
    json.dump(out, open(run / 'gate.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
