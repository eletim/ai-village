import {spawn} from 'node:child_process';
// Fixed program; names, paths and file contents are never shell source or executable files.
export const receiveAttachment=`import sys,os,tempfile,hashlib,json
expected=sys.argv[1]; suffix=sys.argv[2]
assert len(expected)==64 and all(c in '0123456789abcdef' for c in expected)
assert suffix in ('.png','.pdf','.txt','.csv','.json','.md','.log','.yaml','.yml','.tsv','.xml')
data=sys.stdin.buffer.read(16*1024*1024+1)
assert len(data)<=16*1024*1024 and hashlib.sha256(data).hexdigest()==expected
folder=tempfile.mkdtemp(prefix='ai-village-attachment-',dir='/tmp')
path=os.path.join(folder,'data'+suffix)
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
print(json.dumps({'path':path,'sha256':expected,'size':len(data)}))`;
const quote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
export function runInput(command,args,bytes){return new Promise((ok,no)=>{
 const child=spawn(command,args,{stdio:['pipe','pipe','pipe']}),chunks=[];let size=0;
 const timer=setTimeout(()=>{child.kill('SIGKILL');no(Error('添付の転送がタイムアウトしました'));},60000);
 child.stdout.on('data',b=>{size+=b.length;if(size>8192){child.kill();return;}chunks.push(b);});child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',e=>{clearTimeout(timer);no(e);});child.on('close',code=>{clearTimeout(timer);code===0&&size<=8192?ok(Buffer.concat(chunks).toString()):no(Error('添付を接続先へ転送できませんでした'));});child.stdin.end(bytes);
});}
export async function stageAttachment(agent,record,bytes,runner=runInput){
 const suffix=record.kind==='image'?'.png':record.name.slice(record.name.lastIndexOf('.')).toLowerCase();
 const argv=['python3','-c',receiveAttachment,record.sha256,suffix];let result;
 if(agent.connection.connectionType==='local')result=await runner(argv[0],argv.slice(1),bytes);
 else if(agent.connection.connectionType==='ssh')result=await runner('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10',agent.connection.sshHost,argv.map(quote).join(' ')],bytes);
 else throw Error('添付の接続方式が不正です');
 const receipt=JSON.parse(result);
 if(receipt.sha256!==record.sha256||receipt.size!==bytes.length||!/^\/tmp\/ai-village-attachment-[\w-]+\/data\.[a-z]+$/.test(receipt.path))throw Error('添付の転送結果を確認できません');
 return {...record,path:receipt.path};
}
