import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
const compress=promisify(gzip);
export async function syncResponse(req,res,value){
 return contentResponse(req,res,Buffer.from(JSON.stringify(value)),'application/json; charset=utf-8');
}
// Static UI modules use the same negotiated transfer encoding as workspace JSON.
// Keep no-store: deployments and authentication must not inherit a stale asset.
export async function contentResponse(req,res,body,type){
 const accepts=(req.headers['accept-encoding']||'').split(',').some(part=>/^gzip(?:\s*;.*)?$/i.test(part.trim())&&!/;\s*q=0(?:\.0*)?(?:\s|;|$)/i.test(part));
 const headers={'Content-Type':type,'Cache-Control':'no-store','Vary':'Accept-Encoding'};
 if(accepts&&body.length>=1024){body=await compress(body,{level:4});headers['Content-Encoding']='gzip';}
 headers['Content-Length']=body.length;res.writeHead(200,headers);res.end(body);
}
