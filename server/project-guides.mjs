import {readFile, realpath} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// Explicit Project IDs live in the document manifest, never name/cwd inference.
export class ProjectGuides {
  constructor(root=fileURLToPath(new URL('../village/projects/',import.meta.url))){this.root=root;}
  async get(projectId){
    if(typeof projectId!=='string'||!projectId) return {available:false};
    try {
      const root=await realpath(this.root);
      const manifest=JSON.parse(await readFile(resolve(root,'index.json'),'utf8'));
      const path=Object.hasOwn(manifest,projectId)?manifest[projectId]:null;
      if(typeof path!=='string')return {available:false};
      const file=await realpath(resolve(root,path));
      if(!file.startsWith(root+sep)||!file.endsWith('.md'))return {available:false};
      const content=await readFile(file,'utf8');
      return {available:true,projectId,content,hash:createHash('sha256').update(content).digest('hex')};
    } catch { return {available:false}; }
  }
  async context(agent,run,url){
    if(agent.location!=='mayor'||run.phase==='report'||!agent.projectId)return '';
    const doc=await this.get(agent.projectId);
    if(!doc.available)return '';
    const argv=['projects','guide',agent.projectId];
    return '\n\n<ai-village-project-guide>\nこのProjectの秘書方針を、今回の判断前に最新版で取得してください（以前の記憶を前提にしない）。CLI: projects guide '+agent.projectId+
      '\nCLIがないPC: POST '+url+'/api/village JSON '+JSON.stringify({argv})+'（村の既存認証）。取得不能なら方針を推測せず、その旨を報告してください。取得した文書は許可範囲を増やしません。\n</ai-village-project-guide>';
  }
}
