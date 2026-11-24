// Offline packets only. Optional answers.json maps case ID to the exact raw work output.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {AgentRules} from '../server/agent-rules.mjs';
import {reportInputs} from '../server/report-inputs.mjs';
const [out,answerFile]=process.argv.slice(2);if(!out)throw Error('Usage: node scripts/prepare-direct-report-eval.mjs NEW_DIR [answers.json]');await mkdir(out,{recursive:false});
const answers=answerFile?JSON.parse(await readFile(answerFile,'utf8')):null,cases=JSON.parse(await readFile(new URL('../tests/fixtures/report-evaluation/cases.json',import.meta.url),'utf8')),rules=new AgentRules('http://127.0.0.1:1'),manifest=[];
for(const c of cases){
 const inbox=c.amendments.map((a,i)=>({id:'i'+i,kind:'supplement',text:a.text,createdAt:new Date(1700000000000+i*1000).toISOString(),source:{actor:a.actor},workId:a.workId||'root'}));
 const q={id:'eval-'+c.id,rootWorkId:'root',instruction:c.question,requestGraph:{operations:[],nodes:[...new Set(['root',...inbox.map(i=>i.workId)])].map(id=>({id,createdBy:'human',inbox:inbox.filter(i=>i.workId===id)}))}};
 const original=answers?.[c.id]??c.output;if(typeof original!=='string')throw Error('answer must be raw text');
 await writeFile(join(out,c.id+'.direct.txt'),original);
 await writeFile(join(out,c.id+'.work.json'),JSON.stringify({system:rules.specification('work').text,user:JSON.stringify({question:c.question,humanInstructions:inbox.filter(i=>i.source.actor==='human'&&i.workId==='root'),evidence:c.output}),restriction:'隔離した文章評価。提示資料から回答本文だけを生成。ツール・API・外部操作を実行しない。'},null,2));
 await writeFile(join(out,c.id+'.rewrite.json'),JSON.stringify({system:rules.specification('report').text,user:rules.reportData(q,{id:'work',workId:'root',finalOutput:original},reportInputs(q)),restriction:'提示資料だけで報告本文を生成。ツール・外部操作なし。'},null,2));
 manifest.push({id:c.id,source:answers&&Object.hasOwn(answers,c.id)?'raw-work-output':'fixed-fixture-output',originalHash:createHash('sha256').update(original).digest('hex'),criteria:c.criteria});
}
await writeFile(join(out,'review-only.json'),JSON.stringify({workRevision:rules.specification('work').revision,reportRevision:rules.specification('report').revision,cases:manifest,assessment:{model:'record exact model or unknown',rawEvents:'path',rawOutput:'path',verdict:'pass|fail|uncertain',evidence:'quote and source',notes:'Do not send this reviewer file to the generating model'}},null,2));
console.log('Prepared direct/rewrite comparison without AI execution or notifications.');
