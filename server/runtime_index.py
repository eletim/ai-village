# Rebuildable host-local index. Never writes the provider JSONL or request state.
import os,json,time,hashlib,re,sqlite3,uuid,fcntl
from pathlib import Path
PARSER_VERSION=4
BATCH_BYTES=32*1024*1024
BATCH_EVENTS=50000
BATCH_SECONDS=3
MAX_LINE=8*1024*1024
PAGE_CHARS=512*1024

def encode(value):return json.dumps(value,ensure_ascii=False,separators=(',',':'))
def checksum(kind,key,data):return hashlib.sha256(encode([kind,key,data]).encode()).hexdigest()
def checked(kind,key,data,signature):
 if checksum(kind,key,data)!=signature:raise sqlite3.DatabaseError('cache checksum')
 return data
class Store:
 def __init__(self,conn):self.c=conn;self.current=None
 def get(self,kind,key):
  row=self.c.execute('select value,checksum from records where kind=? and key=?',(kind,key)).fetchone()
  return json.loads(checked(kind,key,row[0],row[1])) if row and row[0] is not None else None
 def put(self,kind,key,value):
  data=encode(value) if value is not None else None
  row=self.c.execute('select value,checksum from records where kind=? and key=?',(kind,key)).fetchone()
  if row and checked(kind,key,row[0],row[1])==data:return
  self.c.execute('insert or replace into records values(?,?,?,?)',(kind,key,data,checksum(kind,key,data)))
  self.c.execute('insert into changes(kind,key,value,checksum) values(?,?,?,?)',(kind,key,data,checksum(kind,key,data)))
 def parent(self,key,value=None):
  if value is not None:self.c.execute('insert or replace into parents values(?,?)',(key,value));return value
  row=self.c.execute('select turn from parents where key=?',(key,)).fetchone();return row[0] if row else None
 def input(self,value):
  tid=value['turnId'];h=value['hash'];source=value.get('source','');key=str(value['offset'])
  if source=='event' and self.c.execute("select 1 from inputs where turn=? and hash=? and source='response'",(tid,h)).fetchone():return
  if source=='response':
   aliases=[]
   for (old,) in self.c.execute("select key from inputs where turn=? and hash=? and source='event'",(tid,h)).fetchall():
    event=self.get('input',old);aliases.append({'id':event['id'],'offset':event['offset']});self.put('input',old,None)
   if aliases:value['aliases']=aliases
   self.c.execute("delete from inputs where turn=? and hash=? and source='event'",(tid,h))
  self.c.execute('insert or replace into inputs values(?,?,?,?)',(key,tid,h,source));self.put('input',key,value)

def schema(c):
 c.executescript('''create table if not exists meta(key text primary key,value text);
 create table if not exists records(kind text,key text,value text,checksum text,primary key(kind,key));
 create table if not exists changes(seq integer primary key autoincrement,kind text,key text,value text,checksum text);
 create table if not exists parents(key text primary key,turn text);
 create table if not exists inputs(key text primary key,turn text,hash text,source text);
 create index if not exists input_match on inputs(turn,hash,source);''')
def stamp(st):return [st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns]
def edges(f,offset):
 f.seek(0);head=f.read(min(offset,4096));f.seek(max(0,offset-4096));tail=f.read(min(offset,4096))
 return hashlib.sha256(head+tail).hexdigest()
def save_proof(path,cp):
 value={k:cp[k] for k in ['path','fileIdentity','stat','offset','edges']}
 try:
  if json.loads(path.read_text())==value:return
 except (FileNotFoundError,ValueError):pass
 tmp=Path(str(path)+'.tmp-'+uuid.uuid4().hex)
 with tmp.open('w') as out:
  os.chmod(tmp,0o600);out.write(encode(value));out.flush();os.fsync(out.fileno())
 os.replace(tmp,path)
def unavailable(reason,**extra):return dict(available=False,reason=reason,turns=[],inputs=[],**extra)

