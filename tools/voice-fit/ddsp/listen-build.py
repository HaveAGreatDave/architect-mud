"""listen-build.py: a blind A/B listening test from a gate.py run (docs/proposals/oracle-teacher.md).

  <venv python> tools/voice-fit/ddsp/listen-build.py <gate run dir> <out dir> [--per N] [--versions a,b] [--base v]

Takes the renders gate.py left in <gate run dir>/wav and pairs each candidate version with the
rules on the same line: N lines per candidate (default 12), different lines for each candidate,
picked by a fixed seed across the three sources. Which side is the rules is random per pair,
and the files are named by a random id, so nothing in the page gives the answer away.

Writes to <out dir>:
  wav/<id>.wav    16-bit 48 kHz, every file peak-normalised alike
  pairs.json      what the page sees: [{ n, text, a, b }] in a shuffled order
  key.json        what it doesn't: { n: { a: version, b: version } }; listen.mjs scores with it
  meta.json       { base, candidates }
Default candidates: every '<model>:pitch' version gate.py played (pitch only, as the voice ships).
--base pairs the candidates with that version instead of the rules (formants against
formants plus source, say); listen.mjs --score then counts against it.
"""
import json, sys, wave
from pathlib import Path
import numpy as np

args = sys.argv[1:]
opt = {}
for flag in ('--per', '--versions', '--base'):
    if flag in args:
        k = args.index(flag); opt[flag] = args[k + 1]; del args[k:k + 2]
gate, out = Path(args[0]), Path(args[1])
lines = json.load(open(gate / 'lines.json'))
res = json.load(open(gate / 'gate.json'))
src = {l['id']: l for l in json.load(open(Path(__file__).resolve().parent / 'gate-set.json'))['lines']}
cands = opt['--versions'].split(',') if '--versions' in opt else [v for v in res['versions'] if v.endswith(':pitch')]
per = int(opt.get('--per', 12))
BASE = opt.get('--base', 'rules')
rng = np.random.default_rng(7)

# Lines dealt out to candidates in turn, interleaving the sources so each gets a mix.
by_src = {}
for l in lines:
    by_src.setdefault(src[l['id']]['src'], []).append(l)
for v in by_src.values():
    rng.shuffle(v)
deck = [l for group in zip(*by_src.values()) for l in group]
if len(deck) < per * len(cands):
    raise SystemExit(f'only {len(deck)} lines for {per * len(cands)} pairs')

(out / 'wav').mkdir(parents=True, exist_ok=True)
used = set()


def save(lid, tag):
    y = np.fromfile(gate / 'wav' / f"{lid}-{tag.replace(':', '-')}.raw", dtype=np.float32)
    y = y / (np.abs(y).max() + 1e-9) * 0.7
    while True:
        name = ''.join(rng.choice(list('abcdefghjkmnpqrstuvwxyz23456789'), 8))
        if name not in used:
            used.add(name); break
    with wave.open(str(out / 'wav' / f'{name}.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
        w.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes())
    return f'wav/{name}.wav'


pairs, key = [], {}
for ci, cand in enumerate(cands):
    for l in deck[ci * per:(ci + 1) * per]:
        sides = [BASE, cand]
        if rng.random() < 0.5:
            sides.reverse()
        pairs.append({'text': l['text'], 'a': save(l['id'], sides[0]), 'b': save(l['id'], sides[1]), 'k': {'a': sides[0], 'b': sides[1]}})
rng.shuffle(pairs)
for n, p in enumerate(pairs, 1):
    key[str(n)] = p.pop('k'); p['n'] = n
json.dump(pairs, open(out / 'pairs.json', 'w'), indent=1)
json.dump(key, open(out / 'key.json', 'w'), indent=1)
json.dump({'base': BASE, 'candidates': cands}, open(out / 'meta.json', 'w'), indent=1)
print(f'{len(pairs)} pairs ({per} each for {", ".join(cands)}) in {out}')
