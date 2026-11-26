import {tailnetAddress} from './network.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:400});};
const path=value=>typeof value==='string'&&value.startsWith('/')&&value.length<=1000&&!/[\r\n\0]/.test(value);
export function remoteVillageConnection(input,{url,authRequired=false,partial=false}={}){
  if(input!=null&&(typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['url','cliPath','authFile'].includes(k))))fail('工房のvillageConnectionはurl/cliPath/authFileのみ指定してください（認証値は保存しません）');
  const c={...input};if(!c.url&&url)c.url=url;
  if(c.url){let u;try{u=new URL(c.url);}catch{fail('村への到達URLが不正です');}
    if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!['http:','https:'].includes(u.protocol)||['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.hostname.endsWith('.localhost')||u.hostname==='localhost.'||u.hostname.endsWith('.localhost.')||u.hostname==='0.0.0.0'||u.hostname==='[::]'||u.hostname.startsWith('127.')||/^\[::ffff:(?:127\.|7f[0-9a-f]{2}:)/.test(u.hostname)||u.protocol==='http:'&&!tailnetAddress(u.hostname))fail('別ホストの村URLは認証付きHTTPS originまたは既存VPNのIPv4 originを指定してください。localhost・資格情報付きURLは使用できません');
    c.url=u.origin;
  }else if(!partial)fail('別ホストへの村URLが未設定です。既存VILLAGE_PUBLIC_ORIGIN/VPN設定または工房villageConnection.urlを確認してください');
  if(c.cliPath!==undefined&&!path(c.cliPath)||c.authFile!==undefined&&!path(c.authFile))fail('cliPath/authFileは実行ホスト上の絶対パスで指定してください');
  if(!partial&&!c.cliPath)fail('工房villageConnection.cliPathが未設定です。実行ホストに同版のscripts/village.mjsとsrc/upload-limits.jsを配置しCLI絶対パスを設定してください');
  if(!partial&&(authRequired||c.url.startsWith('https:'))&&!c.authFile)fail('工房villageConnection.authFileに実行ホストの既存認証ファイルを設定してください。秘密値は入力しないでください');
  return c;
}
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export function connectionArgs(c,agentId){return ['env',`VILLAGE_URL=${c.url}`,'VILLAGE_PUBLIC_ORIGIN=',`VILLAGE_AUTH_FILE=${c.authFile||''}`,`VILLAGE_AGENT_ID=${agentId||''}`,'node',c.cliPath];}
export function connectionCommand(c,agentId){return connectionArgs(c,agentId).map(quote).join(' ');}
export async function checkRemoteConnection(d,a){
  let result;
  try{result=JSON.parse(await d.execute(a,[...connectionArgs(a.villageConnection),'--connection-check','rules','get','work']));}
  catch{fail('別ホストから村CLIの読取疎通に失敗しました。Node/CLIと依存ファイル、URL到達性、認証ファイル権限を実行ホストで確認してください。Agentは起動していません');}
  if(!result.ok||result.clientConnectionVersion!==1||result.result?.revision!==d.rules.specification('work').revision)fail('別ホストの村CLI/接続先/仕様が一致しません。同版CLIと接続設定、認証を確認してください。Agentは起動していません');
}
