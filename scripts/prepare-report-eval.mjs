// Generates offline evaluation packets only. Never starts Agents or sends notifications.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {AgentRules} from '../server/agent-rules.mjs';import {reportInputs} from '../server/report-inputs.mjs';
const output=process.argv[2];if(!output)throw Error('Usage: node scripts/prepare-report-eval.mjs NEW_OUTPUT_DIRECTORY');
await mkdir(output,{recursive:false});
const baseline='fb5a469',oldSource=execFileSync('git',['show',baseline+':server/agent-rules.mjs'],{encoding:'utf8'});
const {AgentRules:OldRules}=await import('data:text/javascript;base64,'+Buffer.from(oldSource).toString('base64'));
const rules=new AgentRules('http://127.0.0.1:1'),old=new OldRules('http://127.0.0.1:1');
const cases=JSON.parse(await readFile(new URL('../tests/fixtures/report-evaluation/cases.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const manifest=[];
for(const c of cases){
 const inbox=c.amendments.map((a,i)=>({id:'input-'+i,kind:'supplement',workId:a.workId||'root',text:a.text,createdAt:`2026-01-01T00:00:${String(i+1).padStart(2,'0')}Z`,...(a.actor==='unknown'?{}:{source:{actor:a.actor}})}));
 const q={id:'eval-'+c.id,rootWorkId:'root',createdAt:'2026-01-01T00:00:00Z',instruction:c.question,requestGraph:{nodes:[...new Set(['root',...inbox.map(i=>i.workId)])].map(id=>({id,createdBy:'human',inbox:inbox.filter(i=>i.workId===id)})),operations:[]}},source={id:'work-result',workId:'root',finalOutput:c.output};
 for(const variant of ['old','new']){
  const r=variant==='old'?old:rules,system=r.specification('report').text,user=variant==='old'?old.reportData(q,source,inbox.filter(i=>i.workId==='root').map(i=>i.text)):rules.reportData(q,source,reportInputs(q));
  const packet={caseId:c.id,variant,system,user,restrictions:'固定資料だけで報告本文を生成する。ツール・ネットワーク・外部操作は使用しない。情報不足は明示する。',criteria:c.criteria};
  const file=c.id+'.'+variant+'.json';await writeFile(join(output,file),JSON.stringify(packet,null,2)+'\n');
  manifest.push({caseId:c.id,variant,file,systemHash:hash(system),inputHash:hash(user),rulesRevision:r.specification('report').revision});
 }
}
await writeFile(join(output,'manifest.json'),JSON.stringify({baseline,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),casesHash:hash(JSON.stringify(cases)),packets:manifest},null,2)+'\n');
await writeFile(join(output,'assessment-template.json'),JSON.stringify({caseId:'',variant:'',model:'',modelVersion:'',settings:{},generatedAt:'',rawOutputFile:'',evaluator:'',criteria:[{criterion:'',verdict:'pass|fail|uncertain',evidence:'出力の引用と資料の根拠',reason:''}],overall:'pass|fail|uncertain'},null,2)+'\n');
console.log('Prepared '+manifest.length+' packets in '+resolve(output)+'. No AI execution or notification performed.');
