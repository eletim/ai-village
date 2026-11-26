import {imageNavigation} from './image-navigation.js';
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
const disclosureStates=new WeakMap();
export function updateReportHTML(host,html){
 if(previous.get(host)===html)return;previous.set(host,html);
 const key=n=>JSON.stringify([n.dataset.visual,n.dataset.source,n.dataset.alt]);const old=new Map();
 for(const n of host.querySelectorAll('[data-visual]')){const k=key(n);if(!old.has(k))old.set(k,[]);old.get(k).push(n);}
 const expanded=disclosureStates.get(host)||new Map();
 for(const n of host.querySelectorAll('details[data-disclosure]'))expanded.set(n.dataset.disclosure,n.open);
 while(expanded.size>2000)expanded.delete(expanded.keys().next().value);
 disclosureStates.set(host,expanded);
 const template=document.createElement('template');template.innerHTML=html;
 for(const n of template.content.querySelectorAll('details[data-disclosure]'))if(expanded.get(n.dataset.disclosure))n.open=true;
 for(const n of template.content.querySelectorAll('[data-visual]')){const reuse=old.get(key(n))?.shift();if(reuse)n.replaceWith(reuse);}
 host.replaceChildren(template.content);host.querySelectorAll('[data-visual]').forEach(enhance);
}
let dialog,navigation,restoreFocus,images=[],index=0;
function showImage(){
 navigation.show(images[index].cloneNode());
 dialog.querySelector('[data-prev]').disabled=index===0;
 dialog.querySelector('[data-next]').disabled=index===images.length-1;
 dialog.querySelector('[data-count]').textContent=`${index+1} / ${images.length}`;
}
function step(delta){const next=index+delta;if(next<0||next>=images.length)return;index=next;showImage();}
function validImage(button){
 const img=button.querySelector('img'),figure=button.closest('[data-visual]');
 if(!img||!figure)return null;
 if(figure.dataset.visual==='image'&&img.getAttribute('src')!==reportImageURL(figure.dataset.source))return null;
 if(figure.dataset.visual!=='image'&&figure.dataset.visual!=='mermaid')return null;
 return img;
}
// Keep a semantic address as preview synchronization can replace the opener's DOM.
function focusReturn(button){
 const container=button.closest('.agent-panel,#history-content,.chat-message,.report-prose,.report-agent')||button.parentElement;
 const id=container.id,entry=button.closest('[data-entry]')?.dataset.entry,figure=button.closest('[data-visual]');
 const key=JSON.stringify([figure.dataset.visual,figure.dataset.source,figure.dataset.alt]);
 const matching=root=>[...root.querySelectorAll('[data-visual]')].filter(n=>JSON.stringify([n.dataset.visual,n.dataset.source,n.dataset.alt])===key);
 const group=button.closest('[data-entry]')||container,occurrence=matching(group).indexOf(figure);
 return ()=>{
  if(button.isConnected&&!button.closest('[hidden]')){button.focus({preventScroll:true});return button;}
  const root=id?document.getElementById(id):container;
  if(!root?.isConnected||root.closest('[hidden]'))return null;
  const reply=entry?[...root.querySelectorAll('[data-entry]')].find(n=>n.dataset.entry===entry):root;
  const target=matching(reply||document.createElement('div'))[occurrence]?.querySelector('.report-zoom')||root.querySelector('.runs')||root;
  if(!target.hasAttribute('tabindex')&&!target.matches('button,input,textarea,a'))target.tabIndex=-1;
  target.focus({preventScroll:true});return target;
 };
}
document.addEventListener('click',e=>{
 const button=e.target.closest('.report-zoom');if(!button||!validImage(button))return;
 if(!dialog){
  dialog=document.createElement('dialog');dialog.className='report-lightbox';dialog.setAttribute('aria-label','図・画像の拡大表示');
  dialog.innerHTML='<div class="report-image-controls"><button type="button" data-prev aria-label="前の画像">←</button><span data-count aria-live="polite"></span><button type="button" data-next aria-label="次の画像">→</button><span data-scale></span><button type="button" data-close>閉じる</button></div><p id="report-image-help">ホイール・ピンチで拡大縮小、ドラッグで移動。キー: ＋ / −、0で全体、矢印で移動（全体表示では左右切替）、Escで閉じる。</p><div class="report-image-viewport" tabindex="0" role="group" aria-label="画像の拡大・移動" aria-describedby="report-image-help"></div>';
  const viewport=dialog.querySelector('.report-image-viewport');
  navigation=imageNavigation(viewport,scale=>{dialog.querySelector('[data-scale]').textContent=Math.round(scale*100)+'%';});
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.querySelector('[data-prev]').onclick=()=>step(-1);dialog.querySelector('[data-next]').onclick=()=>step(1);
  dialog.addEventListener('wheel',e=>{if(!viewport.contains(e.target))e.preventDefault();},{passive:false});
  dialog.addEventListener('keydown',e=>{if(navigation.key(e))return;if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();step(e.key==='ArrowLeft'?-1:1);}});
  dialog.addEventListener('close',()=>{
   navigation.clear();images=[];
   const event=new CustomEvent('report-viewer-close',{cancelable:true,detail:{restoreFocus}});
   if(document.dispatchEvent(event))restoreFocus?.();
  });document.body.append(dialog);
 }
 const group=button.closest('.message.assistant,.chat-message,.report-prose,.report-agent')||button.closest('[data-visual]');
 const buttons=[...group.querySelectorAll('.report-zoom')].filter(validImage);
 index=buttons.indexOf(button);images=buttons.map(b=>validImage(b).cloneNode());restoreFocus=focusReturn(button);
 dialog.showModal();showImage();dialog.querySelector('[data-close]').focus();
});