def index_read(provider,sid,request,parse):
 if not sid:return dict(available=True,sessionId=sid,turns=[],inputs=[],cursor=0)
 if provider not in ('codex','claude') or not re.fullmatch(r'[a-zA-Z0-9_-]{10,100}',sid):return unavailable('invalid-session')
 home=Path.home();root=Path(os.environ.get('CODEX_HOME',str(home/'.codex')))/'sessions' if provider=='codex' else home/'.claude/projects'
 paths=list(root.glob('**/*'+sid+'.jsonl'))
 if provider=='claude' and not paths:return unavailable('session-file-unrecorded',unrecorded=True,sessionId=sid)
 if len(paths)!=1:return unavailable('session-file-ambiguous-or-missing')
 path=paths[0]
 if path.is_symlink():return unavailable('session-symlink')
 cache=Path(os.environ.get('VILLAGE_NATIVE_CACHE_DIR',str(home/'.cache/ai-village/native-index')));cache.mkdir(parents=True,exist_ok=True,mode=0o700)
 key=hashlib.sha256((provider+'\0'+str(root.resolve())+'\0'+sid).encode()).hexdigest();dbpath=cache/(key+'.sqlite');proofpath=cache/(key+'.source.json')
 if dbpath.is_symlink() or proofpath.is_symlink():return unavailable('cache-symlink')
 lock=open(str(dbpath)+'.lock','a');os.chmod(str(dbpath)+'.lock',0o600)
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:lock.close();return unavailable('index-busy')
 try:
  c=sqlite3.connect(dbpath,timeout=2);schema(c)
 except sqlite3.DatabaseError:
  try:c.close()
  except:pass
  if dbpath.exists():dbpath.rename(str(dbpath)+'.corrupt-'+uuid.uuid4().hex)
  lock.close();return unavailable('cache-rebuild-required')
 os.chmod(dbpath,0o600)
 try:
  c.execute('begin immediate')
  row=c.execute("select value from meta where key='checkpoint'").fetchone()
  try:cp=json.loads(row[0]) if row else None
  except ValueError:raise sqlite3.DatabaseError('invalid checkpoint')
  with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
   st=os.fstat(f.fileno());now=stamp(st)
   # Source continuity is independent of the rebuildable parser generation.
   proof=None;proof_bad=False
   try:proof=json.loads(proofpath.read_text())
   except FileNotFoundError:pass
   except (ValueError,OSError):proof_bad=True
   if proof_bad and not cp:return unavailable('source-proof-corrupt')
   proof=proof or cp
   def same_source(p):
    return bool(p and p.get('path')==str(path.resolve()) and p['stat'][:2]==now[:2] and now[2]>=p['stat'][2] and not (now[2]==p['stat'][2] and now[3:]!=p['stat'][3:]) and edges(f,p['offset'])==p.get('edges'))
   continuity=same_source(proof)
   source_changed=bool(proof) and not continuity
   reset=not cp or cp.get('version')!=PARSER_VERSION or not same_source(cp)
   if reset:
    for table in ['records','changes','parents','inputs']:c.execute('delete from '+table)
    # A first observation retains dev:inode for pre-index checkpoints. A detected
    # source change gets a new epoch; rebuilding a cache alone preserves identity.
    identity=(proof.get('fileIdentity') if continuity else None) or (str(now[0])+':'+str(now[1])+(':'+uuid.uuid4().hex if source_changed else ''))
    cp={'version':PARSER_VERSION,'path':str(path.resolve()),'generation':uuid.uuid4().hex,'fileIdentity':identity,'offset':0,'current':None,'stat':now}
   db=Store(c);db.current=cp['current'];start=cp['offset'];offset=start;count=0;partial=False;reason=None;t0=time.monotonic();f.seek(offset)
   while offset<now[2] and offset-start<BATCH_BYTES and count<BATCH_EVENTS and time.monotonic()-t0<BATCH_SECONDS:
    raw=f.readline(MAX_LINE+1)
    if len(raw)>MAX_LINE:reason='record-too-large';break
    if not raw.endswith(b'\n'):partial=True;break
    try:x=json.loads(raw)
    except (ValueError,UnicodeDecodeError):reason='invalid-json-line';break
    parse(db,provider,x,offset+len(raw));offset+=len(raw);count+=1
   after=stamp(os.fstat(f.fileno()))
   # Concurrent append is safe for parsed prefix; replacement/rewrite is not.
   if after[:2]!=now[:2] or after[2]<now[2] or (after[2]==now[2] and after[3:]!=now[3:]) or stamp(path.stat())[:2]!=now[:2]:
    c.rollback();return unavailable('source-changed-during-read')
   cp.update(offset=offset,current=db.current,stat=now,edges=edges(f,offset));c.execute("insert or replace into meta values('checkpoint',?)",(encode(cp),))
  top=c.execute('select coalesce(max(seq),0) from changes').fetchone()[0]
  result={'version':2,'sessionId':sid,'generation':cp['generation'],'fileIdentity':cp['fileIdentity'],'observedAt':time.time()*1000,'cursor':offset,'sourceSize':after[2],'available':not reason and offset==after[2] and not partial,'incompleteTail':partial,'reason':reason or ('index-catching-up' if offset<after[2] and not partial else 'partial-line' if partial else None),'indexedBytes':offset-start,'indexedEvents':count,'revision':top}
  if request is None:
   # Compatibility/testing path is bounded too; production uses the delta protocol.
   if c.execute('select coalesce(sum(length(value)),0) from records').fetchone()[0]>PAGE_CHARS:
    c.commit();save_proof(proofpath,cp);return unavailable('use-delta-protocol',**{k:v for k,v in result.items() if k!='available' and k!='reason'})
   rows=[(kind,key,checked(kind,key,data,signature)) for kind,key,data,signature in c.execute('select kind,key,value,checksum from records where value is not null')]
   value=dict(result,**materialize(rows));c.commit();save_proof(proofpath,cp);return value
  since=request.get('cursor') if request.get('generation')==cp['generation'] else None
  seq=int((since or {}).get('seq',0));part=int((since or {}).get('part',0));pieces=[];budget=PAGE_CHARS
  if seq<0 or part<0 or seq>top:raise ValueError('bad cursor')
  # seq denotes the last complete record, part a character offset in seq+next.
  for rev,kind,key,value,signature in c.execute('select seq,kind,key,value,checksum from changes where seq>? order by seq',(seq,)):
   checked(kind,key,value,signature)
   payload=value if value is not None else 'null'
   if part>len(payload):raise ValueError('bad partial cursor')
   chunk=payload[part:part+budget];done=part+len(chunk)==len(payload)
   pieces.append({'seq':rev,'kind':kind,'key':key,'part':part,'data':chunk,'done':done});budget-=len(chunk)+len(key)+100
   if done:seq=rev;part=0
   else:part+=len(chunk);break
   if budget<=0:break
  result.update(pieces=pieces,next={'seq':seq,'part':part},more=seq<top)
  c.commit();save_proof(proofpath,cp);return result
 except sqlite3.DatabaseError:
  c.close()
  if dbpath.exists():dbpath.rename(str(dbpath)+'.corrupt-'+uuid.uuid4().hex)
  return unavailable('cache-rebuild-required')
 finally:c.close();lock.close()

def materialize(rows):
 turns={};messages={};inputs=[];model=None
 for kind,key,raw in rows:
  value=json.loads(raw)
  if kind=='turn':turns[key]=value
  elif kind=='message':messages.setdefault(value['turnId'],[]).append(value)
  elif kind=='input':inputs.append(value)
  elif kind=='model':model=value
 for tid,t in turns.items():
  t['messages']=[{k:v for k,v in m.items() if k!='turnId'} for m in sorted(messages.get(tid,[]),key=lambda m:m['offset'])]
  if t.pop('outputFromMessages',False):t['output']='\n\n'.join(m['text'] for m in t['messages'] if m['offset']<=t.get('outputThrough',float('inf')))
  t.pop('outputThrough',None)
 result={'turns':sorted(turns.values(),key=lambda t:t['offset']),'inputs':sorted(inputs,key=lambda i:i['offset'])}
 if model:result['modelInfo']=model
 return result
