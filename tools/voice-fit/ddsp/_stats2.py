import pickle,numpy as np
items=pickle.load(open('out/nn/items3.pkl','rb'))
c={}
for it in items:
  d=it['durs']
  for i,(r,s,p,a) in enumerate(d):
    pos='last' if i==len(d)-1 else ('prepause' if i+1<len(d) and d[i+1][2]=='_' and d[i+1][0]>0.08 else 'mid')
    c.setdefault((p,pos),[]).append((r,s))
rows=sorted(c.items(),key=lambda kv:-sum(x[0]-x[1] for x in kv[1]))
for (p,pos),v in rows[:18]:
  v=np.array(v);print(p,pos,len(v),'rule %.3f spk %.3f'%tuple(v.mean(0)))
g=[(r,s) for it in items for (r,s,p,a) in it['durs'] if p=='_' and r>0.06]
print('long gaps',len(g),np.array(g).mean(0) if g else '')
