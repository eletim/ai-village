import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
export async function githubToken() {
  if(process.env.GH_TOKEN || process.env.GITHUB_TOKEN)return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  try{return (await exec('gh',['auth','token'],{timeout:5000,maxBuffer:16384})).stdout.trim();}catch{return null;}
}
export async function githubApi(path) {
  const token=await githubToken();
  const r=await fetch('https://api.github.com'+path,{headers:{Accept:'application/vnd.github+json','User-Agent':'ai-village',...(token?{Authorization:`Bearer ${token}`}:{})},signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!r.ok)throw Object.assign(new Error(`GitHub HTTP ${r.status}。未取得です（認証・権限・参照先・API制限を確認してください）。`),{status:r.status});
  const text=await r.text();if(text.length>2000000)throw new Error('GitHub応答が取得上限を超えました。');return JSON.parse(text);
}
