import {reportImageURL} from './report-content.js';
let renderer,serial=Promise.resolve(),counter=0;
const previous=new WeakMap();
async function renderDiagram(source){
 renderer ||= Promise.all([import('./vendor/mermaid/mermaid.mjs'),import('./vendor/purify.mjs')]).then(([m,p])=>{
  m.default.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,suppressErrorRendering:true,maxTextSize:30000,maxEdges:500,theme:'default',secure:['secure','securityLevel','startOnLoad','maxTextSize','maxEdges','htmlLabels','suppressErrorRendering']});return {mermaid:m.default,purify:p.default};
 });
 const {mermaid,purify}=await renderer;
 const id='village-diagram-'+(++counter);let svg;
 // Mermaid measures inside a temporary element. Keep it out of the page flow: appended to
 // <body> it took layout space in the 100dvh flex column and briefly shrank the screen.
 const sandbox=document.createElement('div');sandbox.setAttribute('aria-hidden','true');
 sandbox.style.cssText='position:fixed;left:-10000px;top:0;width:1000px;visibility:hidden;pointer-events:none;contain:layout';
 document.body.append(sandbox);
 try{({svg}=await mermaid.render(id,source,sandbox));}finally{sandbox.remove();document.getElementById('d'+id)?.remove();}
 const clean=purify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','script','image','a','animate','set'],FORBID_ATTR:['href','xlink:href']});
 // Display as an image document: no SVG scripting/links or external resource loading.
 const svgDocument=new DOMParser().parseFromString(clean,'image/svg+xml'),root=svgDocument.documentElement;
 const box=(root.getAttribute('viewBox')||'').split(/[ ,]+/).map(Number);
 if(box.length===4&&box.every(Number.isFinite)&&box[2]>0&&box[3]>0){root.setAttribute('width',String(box[2]));root.setAttribute('height',String(box[3]));}
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(root));
}
function enhance(node){
 if(node.dataset.ready)return;node.dataset.ready='true';
 if(node.dataset.visual==='image'){
  node.querySelector('img').addEventListener('error',()=>{node.textContent='画像を表示できません: '+(node.dataset.alt||node.dataset.source);},{once:true});return;
 }
 const task=async()=>{try{
  const url=await renderDiagram(node.dataset.source);if(!node.isConnected)return;
  const button=document.createElement('button');button.type='button';button.className='report-zoom';button.setAttribute('aria-label','図を拡大');const img=document.createElement('img');img.src=url;img.alt='Mermaid図';button.append(img);
  const details=document.createElement('details'),summary=document.createElement('summary'),source=document.createElement('pre');summary.textContent='図のソース';source.textContent=node.dataset.source;details.append(summary,source);node.replaceChildren(button,details);
 }catch{/* Keep the readable source on invalid/intermediate diagrams or offline vendor loading. */}};
 serial=serial.then(task,task);
}
// Keep actual visual nodes across changed replies and ignore identical polling snapshots.
export function updateReportHTML(host,html){
 if(previous.get(host)===html)return;previous.set(host,html);
 const key=n=>JSON.stringify([n.dataset.visual,n.dataset.source,n.dataset.alt]);const old=new Map();
 for(const n of host.querySelectorAll('[data-visual]')){const k=key(n);if(!old.has(k))old.set(k,[]);old.get(k).push(n);}
 const expanded=new Set([...host.querySelectorAll('details[data-disclosure][open]')].map(n=>n.dataset.disclosure));
 const template=document.createElement('template');template.innerHTML=html;
 for(const n of template.content.querySelectorAll('details[data-disclosure]'))if(expanded.has(n.dataset.disclosure))n.open=true;
 for(const n of template.content.querySelectorAll('[data-visual]')){const reuse=old.get(key(n))?.shift();if(reuse)n.replaceWith(reuse);}
 host.replaceChildren(template.content);host.querySelectorAll('[data-visual]').forEach(enhance);
}
let dialog,opener;
document.addEventListener('click',e=>{
 const button=e.target.closest('.report-zoom');if(!button)return;
 const img=button.querySelector('img');if(!img)return;
 const figure=button.closest('[data-visual]');if(!figure)return;
 if(figure.dataset.visual==='image'&&img.getAttribute('src')!==reportImageURL(figure.dataset.source))return;
 if(!dialog){dialog=document.createElement('dialog');dialog.className='report-lightbox';dialog.setAttribute('aria-label','図・画像の拡大表示');const close=document.createElement('button');close.type='button';close.textContent='閉じる';close.onclick=()=>dialog.close();dialog.append(close);dialog.addEventListener('close',()=>{dialog.querySelector('img')?.remove();if(opener?.isConnected)opener.focus({preventScroll:true});});document.body.append(dialog);}
 opener=button;dialog.querySelector('img')?.remove();dialog.append(img.cloneNode());dialog.showModal();dialog.querySelector('button').focus();
});
