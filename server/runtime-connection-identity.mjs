// Match execute()/pmux(): local uses this server process/user; SSH passes the
// saved target verbatim (including user@host) to the same SSH executor/config.
// Do not equate aliases or infer identity from the display URL or workshop name.
export function runtimeConnectionIdentity(connection){
 const type=connection?.connectionType||'ssh';
 if(type==='local')return 'local';
 if(type==='ssh'&&typeof connection?.sshHost==='string'&&/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]{0,200}$/.test(connection.sshHost))return 'ssh:'+connection.sshHost;
 return null;
}
export function sameRuntimeConnection(a,b){
 const identity=runtimeConnectionIdentity(a);
 return identity!==null&&identity===runtimeConnectionIdentity(b);
}
