import {linkedText} from './linked-text.js';
export const escapeReport=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reportImageURL(ref){const m=/^village-image:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(ref);return m?'/api/images/'+m[1]:null;}
export function safeDiagram(source){return source.length<=30000&&!/%%\{|^\s*---|<[a-z!/]|!\[|(?:https?|data|javascript|file):|\b(?:click|classDef|linkStyle|style)\s|\b(?:img|icon)\s*:|url\s*\(|@import/i.test(source);}
function prose(text){
 let out='',last=0;for(const m of text.matchAll(/`[^`\n]*`|!\[([^\]\n]*)\]\(([^\s)]+)\)/g)){
  out+=linkedText(text.slice(last,m.index));const url=m[2]&&reportImageURL(m[2]);
  out+=url?`</pre><figure data-visual="image" data-source="${escapeReport(m[2])}" data-alt="${escapeReport(m[1])}"><button type="button" class="report-zoom" aria-label="${escapeReport(m[1]||'画像')}を拡大"><img src="${url}" alt="${escapeReport(m[1])}"></button><figcaption>${escapeReport(m[1])}</figcaption></figure><pre>`:escapeReport(m[0]);last=m.index+m[0].length;
 }return '<pre>'+out+linkedText(text.slice(last))+'</pre>';
}
// Only closed Mermaid fences and UUID image references are interpreted. No HTML/markdown engine.
export function reportHTML(value){
 const text=String(value??'');let out='',offset=0;
 const fence=/^(`{3,}|~{3,})([^\n]*)\n/gm;let m;
 while((m=fence.exec(text))){
  out+=prose(text.slice(offset,m.index));const end=new RegExp('^'+m[1][0]+'{'+m[1].length+',}\\s*$','gm');end.lastIndex=fence.lastIndex;const close=end.exec(text);
  if(!close){out+='<pre>'+escapeReport(text.slice(m.index))+'</pre>';offset=text.length;break;}
  const source=text.slice(fence.lastIndex,close.index),original=text.slice(m.index,end.lastIndex);
  out+=m[2].trim()==='mermaid'&&safeDiagram(source)?`<figure data-visual="mermaid" data-source="${escapeReport(source)}"><pre>${escapeReport(original)}</pre></figure>`:'<pre>'+escapeReport(original)+'</pre>';
  offset=end.lastIndex;fence.lastIndex=offset;
 }return out+prose(text.slice(offset));
}
