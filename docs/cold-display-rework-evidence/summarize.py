import json,pathlib,statistics,hashlib
root=pathlib.Path('/tmp/cold-rework-evidence')
sets={k:json.loads((root/k/'measurements.json').read_text()) for k in ['before','after']}
summary={}
for k,rows in sets.items():
 out=[]
 for r in rows:
  api=[a for a in r['metrics']['resources'] if '/api/' in a['url']]
  saves=[json.loads(l) for l in (root/k/(r['name']+'-server.jsonl')).read_text().splitlines()]
  saves=[s for s in saves if s['at']>=r['started']]
  out.append({a:r[a] for a in ['name','width','single','reviewed','trial','readyMs','paintedReadyMs','unreadAfter']}|{'layoutMs':sum(x['ms'] for x in r['layout'] if x['name']=='Layout'),'layoutCount':sum(x['name']=='Layout' for x in r['layout']),'apiCount':len(api),'apiBytes':sum(x['encoded'] for x in api),'apiTtfbMax':max([x['ttfb'] for x in api] or [0]),'prepareMs':sum(x['ms'] for x in saves if x['method']=='prepare'),'commitMs':sum(x['ms'] for x in saves if x['method']=='commit'),'entries':r['metrics']['entries'],'nodes':r['metrics']['nodes'],'contentHash':r['metrics']['contentHash']})
 summary[k]=out
summary['sameContent']=all(a['contentHash']==b['contentHash'] and a['entries']==b['entries'] and a['nodes']==b['nodes'] for a,b in zip(summary['before'],summary['after']))
summary['sourceHashes']={k:{p:hashlib.sha256((pathlib.Path(d)/p).read_bytes()).hexdigest() for p in ['src/chat-scroll.js','src/direct.js','server/partition-store.mjs']} for k,d in [('before','/tmp/cold-rework-before-fixed'),('after','/home/eletim/ai-village-cold-display')]}
(root/'summary.json').write_text(json.dumps(summary,indent=2))
lines=['Same text hash, DOM node and entry counts across all paired trials: '+str(summary['sameContent']), 'Each cell n=2; milliseconds mean [min,max]. Layout is full trace through 500ms after two-frame ready.']
for width in [1440,390]:
 for single in [False,True]:
  for read in [False,True]:
   line=f'{width} {"single" if single else "all"} {"read" if read else "unread"}'
   for k in ['before','after']:
    rr=[r for r in summary[k] if r['width']==width and r['single']==single and r['reviewed']==read]
    for metric in ['paintedReadyMs','layoutMs']:
     v=[r[metric] for r in rr];line+=f' | {k} {metric} {statistics.mean(v):.1f} [{min(v):.1f},{max(v):.1f}]'
   lines.append(line)
(root/'summary.txt').write_text('\n'.join(lines)+'\n')
print('\n'.join(lines))
