import {AgentRules} from './agent-rules.mjs';
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
    return new AgentRules(url).project(agent.projectId);
  }
}
