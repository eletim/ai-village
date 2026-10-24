import { selectOfficePanel, closeOfficeLibrary } from './office-panels.js';
let current='README.md', root='';
const $=selector=>document.querySelector(selector);
async function get(url) { const response=await fetch(url,{cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error);return body; }
async function catalog() {
  const data=await get('/api/documents');root=data.root;
  $('#document-list').replaceChildren(...data.documents.map(doc=>{
    const button=document.createElement('button');button.textContent=doc.title;button.dataset.document=doc.path;
    button.addEventListener('click',()=>openDocument(doc.path));return button;
  }));
}
export async function openDocument(path='README.md') {
  selectOfficePanel('documents');$('#library-error').textContent='';
  try {
    await catalog();const doc=await get(`/api/documents/content?path=${encodeURIComponent(path)}`);current=doc.path;
    $('#document-name').textContent=doc.path;$('#document-location').textContent=`原本：${root}/${doc.path}`;$('#document-content').textContent=doc.content;
    $('#document-list').querySelectorAll('button').forEach(button=>{
      const selected=button.dataset.document===doc.path;
      button.classList.toggle('selected',selected);button.setAttribute('aria-current',String(selected));
    });
  } catch(error){$('#library-error').textContent=error.message;}
}
export function openLibrary(){return openDocument('README.md');}
document.querySelector('#close-library').addEventListener('click',closeOfficeLibrary);
document.querySelector('#refresh-document').addEventListener('click',()=>openDocument(current));
