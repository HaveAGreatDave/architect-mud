"""export-formant.py: formant_head.py's FormantHead, source_head.py's SourceHead or consonant_head.py's ConsonantHead, as JSON the
engine runs (audio-engine.js: applyFormantNet, applySourceNet).

  <venv python> tools/voice-fit/ddsp/export-formant.py <formant.pt | source.pt> <out.json> <export dir>

The checkpoint's `kind` picks which. A source head's file carries `tracks` (rd, tilt, ah) and
`lim` (each track's cap, log units) in place of `sonorants`, `points` and `flim`.

Same format as export-net.py's pitch head: int8 weights, one scale per tensor, base64, and a
`check` block (three lines of <export dir>'s inputs and the quantised network's outputs, run
in PyTorch) so a gate can prove the JavaScript computes the same thing.

The head is shared by every voice: it was trained across VCTK's speakers with each one's
vocal-tract length taken out, so it corrects how formants move, not where a voice's sit. It
only ever saw the GA phone set, so `alias` maps the phones it never saw (RP's ERR and OWR,
Canadian raising, the breathy H's) to the nearest one it did, before they go in.
"""
import base64, json, sys
from pathlib import Path
import numpy as np
import torch
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import syllable, formant_head, source_head, consonant_head
from consonant import FRIC, STOP

ALIAS = {'ERR': 'ER', 'OWR': 'OW', 'AWC': 'AW', 'AYC': 'AY', 'OWC': 'OW', 'EYC': 'EY', 'HA': 'HH', 'HE': 'HH'}

ck = torch.load(sys.argv[1], weights_only=False)
PH = ck['PH']
KIND = ck.get('kind', 'formant')
SOURCE = KIND in ('source', 'consonant')        # heads with tracks and lim
HEAD = {'source': source_head, 'consonant': consonant_head}.get(KIND)
net = (source_head.SourceHead if KIND == 'source' else consonant_head.ConsonantHead if KIND == 'consonant' else formant_head.FormantHead)(len(PH)); net.load_state_dict(ck['net']); net.eval()
sd = {k: v.detach().numpy().astype(np.float32) for k, v in net.state_dict().items()}


def q(a):
    s = float(np.abs(a).max()) / 127 or 1.0
    return {'shape': list(a.shape), 'scale': s, 'b64': base64.b64encode(np.round(a / s).astype(np.int8).tobytes()).decode()}


def deq(t):
    return np.frombuffer(base64.b64decode(t['b64']), dtype=np.int8).astype(np.float32).reshape(t['shape']) * t['scale']


W = {k: q(v) for k, v in sd.items()}
net.load_state_dict({k: torch.tensor(deq(W[k])) for k in sd})
idx = json.load(open(Path(sys.argv[3]) / 'index.json'))
check = []
for lid in list(idx['lines'])[:3]:
    L = idx['lines'][lid]
    tr = [t for t in L['trace'] if t['p'] != 'END']
    at = [t['at'] for t in tr] + [L['frames'] * L['frame']]
    codes, acc = [ALIAS.get(t['p'], t['p']) for t in tr], [1.0 if t.get('acc') else 0.0 for t in tr]
    ph, ex = syllable.phone_inputs(codes, np.diff(at), acc, PH)
    with torch.no_grad():
        out = net(ph, ex)[0].numpy() * (np.array(HEAD.LIM) if SOURCE else formant_head.FLIM)
    check.append({'codes': codes, 'at': [round(a, 5) for a in at], 'acc': acc,
                  'out': [[round(float(v), 5) for v in row] for row in out]})
what = 'per-obstruent noise controller (tools/voice-fit/ddsp/consonant_head.py)' if KIND == 'consonant' else 'per-vowel voice-source controller (tools/voice-fit/ddsp/source_head.py)' if SOURCE else 'per-phone formant controller (tools/voice-fit/ddsp/formant_head.py)'
doc = {
    'about': f'ORACLE {what}, trained on VCTK 0.92 (Yamagishi, Veaux and MacDonald 2019, CC BY 4.0); int8 weights; see docs/proposals/oracle-teacher.md',
    'kind': KIND, 'phones': PH, 'vowels': sorted(syllable.VOW), 'alias': ALIAS,
    'hidden': net.gru.hidden_size, 'layers': net.gru.num_layers, 'weights': W, 'check': check,
}
if SOURCE:
    doc.update({'tracks': list(HEAD.TRACKS), 'lim': [float(v) for v in HEAD.LIM]})
    if KIND == 'consonant':
        doc['obstruents'] = sorted(FRIC | STOP)
else:
    doc.update({'sonorants': sorted(formant_head.SON), 'points': list(formant_head.POINTS), 'flim': formant_head.FLIM})
Path(sys.argv[2]).write_text(json.dumps(doc, separators=(',', ':')) + '\n')
print(sys.argv[2], round(Path(sys.argv[2]).stat().st_size / 1024), 'KB;', sum(v.size for v in sd.values()), 'weights')
