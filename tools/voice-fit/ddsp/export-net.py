"""export-net.py: syllable.py's pitch head as JSON the engine runs (audio-engine.js, pitchNet).

  <venv python> tools/voice-fit/ddsp/export-net.py <syllable.pt> <out.json>

Every tensor is int8 with one scale per tensor, base64. Only the pitch output is kept:
the duration and loudness outputs made Whisper's word error worse and aren't used. The
file carries `check`, three lines' inputs and the PyTorch outputs for them, so a gate can
prove the JavaScript computes the same thing.
"""
import base64, json, math, sys
from pathlib import Path
import numpy as np
import torch
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import syllable

ck = torch.load(sys.argv[1], weights_only=False)
PH = ck['PH']
net = syllable.PhoneHead(len(PH)); net.load_state_dict(ck['net']); net.eval()
sd = {k: v.detach().numpy().astype(np.float32) for k, v in net.state_dict().items()}


def q(a):
    s = float(np.abs(a).max()) / 127 or 1.0
    return {'shape': list(a.shape), 'scale': s, 'b64': base64.b64encode(np.round(a / s).astype(np.int8).tobytes()).decode()}


def deq(t):
    return np.frombuffer(base64.b64decode(t['b64']), dtype=np.int8).astype(np.float32).reshape(t['shape']) * t['scale']


W = {k: q(v) for k, v in sd.items()}
# run the quantised weights in PyTorch too, so `check` is what the file computes
net.load_state_dict({k: torch.tensor(deq(W[k])) for k in sd})
idx = json.load(open(HERE.parent / 'out/nn/r3/index.json'))
check = []
for lid in list(idx['lines'])[:3]:
    L = idx['lines'][lid]
    tr = [t for t in L['trace'] if t['p'] != 'END']
    at = [t['at'] for t in tr] + [L['frames'] * L['frame']]
    codes, acc = [t['p'] for t in tr], [1.0 if t.get('acc') else 0.0 for t in tr]
    ph, ex = syllable.phone_inputs(codes, np.diff(at), acc, PH)
    with torch.no_grad():
        out = net(ph, ex)[0][:, 1].numpy() * syllable.CLIM
    check.append({'codes': codes, 'at': [round(a, 5) for a in at], 'acc': acc, 'cents': [round(float(c), 3) for c in out]})
doc = {
    'about': 'ORACLE per-vowel pitch controller (tools/voice-fit/ddsp/syllable.py), int8 weights; see docs/proposals/oracle-neural.md',
    'phones': PH, 'vowels': sorted(syllable.VOW), 'cents': syllable.CLIM, 'hidden': net.gru.hidden_size, 'layers': net.gru.num_layers,
    'weights': W, 'check': check,
}
Path(sys.argv[2]).write_text(json.dumps(doc, separators=(',', ':')) + '\n')
print(sys.argv[2], round(Path(sys.argv[2]).stat().st_size / 1024), 'KB;', sum(v.size for v in sd.values()), 'weights')
