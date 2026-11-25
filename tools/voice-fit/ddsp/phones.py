"""phones.py: ORACLE's phone lists for the controllers, with no PyTorch, so a worker process that
only measures (source.py, formants.py) stays small. syllable.py re-exports both."""

# ORACLE's vowels: VOWELS in audio-engine.js less the breathy H's (HA, HE), which carry no pitch,
# plus OWR, the RP GOAT vowel that set leaves out. ERR and OWR are RP's; AWC to EYC Canadian raising.
VOW = {'IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'UH', 'UW', 'ER', 'ERR', 'AH', 'AX', 'EY', 'AY', 'OW', 'OWR', 'OY', 'AW',
       'AWC', 'AYC', 'OWC', 'EYC'}
# Every code a trace can carry: Speech.phones() (A._phones()) in its order. Fixed, so a model
# pre-trained on one set of lines (VCTK) and fine-tuned on another (David's) numbers phones alike.
PHONES = ['IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'UH', 'UW', 'ER', 'AH', 'AX', 'ERR', 'OWR', 'AWC', 'AYC', 'OWC', 'EYC',
          'EY', 'AY', 'OY', 'OW', 'AW', 'M', 'N', 'NG', 'L', 'R', 'W', 'Y', 'S', 'Z', 'SH', 'ZH', 'F', 'V', 'TH', 'DH',
          'HH', 'HA', 'HE', 'CH', 'JH', 'P', 'B', 'T', 'D', 'K', 'G', 'TQ', 'DX', '_', '_M', '_C', '_L', '_LA', '_S',
          '_D', '_PO', '_PC', '_E', '__', '_X', '_XX', '_Q', '_QW', '_P']
