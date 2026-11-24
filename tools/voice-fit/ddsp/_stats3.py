import pickle,numpy as np,sys
sys.path.insert(0,'ddsp'); import prosody,data
items=pickle.load(open('out/nn/items3.pkl','rb'))
for it in items:
  d=it['durs']; s=np.concatenate([[0],np.cumsum([x[1] for x in d])])
  for i,(r,sd,p,a) in enumerate(d):
    if p!='_C': continue
    n=int(s[-1]/0.005); L=prosody.level_db(it['audio'],n,0.005); thr=np.percentile(L,95)-35
    c=int((s[i]+s[i+1])/2/0.005); lo=c; hi=c
    while lo>0 and L[lo-1]<thr: lo-=1
    while hi<n-1 and L[hi+1]<thr: hi+=1
    print(it['id'],'rule %.3f align %.3f silence %.3f'%(r,sd,(hi-lo+1)*0.005 if L[c]<thr else 0), it['text'][:50])
