# Read only the provider session identified by PurpleMux. No model output parsing.
import sys,json,os,re,glob,hashlib,time
from pathlib import Path

def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def text(blocks):
 if isinstance(blocks,str):return blocks
 return '\n'.join(b.get('text','') for b in (blocks or []) if b.get('type') in ('input_text','output_text','text'))
def read(provider,sid):
 result={'version':1,'sessionId':sid,'observedAt':time.time()*1000,'turns':[],'inputs':[],'cursor':0,'available':False}
 if not sid:return dict(result,available=True)
 if not re.fullmatch(r'[a-zA-Z0-9_-]{10,100}',sid):return result
 home=Path.home()
 root=Path(os.environ.get('CODEX_HOME',str(home/'.codex')))/'sessions' if provider=='codex' else home/'.claude/projects'
 paths=list(root.glob('**/*'+sid+'.jsonl'))
 if len(paths)!=1:return result
 p=paths[0]
 if p.is_symlink() or p.stat().st_size>64*1024*1024:return result
 st=p.stat();result['fileIdentity']=str(st.st_dev)+':'+str(st.st_ino)
 turns={};current=None;parents={};offset=0
 def turn(tid,at):
  if tid not in turns:turns[tid]={'id':tid,'state':'running','startedAt':at,'output':'','offset':offset}
  return turns[tid]
 with p.open('rb') as f:
  for raw in f:
   if not raw.endswith(b'\n'):break
   offset+=len(raw)
   try:x=json.loads(raw)
   except: return result
   at=x.get('timestamp');v=x.get('payload',{});kind=v.get('type');meta=v.get('internal_chat_message_metadata_passthrough') or {}
   if provider=='codex':
    if x.get('type')=='event_msg' and kind=='task_started':
     tid=v.get('turn_id');current=tid
     if tid:turn(tid,at)
    tid=v.get('turn_id') or meta.get('turn_id') or current
    if x.get('type')=='response_item' and v.get('role')=='user' and tid:
     kinds=meta.get('content_item_kinds',[])
     if kinds and 'user.text' not in kinds:continue
     content=text(v.get('content'));uid=v.get('id') or 'offset:'+str(offset)
     if not content.startswith(('<environment_context>','<permissions instructions>')):
      result['inputs'].append({'source':'response','id':uid,'turnId':tid,'hash':digest(content),'offset':offset,'text':content})
    if x.get('type')=='event_msg' and kind=='user_message' and tid:
     content=v.get('message','');result['inputs'].append({'source':'event','id':'offset:'+str(offset),'turnId':tid,'hash':digest(content),'offset':offset,'text':content})
    if x.get('type')=='response_item' and v.get('role')=='assistant' and tid in turns:
     if v.get('phase')=='final_answer':turns[tid]['output']=text(v.get('content'))
    if x.get('type')=='event_msg' and kind in ('task_complete','turn_aborted'):
     # Terminal events must carry their own identity, never attach to a guessed latest turn.
     tid=v.get('turn_id')
     if tid and tid in turns:
      turns[tid].update(state='completed' if kind=='task_complete' else 'interrupted',completedAt=at,completionEvent='offset:'+str(offset))
      if kind=='task_complete' and isinstance(v.get('last_agent_message'),str):turns[tid]['output']=v['last_agent_message']
   elif provider=='claude':
    if x.get('isSidechain'):continue
    uid=x.get('uuid');parent=x.get('parentUuid');m=x.get('message',{});content=m.get('content',[])
    if x.get('type')=='user' and not x.get('isMeta') and not (isinstance(content,list) and any(b.get('type')=='tool_result' for b in content)):
     if not uid:continue
     current=uid;turn(uid,at);parents[uid]=uid
     result['inputs'].append({'id':uid,'turnId':uid,'hash':digest(text(content)),'offset':offset,'text':text(content)})
    elif uid and parent in parents:
     tid=parents[parent];parents[uid]=tid
     if x.get('type')=='assistant':
      if x.get('isApiErrorMessage') is True:
       turns[tid].update(state='failed',output=text(content),error=x.get('error') or 'runtime-api-error',completedAt=at,completionEvent=uid)
      elif m.get('stop_reason') in ('end_turn','stop_sequence','max_tokens'):turns[tid].update(state='completed',output=text(content),completedAt=at,completionEvent=uid)
      elif m.get('stop_reason')=='tool_use':turns[tid]['state']='running'
    # Claude synthetic interruption prose is not used for control.
 result['inputs']=[i for i in result['inputs'] if i.get('source')!='event' or not any(j.get('source')=='response' and j['turnId']==i['turnId'] and j['hash']==i['hash'] for j in result['inputs'])]
 result.update(available=True,cursor=offset,turns=list(turns.values()))
 return result
if __name__=='__main__':
 try: print(json.dumps(read(sys.argv[1],sys.argv[2]),ensure_ascii=False))
 except Exception: print(json.dumps({'available':False,'turns':[],'inputs':[]}))
