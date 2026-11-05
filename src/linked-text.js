// Render text without interpreting HTML. Only web URLs and local artifacts link.
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function anchor(label,href){
 if(/^\/api\/jobs\/[0-9a-f-]{36}\/artifact\?path=[^\s]+$/i.test(href))return `<a href="${escape(href)}" download>${escape(label)}</a>`;
 if(!/^https?:\/\//i.test(href)||/[\s\u0000-\u001f]/.test(href))return null;
 try{new URL(href);}catch{return null;}
 return `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`;
}
export function linkedText(value){
 const text=String(value??'');
 const tokens=/`[^`\n]*`|\[([^\]\n]+)\]\(([^\s)]+(?:\([^\s()]*\)[^\s)]*)?)\)|https?:\/\/[^\s<>"'`]+/gi;
 let html='',offset=0;
 for(const match of text.matchAll(tokens)){
  html+=escape(text.slice(offset,match.index));
  if(match[0].startsWith('`'))html+=escape(match[0]);
  else if(match[1])html+=anchor(match[1],match[2])||escape(match[0]);
  else{
   let url=match[0],tail='';
   while(/[.,!?;:。、！？）」』】]$/.test(url)||(url.endsWith(')')&&(url.match(/\)/g)||[]).length>(url.match(/\(/g)||[]).length)){tail=url.slice(-1)+tail;url=url.slice(0,-1);}
   html+=(anchor(url,url)||escape(url))+escape(tail);
  }
  offset=match.index+match[0].length;
 }
 return html+escape(text.slice(offset));
}
