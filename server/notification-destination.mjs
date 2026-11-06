// Match notify's transport contract; never accept credentials in a URL.
export function destinationPatch(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('通知設定はJSON objectで指定してください');
 if(Object.keys(value).some(k=>!['enabled','server','topic','resetDestination'].includes(k)))throw Error('通知設定の項目が不正です');
 const result={};
 if('enabled' in value){if(typeof value.enabled!=='boolean')throw Error('enabled must be boolean');result.enabled=value.enabled;}
 if('resetDestination' in value&&typeof value.resetDestination!=='boolean')throw Error('resetDestination must be boolean');
 if(value.resetDestination){if(value.server||value.topic)throw Error('宛先の解除と指定は同時にできません');result.resetDestination=true;}
 for(const key of ['server','topic']){
  if(!(key in value))continue;
  if(typeof value[key]!=='string')throw Error('通知先は文字列で指定してください');
  const text=value[key].trim();if(!text)continue;
  if(key==='topic'){
   if(!/^[A-Za-z0-9_-]{1,256}$/.test(text))throw Error('トピックは英数字・_・-の256文字以内で指定してください');
   result.topic=text;
  }else{
   let url;try{url=new URL(text);}catch{throw Error('通知サーバーURLが不正です');}
   const loopback=url.hostname==='localhost'||url.hostname==='[::1]'||/^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
   if(text.length>2048||/[\s\\\u0000-\u001f\u007f]/.test(text)||url.username||url.password||url.href.includes('?')||url.href.includes('#')||!(url.protocol==='https:'||url.protocol==='http:'&&loopback))throw Error('通知サーバーは認証情報・query・fragmentなしのHTTPS URL（loopbackのみHTTP可）を指定してください');
   result.server=url.href.replace(/\/+$/,'');
  }
 }
 return result;
}
