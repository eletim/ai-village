#!/usr/bin/env node
// Deterministic CLI boundary for the real HTTP/browser persistence test. No network/tools.
import { writeFile } from 'node:fs/promises';
const args=process.argv.slice(2);let prompt='';for await (const chunk of process.stdin) prompt+=chunk;
const resume=args.indexOf('resume');
if (resume>=0 && args[resume+1]==='00000000-0000-0000-0000-000000000000') {
  console.error('Error: thread/resume failed: no rollout found for thread id 00000000-0000-0000-0000-000000000000');process.exit(1);
}
const answer={action:'reply',message:'継続確認の返答です。操作は実行していません。',document:'',task:'',argv:[],attachments:[],memo:{topic:'ブラウザ継続確認',purpose:'保存と再開の確認',decisions:'操作しない',permissions:'なし',unfinished:'なし',references:'会話履歴'}};
await writeFile(args[args.indexOf('-o')+1],JSON.stringify(answer));
console.log(JSON.stringify({type:'thread.started',thread_id:'browser-session'}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:prompt.length,output_tokens:100}}));
