import {Marked} from './vendor/marked.mjs';
export const escapeReport=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reportImageURL(ref){const m=/^village-image:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(ref);return m?'/api/images/'+m[1]:null;}
export function safeDiagram(source){return source.length<=30000&&!/%%\{|^\s*---|<[a-z!/]|!\[|(?:https?|data|javascript|file):|\b(?:click|classDef|linkStyle|style)\s|\b(?:img|icon)\s*:|url\s*\(|@import/i.test(source);}
function linkAttributes(href){
 if(/[\s\u0000-\u001f\u007f]/.test(href))return null;
 if(/^\/api\/jobs\/[0-9a-f-]{36}\/artifact\?path=[^\s]+$/i.test(href))return `href="${escapeReport(href)}" download`;
 if(!/^https?:\/\//i.test(href))return null;
 try{const url=new URL(href);if(url.username||url.password)return null;}catch{return null;}
 return `href="${escapeReport(href)}" target="_blank" rel="noopener noreferrer"`;
}
// Marked owns all Markdown parsing. This only checks whether its fenced-code
// token has a closing delimiter before requesting asynchronous Mermaid rendering.
function closedFence(raw){const open=/^ {0,3}(`{3,}|~{3,})/.exec(raw);return !!open&&new RegExp('\\n {0,3}'+open[1][0]+'{'+open[1].length+',}[ \\t]*(?:\\n)?$').test(raw);}
const markdown=new Marked({gfm:true,breaks:true,async:false,renderer:{
 html({text}){return escapeReport(text).replaceAll('\n','<br>\n');},
 br(){return '<br>\n';},
 code({text,lang,raw}){
  if(lang?.trim()==='mermaid'&&closedFence(raw)&&safeDiagram(text))return `<figure data-visual="mermaid" data-source="${escapeReport(text)}"><pre><code>${escapeReport(raw)}</code></pre></figure>`;
  return `<pre><code>${escapeReport(text)}</code></pre>\n`;
 },
 link({href,title,tokens,autolink,raw}){
  let tail='',content=this.parser.parseInline(tokens);
  // Preserve the existing Japanese prose URL boundary after Marked tokenizes it.
  if(autolink&&raw===href){while(/[。、！？）」』】]$/.test(href)){tail=href.slice(-1)+tail;href=href.slice(0,-1);}if(tail)content=escapeReport(href);}
  const attrs=linkAttributes(href);
  // Do not nest interactive zoom buttons inside a Markdown link.
  return attrs&&!content.includes('data-visual=')?`<a ${attrs}${title?` title="${escapeReport(title)}"`:''}>${content}</a>${escapeReport(tail)}`:content+escapeReport(tail);
 },
 image({href,text,raw}){
  const url=reportImageURL(href);if(!url)return escapeReport(raw);
  // Inline container remains valid inside paragraphs, lists and table cells.
  return `<span data-visual="image" data-source="${escapeReport(href)}" data-alt="${escapeReport(text)}"><button type="button" class="report-zoom" aria-label="${escapeReport(text||'画像')}を拡大"><img src="${url}" alt="${escapeReport(text)}"></button><span class="report-caption">${escapeReport(text)}</span></span>`;
 }
}});
export function reportHTML(value){
 const text=String(value??'');
 try{return '<div class="markdown-report">'+markdown.parse(text)+'</div>';}
 catch{return '<div class="markdown-report"><pre>'+escapeReport(text)+'</pre></div>';}
}
