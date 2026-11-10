# Provider semantics only. The index supplies persisted state and byte offsets.
import sys,json,os,re,hashlib,time

def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def text(blocks):
 if isinstance(blocks,str):return blocks
 return '\n'.join(b.get('text','') for b in (blocks or []) if b.get('type') in ('input_text','output_text','text'))

def parse_event(db,provider,x,offset):
 at=x.get('timestamp');v=x.get('payload',{});kind=v.get('type');meta=v.get('internal_chat_message_metadata_passthrough') or {}
 def turn(tid):
  t=db.get('turn',tid)
  if t is None:
   t={'id':tid,'state':'running','startedAt':at,'output':'','offset':offset,'messageOffsets':True};db.put('turn',tid,t)
  return t
 def message(tid,uid,body):
  db.put('message',str(offset),{'turnId':tid,'id':uid,'text':body,'at':at,'offset':offset})
 if provider=='codex':
  if x.get('type')=='turn_context':db.put('model','model',{'model':v.get('model'),'serviceTier':v.get('service_tier'),'recordedAt':at})
  if x.get('type')=='event_msg' and kind=='task_started':
   db.current=v.get('turn_id')
   if db.current:turn(db.current)
  tid=v.get('turn_id') or meta.get('turn_id') or db.current
  if x.get('type')=='response_item' and v.get('role')=='user' and tid:
   kinds=meta.get('content_item_kinds',[])
   if kinds and 'user.text' not in kinds:return
   body=text(v.get('content'));uid=v.get('id') or 'offset:'+str(offset)
   if not body.startswith(('<environment_context>','<permissions instructions>')):db.input({'explicitTurn':bool(v.get('turn_id') or meta.get('turn_id')),'source':'response','id':uid,'turnId':tid,'hash':digest(body),'offset':offset,'text':body})
  if x.get('type')=='event_msg' and kind=='user_message' and tid:
   body=v.get('message','');db.input({'source':'event','id':'offset:'+str(offset),'turnId':tid,'hash':digest(body),'offset':offset,'text':body})
  t=db.get('turn',tid) if tid else None
  if x.get('type')=='response_item' and v.get('role')=='assistant' and t:
   body=text(v.get('content'))
   if body:message(tid,v.get('id') or str(offset),body);t['outputFromMessages']=True;db.put('turn',tid,t)
  if x.get('type')=='event_msg' and kind in ('task_complete','turn_aborted'):
   tid=v.get('turn_id');t=db.get('turn',tid) if tid else None
   if t:
    error=v.get('error');failed=error is not None or t['state']=='failed'
    t.update(state='failed' if failed else 'completed' if kind=='task_complete' else 'interrupted',completedAt=at,completionEvent='offset:'+str(offset),completionOffset=offset)
    if error is not None:t.update(runtimeError=error,error=error.get('message','Runtime error') if isinstance(error,dict) else str(error),errorCode=error.get('codex_error_info') if isinstance(error,dict) else None)
    if kind=='task_complete' and isinstance(v.get('last_agent_message'),str):
     t['finalOutput']=v['last_agent_message']
     if not t.get('outputFromMessages'):t['output']=v['last_agent_message']
    db.put('turn',tid,t)
 elif provider=='claude':
  if x.get('isSidechain'):return
  uid=x.get('uuid');parent=x.get('parentUuid');m=x.get('message',{});content=m.get('content',[])
  if x.get('type')=='user' and not x.get('isMeta') and not (isinstance(content,list) and any(b.get('type')=='tool_result' for b in content)):
   if not uid:return
   db.current=uid;turn(uid);db.parent(uid,uid)
   db.input({'id':uid,'turnId':uid,'hash':digest(text(content)),'offset':offset,'text':text(content)})
  elif uid and db.parent(parent):
   tid=db.parent(parent);db.parent(uid,tid)
   if x.get('type')=='assistant':
    db.put('model','model',{'model':m.get('model'),'serviceTier':(m.get('usage') or {}).get('speed'),'recordedAt':at})
    t=db.get('turn',tid);body=text(content)
    if body:message(tid,uid,body)
    if x.get('isApiErrorMessage') is True:t.update(state='failed',outputFromMessages=True,outputThrough=offset,error=x.get('error') or 'runtime-api-error',completedAt=at,completionEvent=uid)
    elif m.get('stop_reason') in ('end_turn','stop_sequence','max_tokens'):t.update(state='interrupted' if m.get('stop_reason')=='max_tokens' else 'completed',finalOutput=body,outputFromMessages=True,outputThrough=offset,completedAt=at,completionEvent=uid)
    elif m.get('stop_reason')=='tool_use':t.update(state='running',outputFromMessages=True)
    db.put('turn',tid,t)

if __name__=='__main__':
 try:
  if 'index_read' not in globals():
   from runtime_index import index_read
  print(json.dumps(index_read(sys.argv[1],sys.argv[2],json.loads(sys.argv[3]) if len(sys.argv)>3 else None,parse_event),ensure_ascii=False))
 except Exception:
  print(json.dumps({'available':False,'reason':'runtime-index-error','turns':[],'inputs':[]}))
