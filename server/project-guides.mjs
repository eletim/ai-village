import {AgentRules} from './agent-rules.mjs';
import {readFile, realpath} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const DEFAULT_SECRETARY_POLICY = `# デフォルトの秘書方針

- 個別指示を優先します。
- 人間から明示的な実装指示があるまで、実装や工房への作業指示を行わない。相談・方針検討・案への同意だけでは、実装指示とみなさない。
- 新規実装は新規作業ブランチで実装し、必要な検証・commit・push・PR作成まで行います。使う開発ブランチが指定・設定されている場合は、原則としてそれを分岐元・PR先とします。なければ最新mainを分岐元とします。
- 同じ作業の修正・追加実装は、進行中の作業ブランチへ追加pushし、既存PRを更新します。PRがマージ済み・クローズ済みなら新規ブランチとPRを作成します。
- mainで直接実装せず、明示指示なくmainへマージしません。
- デフォルトの範囲はPR作成までです。開発ブランチへのマージ・本番反映は、Projectの方針や個別指示で許可された場合に行います。

この方針文書そのものが操作の許可範囲を増やすことはありません。
`;

// Explicit Project IDs live in the document manifest, never name/cwd inference.
export class ProjectGuides {
  constructor(root=fileURLToPath(new URL('../village/projects/',import.meta.url)),direct=null){this.root=root;this.direct=direct;}
  async initialize(project){
    const policies=this.direct.data.projectPolicies ||= {};
    if(Object.hasOwn(policies,project.id))return;
    // A broken or unreadable existing manifest is not evidence of an unset policy.
    let manifest;
    try{manifest=JSON.parse(await readFile(resolve(this.root,'index.json'),'utf8'));}
    catch(error){if(error.code!=='ENOENT')return;manifest={};}
    if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||Object.hasOwn(manifest,project.id))return;
    policies[project.id]={content:DEFAULT_SECRETARY_POLICY,revision:0};
  }
  async get(projectId){
    if(typeof projectId!=='string'||!projectId) return {available:false};
    if(this.direct?.data.projects.some(p=>p.id===projectId&&(p.deletedAt||p.deletion)))return {available:false};
    const policies=this.direct?.data.projectPolicies;
    const stored=policies&&Object.hasOwn(policies,projectId)?policies[projectId]:null;
    if(stored){const hash=createHash('sha256').update(stored.content).digest('hex');return {available:true,projectId,content:stored.content,hash,revision:`saved:${stored.revision}:${hash}`};}
    try {
      const root=await realpath(this.root);
      const manifest=JSON.parse(await readFile(resolve(root,'index.json'),'utf8'));
      const path=Object.hasOwn(manifest,projectId)?manifest[projectId]:null;
      if(typeof path!=='string')return {available:false};
      const file=await realpath(resolve(root,path));
      if(!file.startsWith(root+sep)||!file.endsWith('.md'))return {available:false};
      const content=await readFile(file,'utf8');
      const hash=createHash('sha256').update(content).digest('hex');
      return {available:true,projectId,content,hash,revision:'document:'+hash};
    } catch { return {available:false}; }
  }
  async context(agent,run,url){
    if(agent.location!=='mayor'||run.phase==='report'||!agent.projectId)return '';
    const doc=await this.get(agent.projectId);
    if(!doc.available)return '';
    return new AgentRules(url).project(agent.projectId);
  }
}
