import {humanUI} from '../server/human-ui.mjs';
import {receiveUpload} from '../server/upload-limits.mjs';
import {apiValue} from '../server/state-projection.mjs';
import {workspaceSnapshot,historyPage} from '../server/conversation-pages.mjs';
import {WorkspaceSync} from '../server/workspace-sync.mjs';
import {syncResponse} from '../server/sync-response.mjs';
const workspaceSync=new WorkspaceSync();
import {WeeklyUsage} from '../server/weekly-usage.mjs';
const weeklyUsage=new WeeklyUsage();
import {TravelRegistry} from '../server/travel-registry.mjs';
import {AttachmentStore} from '../server/attachments.mjs';
import { DirectAgents } from '../server/direct.mjs';
import { PullRequests } from '../server/pull-requests.mjs';
import { listenAddresses } from '../server/network.mjs';
import { TodoStore } from '../server/todos.mjs';
import { accessPolicy } from '../server/access.mjs';
import { ImageStore } from '../server/images.mjs';
import { randomUUID } from 'node:crypto';
import {run,stateDirectory,remoteExecutor} from '../server/execution.mjs';
import { WebReader } from '../server/web-reader.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { VillageLibrary } from '../server/library.mjs';
import { VillageOperations } from '../server/operations.mjs';
import { VillageNotifier } from '../server/notifier.mjs';
const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const port = Number(value('--port', 5173)), host = value('--host', '127.0.0.1'), root = resolve('.');
const addresses = listenAddresses({host});
const humanIntent=humanUI();
const allowRequest = await accessPolicy({host:addresses[0],port,vpnAddress:addresses.find(address=>address.startsWith('100.'))});
const library = new VillageLibrary();
const dir=stateDirectory();
const todos = new TodoStore(dir);
await todos.init();
const travelRegistry=new TravelRegistry(dir);await travelRegistry.init();
const notifier = new VillageNotifier({ dir: dir });
await notifier.init();
const attachments=new AttachmentStore(dir);await attachments.init();
const direct = new DirectAgents({dir:dir,remote:remoteExecutor(dir),notifier,attachments,villageUrl:`http://127.0.0.1:${port}`});
await direct.init();
const images = new ImageStore(dir);
await images.init();
const operations = new VillageOperations({dir}, notifier, {web:new WebReader(),images,todos,direct,travelRegistry,prs:new PullRequests(dir,library)});
const instanceId=randomUUID(), runningCommit=(await run('git',['rev-parse','HEAD'])).trim();
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(apiValue(body))); };
const handleRequest = async (req, res) => {
  try {
    if(!allowRequest(req,res))return;
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if(pathname.startsWith('/api/direct/human/')&&!humanIntent.allow(req))return json(res,403,{error:'人間専用の操作です。村の画面を再読み込みして操作してください。'});
    if (pathname.startsWith('/api/')) {
      if (pathname.startsWith('/api/direct')) {
        if(req.method==='GET' && pathname==='/api/direct/usage')return json(res,200,await weeklyUsage.get());
        if(req.method==='GET' && pathname==='/api/direct/requests')return json(res,200,{requests:direct.flow.list()});
        if(req.method==='GET' && pathname==='/api/direct/agents')return json(res,200,direct.discovery());
        if(req.method==='GET' && pathname==='/api/direct'){
          const params=new URL(req.url,'http://localhost').searchParams;
          if(params.get('view')==='workspace'){
            let ranges;try{ranges=JSON.parse(params.get('ranges')||'{}');}catch{return json(res,400,{error:'Invalid history ranges'});}
            let focus=null;if(params.has('focus')){try{focus=JSON.parse(params.get('focus'));}catch{return json(res,400,{error:'Invalid focus agents'});}}
            const snapshot=workspaceSnapshot(direct.snapshot(),ranges,focus);
            if(params.get('sync')==='1')return await syncResponse(req,res,workspaceSync.reply({client:params.get('client'),since:params.get('since'),scope:(params.get('ranges')||'{}')+'|'+(params.get('focus')||'')},snapshot));
            return json(res,200,snapshot);
          }
          return json(res,200,direct.snapshot());
        }
        const history=pathname.match(/^\/api\/direct\/agents\/([^/]+)\/history$/);
        if(req.method==='GET'&&history){
          const params=new URL(req.url,'http://localhost').searchParams,page=historyPage(direct.snapshot(),history[1],params.get('before'));
          return json(res,200,params.get('boundaryOnly')==='1'?{cursor:page.cursor,hasMore:page.hasMore}:page);
        }
        const deletion=pathname.match(/^\/api\/direct\/projects\/([0-9a-f-]{36})\/(delete-plan|delete)$/);
        if(deletion&&req.method==='GET'&&deletion[2]==='delete-plan')return json(res,200,direct.projectDeletePlan(deletion[1]));
        if(!['POST','PUT'].includes(req.method))return json(res,405,{error:'Method not allowed'});
        if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'JSON required'});
        let body='';for await(const chunk of req){body+=chunk;if(body.length>80000)return json(res,413,{error:'Request too large'});}
        let input;try{input=JSON.parse(body);}catch{return json(res,400,{error:'Invalid JSON'});}
        if(!input || typeof input!=='object')return json(res,400,{error:'Object required'});
        const humanAction=pathname.match(/^\/api\/direct\/human\/requests\/(retry|resume|cancel|complete|cancel-queued)$/);
        if(req.method==='POST'&&humanAction){
          const action=humanAction[1],flow=direct.flow;
          return json(res,200,action==='cancel-queued'?await flow.cancelQueued(input):action==='retry'||action==='resume'?await flow.continue(input,action==='retry'):await flow[action](input));
        }
        const requestAction=pathname.match(/^\/api\/direct\/requests\/(get|results|delegate|finish)$/);
        if(req.method==='POST'&&requestAction){
          const action=requestAction[1],flow=direct.flow;
          const result=action==='cancel-queued'?await flow.cancelQueued(input):action==='get'?flow.get(input.humanRequestId):action==='results'?flow.results(input.humanRequestId,input.workId):action==='retry'||action==='resume'?await flow.continue(input,action==='retry'):await flow[action](input);
          return json(res,200,result);
        }
        if(req.method==='POST' && pathname==='/api/direct/notifications/test'){if(input.agentId)direct.agent(input.agentId);return json(res,200,await notifier.test(input.agentId));}
        if(req.method==='POST' && pathname==='/api/direct/workshops')return json(res,201,await direct.putWorkshop(input));
        const workshop=pathname.match(/^\/api\/direct\/workshops\/([0-9a-f-]{36})$/);
        if(req.method==='PUT' && workshop)return json(res,200,await direct.putWorkshop(input,workshop[1]));
        if(req.method==='POST' && pathname==='/api/direct/projects')return json(res,201,await direct.putProject(input));
        if(deletion&&req.method==='POST'&&deletion[2]==='delete')return json(res,200,await direct.deleteProject(deletion[1],input));
        const project=pathname.match(/^\/api\/direct\/projects\/([0-9a-f-]{36})$/);
        if(req.method==='PUT' && project)return json(res,200,await direct.putProject(input,project[1]));
        const metadata=pathname.match(/^\/api\/direct\/agents\/([0-9a-f-]{36})$/);
        if(req.method==='PUT' && metadata)return json(res,200,await direct.updateAgent(metadata[1],input));
        if(req.method==='POST' && pathname==='/api/direct/agents')return json(res,201,await direct.create(input));
        const agent=pathname.match(/^\/api\/direct\/agents\/([0-9a-f-]{36})\/(runs|stop|view)$/);
        if(req.method==='POST' && agent)return json(res,200,await (agent[2]==='runs'?direct.send(agent[1],input):agent[2]==='view'?direct.viewAgent(agent[1],input):direct.stop(agent[1])));
        return json(res,404,{error:'Not found'});
      }
      if(pathname==='/api/travel-registry'){
        if(req.method==='GET')return json(res,200,travelRegistry.snapshot());
        if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
        if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'JSON required'});
        let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)return json(res,413,{error:'Request too large'});}
        let input;try{input=JSON.parse(body);}catch{return json(res,400,{error:'Invalid JSON'});}
        return json(res,200,await travelRegistry.update(input));
      }
      if (pathname === '/api/todos') {
        if(req.method==='GET')return json(res,200,todos.snapshot());
        if(req.method==='POST'){
          if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'JSON required'});
          let body='';for await(const chunk of req){body+=chunk;if(body.length>8000)return json(res,413,{error:'Request too large'});}
          let input;try{input=JSON.parse(body);}catch{return json(res,400,{error:'Invalid JSON'});}
          return json(res,200,await todos.update(input));
        }
      }
      if (req.method === 'GET' && pathname === '/api/health') return json(res,200,{commit:runningCommit,instanceId,supervised:process.env.VILLAGE_SUPERVISED==='1'});
      if (req.method === 'GET' && pathname === '/api/documents') return json(res, 200, { root: library.root, documents: await library.catalog() });
      if (req.method === 'GET' && pathname === '/api/documents/content') return json(res, 200, await library.read(new URL(req.url, 'http://localhost').searchParams.get('path')));
      const attachmentRoute=pathname.match(/^\/api\/attachments\/([0-9a-f-]{36})$/);
      if(req.method==='GET'&&attachmentRoute){
        const record=await attachments.get(attachmentRoute[1]),bytes=await attachments.content(record.id);
        res.writeHead(200,{'Content-Type':record.kind==='image'?'image/png':'application/octet-stream','Content-Disposition':(record.kind==='image'?'inline':'attachment')+"; filename*=UTF-8''"+encodeURIComponent(record.name).replaceAll("'",'%27'),'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'private, no-store'});res.end(bytes);return;
      }
      if(req.method==='POST'&&pathname==='/api/attachments'){
        return receiveUpload(req,res,bytes=>attachments.save(bytes,new URL(req.url,'http://localhost').searchParams.get('name'),req.headers['content-type']));
      }
      const imageRoute = pathname.match(/^\/api\/images\/([0-9a-f-]{36})$/);
      if (req.method === 'GET' && imageRoute) {
        const content = await images.content(imageRoute[1]);
        res.writeHead(200, {'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-cache'});
        res.end(content); return;
      }
      if (req.method === 'POST' && pathname === '/api/images') {
        if (!['image/png','image/jpeg','image/webp'].includes(req.headers['content-type'])) return json(res,415,{error:'PNG・JPEG・WebPを選んでください。'});
        const name = new URL(req.url,'http://localhost').searchParams.get('name') || '画像';
        return receiveUpload(req,res,bytes=>images.save(bytes,name));
      }
      if (req.method === 'POST' && pathname === '/api/village') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{error:'JSON required'});
        let body='';for await(const chunk of req){body+=chunk;if(body.length>24000)return json(res,413,{error:'Request too large'});}
        let parsed;try{parsed=JSON.parse(body);}catch{return json(res,400,{error:'Invalid JSON'});}
        return json(res,200,await operations.execute(parsed.argv,'http'));
      }
      return json(res, 404, { error: 'Not found' });
    }
    // Never serve credentials, server source or persisted state.
    if (req.method !== 'GET' || !(pathname === '/agents' || pathname === '/agents/' || pathname === '/agents.html' || pathname === '/' || pathname === '/index.html' || /^\/src\/[a-z-]+\.(js|css)$/.test(pathname) || /^\/src\/vendor\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_-]+\.mjs$/.test(pathname)&&!pathname.split('/').some(p=>p==='..'||p==='.'))) { res.writeHead(404); res.end('Not found'); return; }
    const file = resolve(root, ['/agents','/agents/'].includes(pathname) ? 'agents.html' : pathname === '/' ? 'index.html' : '.' + pathname);
    const content = await readFile(file);
    if(extname(file)==='.html')humanIntent.issue(req,res);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') { res.writeHead(404); res.end('Not found'); }
    else json(res, error.status || 500, { error: error.message });
  }
};
for (const address of addresses) {
  const server = createServer(handleRequest);
  server.on('error', error => { console.error(error.message); process.exit(1); });
  server.listen(port, address, () => console.log(`AI村 → http://${address}:${port}`));
}
