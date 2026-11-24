import sys,json,numpy as np
from pathlib import Path
sys.path.insert(0,'ddsp'); import data
items=data.load(Path('out/nn/r3'),Path('out/nn/align3.json'),'C:/Users/david/Desktop/part3.wav')
import pickle; pickle.dump(items,open('out/nn/items3.pkl','wb'))
VOW={'IY','IH','EH','AE','AA','AO','UH','UW','ER','AH','AX','EY','AY','OW','OY','AW','IX','AXR'}
cat={}
for it in items:
  d=it['durs']; n=len(d)
  for i,(r,s,p,a) in enumerate(d):
    if p=='_': k='gap'
    elif p in VOW: k=('accV' if a else 'V')+('_final' if all(q[2] not in VOW for q in d[i+1:]) else '')
    else: k='C'
    cat.setdefault(k,[]).append((r,s))
for k,v in cat.items():
  v=np.array(v); print(k,len(v),'rule %.3f spk %.3f  med logratio %.2f'%(v[:,0].mean(),v[:,1].mean(),np.median(np.log(np.maximum(v[:,1],1e-3)/v[:,0]))))
tot=np.array([[sum(x[0] for x in it['durs']),sum(x[1] for x in it['durs'])] for it in items]);print('line total rule/spk',tot.mean(0))
