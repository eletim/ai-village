import json,statistics,pathlib
root=pathlib.Path('/tmp/cold-display-evidence')
stages=['base-fixed','store','final','base-instrumented','store-instrumented','final-instrumented'];output={}
def describe(v):
 return {'n':len(v),'median':round(statistics.median(v),2),'min':round(min(v),2),'max':round(max(v),2)} if v else None
for stage in stages:
 path=root/stage/'measurements.json'
 if not path.exists():continue
 rows=json.loads(path.read_text());groups={}
 for r in rows:groups.setdefault(f"{r['count']}-{r['width']}-{'single' if r['single'] else 'all'}-{'read' if r['reviewed'] else 'unread'}",[]).append(r)
 output[stage]={}
 for key,rs in groups.items():
  out={'readyMs':describe([r['readyMs'] for r in rs]),'entries':sorted(set(r['metrics']['visibleEntries'] for r in rs)),'nodes':describe([r['metrics']['nodes'] for r in rs]),'unreadAfter':sorted(set(r['unreadAfter'] for r in rs))}
  resources=[[x for x in r['metrics']['resources'] if '/api/direct' in x['url']] for r in rs]
  out['apiCount']=describe([len(xs) for xs in resources]);out['payloadBytes']=describe([sum(x['encoded'] for x in xs) for xs in resources]);out['maxTTFB']=describe([max((x['ttfb'] for x in xs),default=0) for xs in resources])
  if rs[0]['instrumented']:
   out['paintedReadyMs']=describe([r['paintedReadyMs'] for r in rs])
   out['layoutMs']=describe([sum(x['ms'] for x in r['layout'] if x['name']=='Layout') for r in rs]);out['layoutCount']=describe([sum(x['name']=='Layout' for x in r['layout']) for r in rs])
   for method in ['prepare','commit','storeSave','directSave']:
    totals=[];counts=[]
    for r in rs:
     logs=[json.loads(l) for l in (root/stage/(r['name']+'-server.jsonl')).read_text().splitlines()];spans=[x['ms'] for x in logs if x.get('method')==method and x['at']>=r['started']];totals.append(sum(spans));counts.append(len(spans))
    out[method+'Ms']=describe(totals);out[method+'Count']=counts
  output[stage][key]=out
(root/'summary.json').write_text(json.dumps(output,indent=2))
for stage,groups in output.items():
 print(stage)
 for key,x in groups.items():
  if key.startswith('1000-'):print(key,'ready',x['readyMs'],'layout',x.get('layoutMs'),'prepare',x.get('prepareMs'))
