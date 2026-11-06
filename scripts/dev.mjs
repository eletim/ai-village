import {TravelRegistry} from '../server/travel-registry.mjs';
import {AttachmentStore} from '../server/attachments.mjs';
import { DirectAgents } from '../server/direct.mjs';
import { PullRequests } from '../server/pull-requests.mjs';
import { listenAddresses } from '../server/network.mjs';
import { TodoStore } from '../server/todos.mjs';
import { accessPolicy } from '../server/access.mjs';
import { ImageStore } from '../server/images.mjs';
import { randomUUID } from 'node:crypto';
import { run } from '../server/bridge.mjs';
import { WebReader } from '../server/web-reader.mjs';
import { Development } from '../server/development.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { VillageLibrary } from '../server/library.mjs';
import { VillageOperations } from '../server/operations.mjs';
import { VillageNotifier } from '../server/notifier.mjs';
import { Secretariat } from '../server/secretariat.mjs';
import { WorkshopBridge } from '../server/bridge.mjs';
const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const port = Number(value('--port', 5173)), host = value('--host', '127.0.0.1'), root = resolve('.');
const addresses = listenAddresses({host});
const allowRequest = await accessPolicy({host:addresses[0],port,vpnAddress:addresses.find(address=>address.startsWith('100.'))});
const library = new VillageLibrary();
const bridge = new WorkshopBridge({ library });
await bridge.init();
const todos = new TodoStore(bridge.dir);
await todos.init();
const travelRegistry=new TravelRegistry(bridge.dir);await travelRegistry.init();
const notifier = new VillageNotifier({ dir: bridge.dir });
await notifier.init();
const attachments=new AttachmentStore(bridge.dir);await attachments.init();
const direct = new DirectAgents({dir:bridge.dir,remote:bridge.remote.bind(bridge),notifier,attachments,villageUrl:`http://127.0.0.1:${port}`});
await direct.init();
const development = new Development(bridge, library, {port});
const images = new ImageStore(bridge.dir);
await images.init();
const operations = new VillageOperations(bridge, notifier, {web:new WebReader(),development,images,todos,direct,travelRegistry,prs:new PullRequests(bridge.dir,library)});
const secretariat = new Secretariat(bridge, library, operations, notifier, images);
await secretariat.init();
secretariat.direct=direct;
development.watch(secretariat);
const instanceId=randomUUID(), runningCommit=(await run('git',['rev-parse','HEAD'])).trim();
const snapshot = async () => ({ ...bridge.snapshot(), workshops: await library.workshops(), secretary: secretariat.snapshot() });
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const handleRequest = async (req, res) => {
  try {
    if(!allowRequest(req,res))return;
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) {
      if (pathname.startsWith('/api/direct')) {
        if(req.method==='GET' && pathname==='/api/direct/requests')return json(res,200,{requests:direct.flow.list()});
        if(req.method==='GET' && pathname==='/api/direct/agents')return json(res,200,direct.discovery());
        if(req.method==='GET' && pathname==='/api/direct')return json(res,200,direct.snapshot());
        const deletion=pathname.match(/^\/api\/direct\/projects\/([0-9a-f-]{36})\/(delete-plan|delete)$/);
        if(deletion&&req.method==='GET'&&deletion[2]==='delete-plan')return json(res,200,direct.projectDeletePlan(deletion[1]));
        if(!['POST','PUT'].includes(req.method))return json(res,405,{error:'Method not allowed'});
        if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'JSON required'});
        let body='';for await(const chunk of req){body+=chunk;if(body.length>80000)return json(res,413,{error:'Request too large'});}
        let input;try{input=JSON.parse(body);}catch{return json(res,400,{error:'Invalid JSON'});}
        if(!input || typeof input!=='object')return json(res,400,{error:'Object required'});
        const requestAction=pathname.match(/^\/api\/direct\/requests\/(get|results|delegate|acknowledge|finish|retry|resume|cancel)$/);
        if(req.method==='POST'&&requestAction){
          const action=requestAction[1],flow=direct.flow;
          const result=action==='get'?flow.get(input.humanRequestId):action==='results'?flow.results(input.humanRequestId,input.workId):action==='retry'||action==='resume'?await flow.continue(input,action==='retry'):await flow[action](input);
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
      if (req.method === 'GET' && pathname === '/api/secretary/memo') return json(res,200,await secretariat.memoSnapshot());
      if (req.method === 'GET' && pathname === '/api/health') return json(res,200,{commit:runningCommit,instanceId,supervised:process.env.VILLAGE_SUPERVISED==='1'});
      if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, await snapshot());
      if (req.method === 'GET' && pathname === '/api/documents') return json(res, 200, { root: library.root, documents: await library.catalog() });
      if (req.method === 'GET' && pathname === '/api/documents/content') return json(res, 200, await library.read(new URL(req.url, 'http://localhost').searchParams.get('path')));
      const attachmentRoute=pathname.match(/^\/api\/attachments\/([0-9a-f-]{36})$/);
      if(req.method==='GET'&&attachmentRoute){
        const record=await attachments.get(attachmentRoute[1]),bytes=await attachments.content(record.id);
        res.writeHead(200,{'Content-Type':record.kind==='image'?'image/png':'application/octet-stream','Content-Disposition':(record.kind==='image'?'inline':'attachment')+"; filename*=UTF-8''"+encodeURIComponent(record.name).replaceAll("'",'%27'),'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'private, no-store'});res.end(bytes);return;
      }
      if(req.method==='POST'&&pathname==='/api/attachments'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        return json(res,201,await attachments.save(Buffer.concat(chunks),new URL(req.url,'http://localhost').searchParams.get('name'),req.headers['content-type']));
      }
      const imageRoute = pathname.match(/^\/api\/images\/([0-9a-f-]{36})$/);
      if (req.method === 'GET' && imageRoute) {
        const content = await images.content(imageRoute[1]);
        res.writeHead(200, {'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-cache'});
        res.end(content); return;
      }
      if (req.method === 'POST' && pathname === '/api/images') {
        if (!['image/png','image/jpeg','image/webp'].includes(req.headers['content-type'])) return json(res,415,{error:'PNG・JPEG・WebPを選んでください。'});
        const chunks=[];
        for await (const chunk of req) chunks.push(chunk);
        const name = new URL(req.url,'http://localhost').searchParams.get('name') || '画像';
        return json(res,201,await images.save(Buffer.concat(chunks),name));
      }
      const jobRoute = pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/(approve|cancel|artifact|artifacts)$/);
      if (jobRoute && req.method === 'GET' && jobRoute[2] === 'artifacts') {
        const job=bridge.jobById(jobRoute[1]);
        await bridge.update({ artifacts: await bridge.listArtifacts(job), artifactError: null }, job);
        return json(res, 200, await snapshot());
      }
      if (jobRoute && req.method === 'POST' && jobRoute[2] === 'cancel') { await bridge.cancel(jobRoute[1]); return json(res, 200, await snapshot()); }
      if (jobRoute && req.method === 'POST' && jobRoute[2] === 'approve') { await bridge.approve(jobRoute[1]); return json(res, 200, await snapshot()); }
      if (jobRoute && req.method === 'GET' && jobRoute[2] === 'artifact') {
        const path = new URL(req.url, 'http://localhost').searchParams.get('path');
        const content = await bridge.artifact(jobRoute[1], path);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.split('/').at(-1))}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        res.end(content); return;
      }

      if (req.method === 'POST' && pathname === '/api/village') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{error:'JSON required'});
        let body='';for await(const chunk of req){body+=chunk;if(body.length>24000)return json(res,413,{error:'Request too large'});}
        let parsed;try{parsed=JSON.parse(body);}catch{return json(res,400,{error:'Invalid JSON'});}
        return json(res,200,await operations.execute(parsed.argv,'http'));
      }
      if (req.method === 'POST' && ['/api/messages', '/api/jobs'].includes(pathname)) {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'JSON required' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 24000) return json(res, 413, { error: 'Request too large' }); }
        let parsed;
        try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
        const request = parsed?.message ?? parsed?.request;
        if (typeof request !== 'string' || (!request.trim() && !parsed.attachments?.length) || request.length > 2000) return json(res, 400, { error: '文章（2000文字以内）または画像を添付してください。' });
        await secretariat.send(request.trim(), parsed.attachments, {agentId:parsed.agentId,requestId:parsed.requestId,travelContexts:parsed.travelContexts});
        return json(res, 202, await snapshot());
      }
      return json(res, 404, { error: 'Not found' });
    }
    // Never serve credentials, source of the bridge, or persisted job output.
    if (req.method !== 'GET' || !(pathname === '/agents' || pathname === '/agents/' || pathname === '/agents.html' || pathname === '/' || pathname === '/index.html' || pathname === '/office' || pathname === '/office/' || /^\/src\/[a-z-]+\.(js|css)$/.test(pathname) || /^\/src\/vendor\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_-]+\.mjs$/.test(pathname)&&!pathname.split('/').some(p=>p==='..'||p==='.'))) { res.writeHead(404); res.end('Not found'); return; }
    const file = resolve(root, ['/agents','/agents/'].includes(pathname) ? 'agents.html' : ['/', '/office', '/office/'].includes(pathname) ? 'index.html' : '.' + pathname);
    const content = await readFile(file);
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
